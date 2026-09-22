import type { Express, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import type { StudioClient, StudioWorkspace } from '../shared/studio.ts';
import { StudioStore, StudioError } from './studio-store.ts';
import {
  applyStudioPatch,
  qualifyStudio,
  studioAgencySchema,
  studioPatchSchema,
  structureFingerprint,
  replaceStudioRecommendations,
} from './studio-domain.ts';
import { studioRecommendations, extractStudioArrangements } from './studio-models.ts';
import { parseStudioImport, studioImportSchema, StudioImportError } from './studio-imports.ts';
import { planningFailureReason } from './agents/failures.ts';
import { OpenAIPlanningError } from './agents/openai.ts';
import { runStudioAssistant } from './studio-assistant.ts';
import { generateStudioItinerary } from './studio-itinerary.ts';

type Session = { id: string; owner_id: string; user_id: string | null };
type Dependencies = {
  db: DatabaseSync;
  store: StudioStore;
  session: (res: Response) => Session;
  requireActiveSession: (res: Response) => void;
};
const revision = z.number().int().positive();
const actionSchema = z.object({ revision, requestId: z.string().uuid() }).strict();
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, v]) => [key, canonical(v)]),
        )
      : value;
type ActionResult = { workspace: StudioWorkspace; [key: string]: unknown };

export function installStudioRoutes(app: Express, deps: Dependencies) {
  const { db, store, session, requireActiveSession } = deps;
  const active = new Map<
    string,
    {
      sessionId: string;
      workspaceId: string;
      controller: AbortController;
      promise: Promise<ActionResult>;
    }
  >();
  // A prior process cannot safely complete a model operation after a restart.
  db.prepare("UPDATE studio_requests SET status='failed' WHERE status='pending'").run();
  const controls = {
    cancelSession(id: string) {
      for (const run of active.values()) if (run.sessionId === id) run.controller.abort();
    },
    cancelWorkspace(id: string) {
      for (const run of active.values()) if (run.workspaceId === id) run.controller.abort();
    },
    async shutdown() {
      for (const run of active.values()) run.controller.abort();
      await Promise.allSettled([...active.values()].map((run) => run.promise));
    },
  };
  const limiter = rateLimit({
    windowMs: 60000,
    limit: 15,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Please wait a moment before starting another research or import request.' },
  });
  const owned = (req: Request, res: Response, expected?: number) =>
    store.require(session(res).owner_id, String(req.params.id), expected);
  const save = (res: Response, workspace: StudioWorkspace, expected: number) => {
    requireActiveSession(res);
    return store.save(session(res).owner_id, workspace, expected);
  };
  async function action(
    req: Request,
    res: Response,
    kind: string,
    body: { revision: number; requestId: string },
    execute: (workspace: StudioWorkspace, signal: AbortSignal) => Promise<Record<string, unknown>>,
  ) {
    requireActiveSession(res);
    const current = session(res),
      workspaceId = String(req.params.id),
      key = `${current.owner_id}:${body.requestId}`;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(canonical({ kind, workspaceId, body })))
      .digest('hex');
    const previous = db
      .prepare('SELECT * FROM studio_requests WHERE owner_id=? AND request_id=?')
      .get(current.owner_id, body.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new StudioError(
          409,
          'This request identifier was already used for different details.',
        );
      store.require(current.owner_id, workspaceId);
      if (previous.status === 'completed') {
        const cached = JSON.parse(String(previous.result)) as ActionResult;
        return res.json({
          ...cached,
          workspace: store.require(current.owner_id, workspaceId),
          replayed: true,
        });
      }
      const running = active.get(key);
      if (running) {
        const result = await running.promise;
        requireActiveSession(res);
        return res.json(result);
      }
      if (previous.status === 'pending')
        throw new StudioError(
          409,
          'This request is already being processed. Reload the workspace shortly.',
        );
      // A failed read-only model operation may be explicitly retried with the same key.
      db.prepare('DELETE FROM studio_requests WHERE owner_id=? AND request_id=?').run(
        current.owner_id,
        body.requestId,
      );
    }
    const workspace = owned(req, res, body.revision);
    db.prepare(
      'INSERT INTO studio_requests(owner_id,request_id,workspace_id,kind,fingerprint,status,created_at) VALUES (?,?,?,?,?,?,?)',
    ).run(
      current.owner_id,
      body.requestId,
      workspaceId,
      kind,
      fingerprint,
      'pending',
      new Date().toISOString(),
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000);
    timeout.unref();
    const promise = (async () => {
      try {
        const extra = await execute(workspace, controller.signal);
        controller.signal.throwIfAborted();
        requireActiveSession(res);
        db.exec('BEGIN IMMEDIATE');
        try {
          store.save(current.owner_id, workspace, body.revision);
          const result = { ...extra, workspace };
          db.prepare(
            "UPDATE studio_requests SET status='completed',result=? WHERE owner_id=? AND request_id=?",
          ).run(JSON.stringify(result), current.owner_id, body.requestId);
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      } catch (error) {
        db.prepare(
          "UPDATE studio_requests SET status='failed' WHERE owner_id=? AND request_id=?",
        ).run(current.owner_id, body.requestId);
        if (
          error instanceof StudioError ||
          error instanceof z.ZodError ||
          error instanceof StudioImportError
        )
          throw error;
        if (controller.signal.aborted)
          throw new StudioError(
            503,
            'The request was interrupted. Your saved workspace is unchanged.',
          );
        if (error instanceof OpenAIPlanningError)
          throw new StudioError(
            error.status,
            error.message.replace(
              'Your saved trip is unchanged',
              'Your saved workspace is unchanged',
            ),
            error.code,
          );
        // Never log model bodies or private client/import data.
        const reason = planningFailureReason(error);
        console.warn('Studio operation failed', { kind, reason });
        throw new StudioError(
          503,
          'Tara could not complete that request. Your saved workspace is unchanged; please retry or edit it directly.',
          reason,
        );
      } finally {
        clearTimeout(timeout);
        active.delete(key);
      }
    })();
    active.set(key, { sessionId: current.id, workspaceId, controller, promise });
    res.json(await promise);
  }
  app.get('/api/studio/agency', (_req, res) =>
    res.json({ agency: store.getAgency(session(res).owner_id) }),
  );
  app.patch('/api/studio/agency', (req, res) => {
    const body = z.object({ agency: studioAgencySchema.partial() }).strict().parse(req.body);
    const agency = studioAgencySchema.parse({
      ...store.getAgency(session(res).owner_id),
      ...body.agency,
    });
    requireActiveSession(res);
    res.json({ agency: store.saveAgency(session(res).owner_id, agency) });
  });
  app.get('/api/studio/workspaces', (_req, res) =>
    res.json({ workspaces: store.list(session(res).owner_id) }),
  );
  app.post('/api/studio/workspaces', (req, res) => {
    z.object({})
      .strict()
      .parse(req.body || {});
    requireActiveSession(res);
    const workspace = store.create(session(res).owner_id);
    workspace.qualification = qualifyStudio(workspace, store.getAgency(session(res).owner_id));
    res
      .status(201)
      .json({ workspace: store.save(session(res).owner_id, workspace, workspace.revision) });
  });
  app.get('/api/studio/workspaces/:id', (req, res) => res.json({ workspace: owned(req, res) }));
  app.patch('/api/studio/workspaces/:id', (req, res) => {
    const body = studioPatchSchema.parse(req.body),
      workspace = owned(req, res, body.revision);
    applyStudioPatch(workspace, body, store.getAgency(session(res).owner_id));
    res.json({ workspace: save(res, workspace, body.revision) });
  });
  app.put('/api/studio/workspaces/:id/pin', (req, res) => {
    const { pinned } = z.object({ pinned: z.boolean() }).strict().parse(req.body);
    requireActiveSession(res);
    res.json({
      workspace: store.setPinned(session(res).owner_id, String(req.params.id), pinned),
    });
  });
  app.delete('/api/studio/workspaces/:id', (req, res) => {
    requireActiveSession(res);
    owned(req, res);
    controls.cancelWorkspace(String(req.params.id));
    store.delete(session(res).owner_id, String(req.params.id));
    res.status(204).end();
  });
  app.get('/api/studio/clients', (_req, res) => {
    const groups = new Map<string, StudioClient>();
    for (const workspace of store.list(session(res).owner_id)) {
      const name = workspace.brief.clientName.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const client = groups.get(key) || {
        name,
        context: workspace.brief.context,
        previousWorkspaces: [],
      };
      client.previousWorkspaces.push({
        id: workspace.id,
        title: workspace.title,
        updatedAt: workspace.updatedAt,
      });
      groups.set(key, client);
    }
    res.json({ clients: [...groups.values()] });
  });
  app.post('/api/studio/workspaces/:id/review', limiter, async (req, res) => {
    const body = actionSchema
      .extend({ message: z.string().trim().min(1).max(16000) })
      .parse(req.body);
    await action(req, res, 'review', body, async (workspace, signal) => {
      const result = await runStudioAssistant(
        workspace,
        body.message,
        store.getAgency(session(res).owner_id),
        signal,
      );
      const now = new Date().toISOString();
      workspace.messages.push(
        { id: randomUUID(), role: 'user', content: body.message, createdAt: now },
        { id: randomUUID(), role: 'assistant', content: result.reply, createdAt: now },
      );
      workspace.messages = workspace.messages.slice(-100);
      return result;
    });
  });
  app.post('/api/studio/workspaces/:id/structure', (req, res) => {
    const body = z.object({ revision, skipQualification: z.boolean() }).strict().parse(req.body),
      workspace = owned(req, res, body.revision);
    if (!workspace.stops.length)
      throw new StudioError(
        400,
        'Add at least one destination to your brief or route before continuing.',
      );
    workspace.qualification = qualifyStudio(workspace, store.getAgency(session(res).owner_id));
    workspace.qualification.skipped = body.skipQualification;
    workspace.stage = 'structure';
    workspace.structureAccepted = false;
    res.json({ workspace: save(res, workspace, body.revision) });
  });
  app.post('/api/studio/workspaces/:id/accept-structure', (req, res) => {
    const body = z.object({ revision }).strict().parse(req.body),
      workspace = owned(req, res, body.revision);
    if (!workspace.stops.length)
      throw new StudioError(400, 'Add a destination before approving the route.');
    const end = workspace.stops.at(-1)?.departureDate;
    if (end && workspace.brief.endDate && end !== workspace.brief.endDate)
      throw new StudioError(
        400,
        'The route end differs from the requested end date. Adjust the nights or the brief before approving.',
      );
    workspace.structureAccepted = true;
    workspace.stage = 'itinerary';
    res.json({ workspace: save(res, workspace, body.revision) });
  });
  app.post('/api/studio/workspaces/:id/itinerary', limiter, async (req, res) => {
    const body = actionSchema
      .extend({ instructions: z.string().trim().max(4000).default('') })
      .parse(req.body);
    await action(req, res, 'itinerary', body, async (workspace, signal) => {
      workspace.itinerary = await generateStudioItinerary(workspace, body.instructions, signal);
      workspace.stage = 'itinerary';
      return { nextAction: 'itinerary', days: workspace.itinerary.days.length };
    });
  });
  app.post('/api/studio/workspaces/:id/recommendations', limiter, async (req, res) => {
    const body = actionSchema
      .extend({
        category: z.enum(['activity', 'food']),
        stopIds: z.array(z.string().min(1).max(80)).min(1).max(20),
        interests: z.string().trim().min(1).max(2000),
      })
      .parse(req.body);
    await action(req, res, 'recommendations', body, async (workspace, signal) => {
      const recommendations = await studioRecommendations(
        workspace,
        body.stopIds,
        body.category,
        body.interests,
        signal,
      );
      replaceStudioRecommendations(workspace, body.stopIds, body.category, recommendations);
      workspace.stage = 'recommendations';
      return { count: recommendations.length };
    });
  });
  app.post('/api/studio/import/preview', limiter, async (req, res) => {
    const body = studioImportSchema.parse(req.body);
    requireActiveSession(res);
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once('close', onClose);
    try {
      const imported = await parseStudioImport(
        body,
        store.getAgency(session(res).owner_id),
        controller.signal,
      );
      requireActiveSession(res);
      res.json({ import: imported });
    } finally {
      res.off('close', onClose);
    }
  });
  app.post('/api/studio/workspaces/:id/import', async (req, res) => {
    const { revision: expected, ...input } = z
      .object({
        revision,
        kind: z.enum(['text', 'image', 'pdf', 'url', 'audio']),
        name: z.string().max(160),
        text: z.string().min(1).max(30000),
        sourceUrl: z.string().max(2048).optional(),
      })
      .strict()
      .parse(req.body);
    const workspace = owned(req, res, expected);
    if (workspace.imports.length >= 20)
      throw new StudioError(400, 'A workspace can hold up to 20 source documents.');
    if (
      workspace.imports.reduce((sum, item) => sum + item.text.length, 0) + input.text.length >
      120000
    )
      throw new StudioError(400, 'Keep source text under 120,000 characters per workspace.');
    const imported = await parseStudioImport(input, store.getAgency(session(res).owner_id));
    workspace.imports.push(imported);
    res.json({ workspace: save(res, workspace, expected), import: imported });
  });
  app.delete('/api/studio/workspaces/:id/imports/:importId', (req, res) => {
    const body = z.object({ revision }).strict().parse(req.body),
      workspace = owned(req, res, body.revision);
    workspace.imports = workspace.imports.filter((doc) => doc.id !== String(req.params.importId));
    res.json({ workspace: save(res, workspace, body.revision) });
  });
  app.post('/api/studio/workspaces/:id/imports/:importId/extract', limiter, async (req, res) => {
    const body = actionSchema.parse(req.body);
    // Include the source identifier in the fingerprint to reject a cross-source replay.
    await action(
      req,
      res,
      `extract:${String(req.params.importId)}`,
      body,
      async (workspace, signal) => {
        if (!workspace.structureAccepted)
          throw new StudioError(409, 'Approve the route before extracting arrangements.');
        const doc = workspace.imports.find((item) => item.id === String(req.params.importId));
        if (!doc) throw new StudioError(404, 'Imported source not found.');
        if (doc.warnings.includes('Arrangements already extracted for review.'))
          throw new StudioError(
            409,
            'Arrangements from this source are already in your review list.',
          );
        const items = await extractStudioArrangements(
          workspace,
          doc,
          store.getAgency(session(res).owner_id),
          signal,
        );
        if (workspace.items.length + items.length > 150)
          throw new StudioError(400, 'Keep at most 150 proposal items.');
        workspace.items.push(...items);
        doc.warnings.push('Arrangements already extracted for review.');
        return { count: items.length };
      },
    );
  });
  return controls;
}
