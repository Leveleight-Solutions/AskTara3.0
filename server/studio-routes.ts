import type { Express, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import type { StudioClient, StudioWorkspace } from '../shared/studio.ts';
import { StudioStore, StudioError, newStudioWorkspace } from './studio-store.ts';
import {
  applyStudioPatch,
  qualifyStudio,
  studioAgencySchema,
  studioPatchSchema,
  studioBriefSchema,
  studioStopSchema,
  structureFingerprint,
  replaceStudioRecommendations,
} from './studio-domain.ts';
import { studioRecommendations, extractStudioArrangements } from './studio-models.ts';
import { parseStudioImport, studioImportSchema, StudioImportError } from './studio-imports.ts';
import { planningFailureReason } from './agents/failures.ts';
import { OpenAIPlanningError } from './agents/openai.ts';
import { runStudioAssistant } from './studio-assistant.ts';
import { hasRedactedStudioIdentifier } from './studio-privacy.ts';
import { generateStudioItinerary, studioTripEndConflicts } from './studio-itinerary.ts';
import {
  installStudioClientRoutes,
  getStudioClientProfile,
  studioClientTravelHistory,
} from './studio-clients.ts';
import {
  researchStudioDestinations,
  checkStudioEntryRequirements,
  studioDestinationResearchInputKey,
  studioCandidateEntryResearchInputKey,
  researchStudioCandidateEntryRequirements,
} from './studio-travel-research.ts';
import { buildStudioAssistantActions } from '../shared/studio-assistant.ts';
import { evidenceUrl } from './agents/openai.ts';
import { extractStudioCruise } from './studio-cruise.ts';
import {
  studioCruiseDraftSchema,
  cruiseDraftToItinerary,
  cruiseIsoDate,
} from '../shared/studio-cruise.ts';
import { studioItinerarySchema } from '../shared/studio-itinerary.ts';
import { redactIdentityAndPayment } from './studio-imports.ts';
import { researchStudioTripBriefing, mergeStudioTripBriefing } from './studio-trip-briefing.ts';
import {
  studioTripBriefingInputKey,
  type StudioTripBriefing,
} from '../shared/studio-trip-briefing.ts';
import { studioDestinationResearchFresh } from '../shared/studio-travel-research.ts';

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
type ActionOptions = {
  merge?: (
    current: StudioWorkspace,
    researched: StudioWorkspace,
    result: Record<string, unknown>,
  ) => StudioWorkspace;
  skipSave?: (current: StudioWorkspace, result: Record<string, unknown>) => boolean;
  abortOnDisconnect?: boolean;
};

export function installStudioRoutes(app: Express, deps: Dependencies) {
  const { db, store, session, requireActiveSession } = deps;
  installStudioClientRoutes(app, deps);
  const active = new Map<
    string,
    {
      sessionId: string;
      ownerId: string;
      workspaceId: string;
      kind: string;
      briefingInputKey: string;
      controller: AbortController;
      promise: Promise<ActionResult>;
    }
  >();
  const briefingJobs = new Map<
    string,
    {
      controller: AbortController;
      consumers: number;
      promise: ReturnType<typeof researchStudioTripBriefing>;
    }
  >();
  const candidateEntryJobs = new Map<
    string,
    {
      controller: AbortController;
      consumers: number;
      promise: ReturnType<typeof researchStudioCandidateEntryRequirements>;
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
    cancelStaleBriefings(ownerId: string, workspace: StudioWorkspace) {
      const inputKey = studioTripBriefingInputKey(workspace);
      for (const run of active.values())
        if (
          run.ownerId === ownerId &&
          run.workspaceId === workspace.id &&
          run.kind === 'trip-briefing' &&
          run.briefingInputKey !== inputKey
        )
          run.controller.abort(
            new StudioError(
              409,
              'The trip details changed while research was running. The old results were not saved.',
              'STUDIO_BRIEFING_STALE',
            ),
          );
      const candidateKey = workspace.destinationResearch
        ? studioCandidateEntryResearchInputKey(workspace, workspace.destinationResearch)
        : '';
      for (const run of active.values())
        if (
          run.ownerId === ownerId &&
          run.workspaceId === workspace.id &&
          run.kind === 'candidate-entry-requirements' &&
          run.briefingInputKey !== candidateKey
        )
          run.controller.abort(
            new StudioError(
              409,
              'The passport, trip details or suggestions changed while entry checks were running.',
              'STUDIO_RESEARCH_STALE',
            ),
          );
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
    keyGenerator: (_req, res) => session(res).owner_id,
    message: { error: 'Please wait a moment before starting another research or import request.' },
  });
  const conversationLimiter = rateLimit({
    windowMs: 60000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (_req, res) => session(res).owner_id,
    message: { error: 'Please wait a moment before sending another message to Tara.' },
  });
  const owned = (req: Request, res: Response, expected?: number) =>
    store.require(session(res).owner_id, String(req.params.id), expected);
  const save = (res: Response, workspace: StudioWorkspace, expected: number) => {
    requireActiveSession(res);
    const ownerId = session(res).owner_id;
    const result = store.save(ownerId, workspace, expected);
    controls.cancelStaleBriefings(ownerId, result);
    return result;
  };
  async function action(
    req: Request,
    res: Response,
    kind: string,
    body: { revision: number; requestId: string },
    execute: (workspace: StudioWorkspace, signal: AbortSignal) => Promise<Record<string, unknown>>,
    options?: ActionOptions,
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
        const latest = store.require(current.owner_id, workspaceId);
        options?.merge?.({ ...latest }, cached.workspace, cached);
        return res.json({
          ...cached,
          workspace: latest,
          assistantActions: buildStudioAssistantActions(latest),
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
    const disconnected = () => {
      if (!res.writableEnded)
        controller.abort(
          new StudioError(
            503,
            'The background trip check was cancelled. Your saved workspace is unchanged.',
            'STUDIO_BRIEFING_CANCELLED',
          ),
        );
    };
    if (options?.abortOnDisconnect) res.once('close', disconnected);
    const timeout = setTimeout(() => controller.abort(), 300000);
    timeout.unref();
    const promise = (async () => {
      try {
        const extra = await execute(workspace, controller.signal);
        controller.signal.throwIfAborted();
        requireActiveSession(res);
        db.exec('BEGIN IMMEDIATE');
        try {
          const latest = options?.merge ? store.require(current.owner_id, workspaceId) : null;
          const unchanged = latest && options?.skipSave?.(latest, extra);
          const merged = latest ? options!.merge!({ ...latest }, workspace, extra) : workspace;
          const savedWorkspace = unchanged
            ? latest!
            : store.save(current.owner_id, merged, latest?.revision ?? body.revision);
          const result = {
            ...extra,
            workspace: savedWorkspace,
            assistantActions: buildStudioAssistantActions(savedWorkspace),
          };
          db.prepare(
            "UPDATE studio_requests SET status='completed',result=? WHERE owner_id=? AND request_id=?",
          ).run(JSON.stringify(result), current.owner_id, body.requestId);
          db.exec('COMMIT');
          controls.cancelStaleBriefings(current.owner_id, savedWorkspace);
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      } catch (error) {
        db.prepare(
          "UPDATE studio_requests SET status='failed' WHERE owner_id=? AND request_id=?",
        ).run(current.owner_id, body.requestId);
        if (controller.signal.aborted && controller.signal.reason instanceof StudioError)
          throw controller.signal.reason;
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
        if (options?.abortOnDisconnect) res.off('close', disconnected);
        active.delete(key);
      }
    })();
    active.set(key, {
      sessionId: current.id,
      ownerId: current.owner_id,
      workspaceId,
      kind,
      briefingInputKey:
        kind === 'trip-briefing'
          ? studioTripBriefingInputKey(workspace)
          : kind === 'candidate-entry-requirements' && workspace.destinationResearch
            ? studioCandidateEntryResearchInputKey(workspace, workspace.destinationResearch)
            : '',
      controller,
      promise,
    });
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
    const body = z
      .object({
        clientId: z.string().uuid().optional(),
        title: z.string().trim().min(1).max(300).optional(),
        brief: studioBriefSchema.partial().optional(),
        stops: z.array(studioStopSchema).max(20).optional(),
      })
      .strict()
      .parse(req.body || {});
    requireActiveSession(res);
    const ownerId = session(res).owner_id;
    if (body.clientId && body.brief?.clientId && body.clientId !== body.brief.clientId)
      throw new StudioError(400, 'Choose one client profile for the new trip.');
    const clientId = body.clientId || body.brief?.clientId || '';
    const profile = clientId ? getStudioClientProfile(db, ownerId, clientId) : null;
    if (clientId && !profile) throw new StudioError(404, 'Client profile not found.');
    const workspace = newStudioWorkspace();
    if (profile)
      Object.assign(workspace.brief, {
        clientId: profile.id,
        clientName: profile.name,
        context: profile.context,
        passportNationality: profile.passportNationality,
        interests: profile.interests,
        foodPreferences: profile.foodPreferences,
      });
    applyStudioPatch(
      workspace,
      {
        revision: workspace.revision,
        ...(body.title
          ? { title: body.title }
          : profile
            ? { title: `${profile.name} — new proposal` }
            : {}),
        ...(body.brief ? { brief: body.brief } : {}),
        ...(body.stops ? { stops: body.stops } : {}),
      },
      store.getAgency(ownerId),
    );
    db.exec('BEGIN IMMEDIATE');
    try {
      store.create(ownerId, workspace);
      store.save(ownerId, workspace, workspace.revision);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json({ workspace, assistantActions: buildStudioAssistantActions(workspace) });
  });
  app.get('/api/studio/workspaces/:id', (req, res) => {
    const workspace = owned(req, res);
    res.json({ workspace, assistantActions: buildStudioAssistantActions(workspace) });
  });
  app.patch('/api/studio/workspaces/:id', (req, res) => {
    const body = studioPatchSchema.parse(req.body),
      workspace = owned(req, res, body.revision);
    if (
      body.brief?.clientId &&
      !getStudioClientProfile(db, session(res).owner_id, body.brief.clientId)
    )
      throw new StudioError(404, 'Client profile not found.');
    if (
      body.itinerary?.days.some(
        (day) => day.cruiseId && !workspace.cruises?.some((cruise) => cruise.id === day.cruiseId),
      )
    )
      throw new StudioError(400, 'Daily plan refers to an unknown cruise.');
    applyStudioPatch(workspace, body, store.getAgency(session(res).owner_id));
    const saved = save(res, workspace, body.revision);
    res.json({ workspace: saved, assistantActions: buildStudioAssistantActions(saved) });
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
      const key = workspace.brief.clientId || `unlinked:${name.toLowerCase()}`;
      const client = groups.get(key) || {
        ...(workspace.brief.clientId ? { id: workspace.brief.clientId } : {}),
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
  app.post('/api/studio/workspaces/:id/review', conversationLimiter, async (req, res) => {
    const body = actionSchema
      .extend({ message: z.string().trim().min(1).max(16000) })
      .parse(req.body);
    body.message = redactIdentityAndPayment(body.message);
    await action(req, res, 'review', body, async (workspace, signal) => {
      const result = await runStudioAssistant(
        workspace,
        body.message,
        store.getAgency(session(res).owner_id),
        signal,
        studioClientTravelHistory(
          db,
          store,
          session(res).owner_id,
          workspace.brief.clientId || '',
          workspace.id,
        ),
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
    if (!workspace.stops.length && !workspace.cruises?.length)
      throw new StudioError(400, 'Add a destination before approving the route.');
    if (studioTripEndConflicts(workspace))
      throw new StudioError(
        400,
        'The route end differs from the requested end date. Adjust the nights or the brief before approving.',
      );
    workspace.structureAccepted = true;
    workspace.stage = 'services';
    res.json({ workspace: save(res, workspace, body.revision) });
  });
  app.post('/api/studio/workspaces/:id/itinerary', limiter, async (req, res) => {
    const body = actionSchema
      .extend({ instructions: z.string().trim().max(4000).default('') })
      .parse(req.body);
    await action(req, res, 'itinerary', body, async (workspace, signal) => {
      workspace.itinerary = await generateStudioItinerary(
        workspace,
        body.instructions,
        signal,
        studioClientTravelHistory(
          db,
          store,
          session(res).owner_id,
          workspace.brief.clientId || '',
          workspace.id,
        ),
      );
      workspace.itineraryManual = workspace.itinerary.days.some((day) => Boolean(day.cruiseId));
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
        studioClientTravelHistory(
          db,
          store,
          session(res).owner_id,
          workspace.brief.clientId || '',
          workspace.id,
        ),
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
  app.post('/api/studio/workspaces/:id/destinations/research', limiter, async (req, res) => {
    const body = actionSchema.parse(req.body);
    const historyFor = (workspace: StudioWorkspace) =>
      studioClientTravelHistory(
        db,
        store,
        session(res).owner_id,
        workspace.brief.clientId || '',
        workspace.id,
      );
    const profileFor = (workspace: StudioWorkspace) =>
      workspace.brief.clientId
        ? getStudioClientProfile(db, session(res).owner_id, workspace.brief.clientId) || undefined
        : undefined;
    await action(
      req,
      res,
      'destination-research',
      body,
      async (workspace, signal) => {
        const history = studioClientTravelHistory(
          db,
          store,
          session(res).owner_id,
          workspace.brief.clientId || '',
          workspace.id,
        );
        const inputKey = studioDestinationResearchInputKey(
          workspace,
          history,
          profileFor(workspace),
        );
        workspace.destinationResearch = await researchStudioDestinations(
          workspace,
          history,
          signal,
        );
        workspace.destinationResearch.inputKey = inputKey;
        return { research: workspace.destinationResearch };
      },
      {
        abortOnDisconnect: true,
        merge: (current, _researched, result) => {
          const research = result.research as NonNullable<StudioWorkspace['destinationResearch']>;
          if (
            research.inputKey !==
            studioDestinationResearchInputKey(current, historyFor(current), profileFor(current))
          )
            throw new StudioError(
              409,
              'The client preferences or route changed while suggestions were researched.',
              'STUDIO_RESEARCH_STALE',
            );
          current.destinationResearch = research;
          return current;
        },
        skipSave: (current, result) =>
          JSON.stringify(current.destinationResearch) === JSON.stringify(result.research),
      },
    );
  });
  app.post(
    '/api/studio/workspaces/:id/destinations/entry-requirements',
    limiter,
    async (req, res) => {
      const body = actionSchema.parse(req.body);
      const researchContext = (workspace: StudioWorkspace) => {
        const history = studioClientTravelHistory(
          db,
          store,
          session(res).owner_id,
          workspace.brief.clientId || '',
          workspace.id,
        );
        const profile = workspace.brief.clientId
          ? getStudioClientProfile(db, session(res).owner_id, workspace.brief.clientId) || undefined
          : undefined;
        const research = workspace.destinationResearch;
        if (
          !research ||
          !studioDestinationResearchFresh(research) ||
          research.inputKey !== studioDestinationResearchInputKey(workspace, history, profile)
        )
          throw new StudioError(
            409,
            'The client preferences changed. Refresh suggestions before checking entry requirements.',
            'STUDIO_RESEARCH_STALE',
          );
        return {
          research,
          inputKey: studioCandidateEntryResearchInputKey(workspace, research, profile),
        };
      };
      await action(
        req,
        res,
        'candidate-entry-requirements',
        body,
        async (workspace, signal) => {
          const context = researchContext(workspace);
          const jobKey = JSON.stringify([session(res).owner_id, workspace.id, context.inputKey]);
          let job = candidateEntryJobs.get(jobKey);
          if (!job) {
            const controller = new AbortController();
            job = {
              controller,
              consumers: 0,
              promise: researchStudioCandidateEntryRequirements(workspace, controller.signal),
            };
            candidateEntryJobs.set(jobKey, job);
            void job.promise
              .finally(() => {
                if (candidateEntryJobs.get(jobKey) === job) candidateEntryJobs.delete(jobKey);
              })
              .catch(() => {});
          }
          const shared = job;
          shared.consumers++;
          let released = false;
          let abort!: () => void;
          const release = () => {
            if (released) return;
            released = true;
            shared.consumers--;
            if (!shared.consumers) shared.controller.abort(signal.reason);
          };
          const cancelled = new Promise<never>((_resolve, reject) => {
            abort = () => {
              release();
              reject(signal.reason);
            };
            if (signal.aborted) abort();
            else signal.addEventListener('abort', abort, { once: true });
          });
          try {
            const research = await Promise.race([shared.promise, cancelled]);
            signal.throwIfAborted();
            return { research, candidateEntryInputKey: context.inputKey };
          } finally {
            signal.removeEventListener('abort', abort);
            release();
          }
        },
        {
          abortOnDisconnect: true,
          merge: (current, _researched, result) => {
            if (result.candidateEntryInputKey !== researchContext(current).inputKey)
              throw new StudioError(
                409,
                'The passport, profile or trip details changed while entry checks were researched.',
                'STUDIO_RESEARCH_STALE',
              );
            const research = result.research as NonNullable<StudioWorkspace['destinationResearch']>;
            current.destinationResearch = research;
            return current;
          },
          skipSave: (current, result) =>
            JSON.stringify(current.destinationResearch) === JSON.stringify(result.research),
        },
      );
    },
  );
  app.post(
    '/api/studio/workspaces/:id/recommendations/:recommendationId/add-to-day',
    (req, res) => {
      const body = z
        .object({
          revision,
          day: z.number().int().min(1).max(366),
          period: z.enum(['morning', 'afternoon', 'evening', 'flexible']),
        })
        .strict()
        .parse(req.body);
      const current = owned(req, res);
      if (!current.structureAccepted || !current.itinerary)
        throw new StudioError(
          409,
          'Confirm the route and create a daily itinerary before adding ideas.',
        );
      const recommendation = current.recommendations.find(
        (item) => item.id === String(req.params.recommendationId),
      );
      if (!recommendation) throw new StudioError(404, 'Recommendation not found.');
      const day = current.itinerary.days.find((item) => item.day === body.day);
      if (!day) throw new StudioError(404, 'Itinerary day not found.');
      if (recommendation.stopId && !day.stopIds.includes(recommendation.stopId))
        throw new StudioError(400, 'Choose an itinerary day at this recommendation’s destination.');
      const copied = {
        period: body.period,
        title: recommendation.name.slice(0, 200),
        description: recommendation.description.slice(0, 1200),
        sources: recommendation.sources
          .filter(
            (source) =>
              evidenceUrl(source.url) &&
              Number.isFinite(Date.parse(source.checkedAt)) &&
              Date.parse(source.checkedAt) <= Date.now() + 60000,
          )
          .slice(0, 5)
          .map((source) => ({
            label: source.label.slice(0, 200),
            url: evidenceUrl(source.url)!,
            checkedAt: source.checkedAt,
          })),
      };
      if (!copied.sources.length)
        throw new StudioError(
          409,
          'This recommendation has no verified stored source. Research it again.',
        );
      if (day.activities.some((activity) => JSON.stringify(activity) === JSON.stringify(copied))) {
        res.json({
          workspace: current,
          inserted: false,
          assistantActions: buildStudioAssistantActions(current),
        });
        return;
      }
      store.require(session(res).owner_id, current.id, body.revision);
      if (day.activities.length >= 20)
        throw new StudioError(400, 'Keep at most 20 activities on this day.');
      day.activities.push(copied);
      recommendation.included = true;
      current.itineraryManual = true;
      const saved = save(res, current, body.revision);
      res.json({
        workspace: saved,
        inserted: true,
        assistantActions: buildStudioAssistantActions(saved),
      });
    },
  );
  app.post('/api/studio/workspaces/:id/entry-requirements', limiter, async (req, res) => {
    const body = actionSchema.extend({ stopId: z.string().max(80).optional() }).parse(req.body);
    await action(req, res, 'entry-requirements', body, async (workspace, signal) => {
      const result = await checkStudioEntryRequirements(workspace, signal, body.stopId);
      workspace.entryRequirements = [
        ...(workspace.entryRequirements || []).filter((value) => value.stopId !== result.stopId),
        result,
      ].slice(-20);
      return { entryRequirements: result };
    });
  });
  app.post('/api/studio/workspaces/:id/trip-briefing', limiter, async (req, res) => {
    const body = actionSchema.extend({ force: z.boolean().optional() }).parse(req.body);
    await action(
      req,
      res,
      'trip-briefing',
      body,
      async (workspace, signal) => {
        const jobKey = JSON.stringify([
          session(res).owner_id,
          workspace.id,
          studioTripBriefingInputKey(workspace),
        ]);
        let job = briefingJobs.get(jobKey);
        if (!job) {
          const controller = new AbortController();
          job = {
            controller,
            consumers: 0,
            promise: researchStudioTripBriefing(workspace, controller.signal, {
              force: body.force,
            }),
          };
          briefingJobs.set(jobKey, job);
          void job.promise
            .finally(() => {
              if (briefingJobs.get(jobKey) === job) briefingJobs.delete(jobKey);
            })
            .catch(() => {});
        }
        // A shared owner-scoped job survives one disconnected subscriber, but stops
        // when its final caller leaves. Each caller still cancels its own action.
        const shared = job;
        shared.consumers++;
        let released = false;
        let abort!: () => void;
        const release = () => {
          if (released) return;
          released = true;
          shared.consumers--;
          if (!shared.consumers) shared.controller.abort(signal.reason);
        };
        const cancelled = new Promise<never>((_resolve, reject) => {
          abort = () => {
            release();
            reject(signal.reason);
          };
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        });
        try {
          const result = await Promise.race([shared.promise, cancelled]);
          signal.throwIfAborted();
          return result;
        } finally {
          signal.removeEventListener('abort', abort);
          release();
        }
      },
      {
        abortOnDisconnect: true,
        merge: (current, _researched, result) =>
          mergeStudioTripBriefing(current, result.briefing as StudioTripBriefing),
        skipSave: (current, result) => {
          const briefing = result.briefing as StudioTripBriefing;
          return JSON.stringify(current.tripBriefing) === JSON.stringify(briefing);
        },
      },
    );
  });
  app.post('/api/studio/workspaces/:id/cruises/preview', limiter, async (req, res) => {
    const body = actionSchema.extend({ input: studioImportSchema }).parse(req.body);
    await action(req, res, 'cruise-preview', body, async (_workspace, signal) => ({
      cruise: await extractStudioCruise(body.input, store.getAgency(session(res).owner_id), signal),
    }));
  });
  app.post('/api/studio/workspaces/:id/cruises/apply', (req, res) => {
    const body = z.object({ revision, cruise: studioCruiseDraftSchema }).strict().parse(req.body);
    const workspace = owned(req, res, body.revision),
      cruise = body.cruise;
    const oldCruise = workspace.cruises?.find((value) => value.id === cruise.id);
    const oldSourceDays = oldCruise?.days || [];
    const matchedSourceDays = new Map<string, number>();
    const usedSourceIndexes = new Set<number>();
    cruise.days = cruise.days.map((day) => {
      const uniqueIndex = (matches: (candidate: typeof day) => boolean) => {
        const indexes = oldSourceDays.flatMap((candidate, index) =>
          matches(candidate) ? [index] : [],
        );
        return indexes.length === 1 &&
          cruise.days.filter(matches).length === 1 &&
          !usedSourceIndexes.has(indexes[0])
          ? indexes[0]
          : -1;
      };
      // Explicit IDs survive source edits. Legacy drafts may only match a unique literal row.
      let oldIndex = day.id ? uniqueIndex((candidate) => candidate.id === day.id) : -1;
      if (!day.id) {
        oldIndex = uniqueIndex(
          (candidate) => candidate.date === day.date && candidate.port === day.port,
        );
        if (oldIndex < 0 && day.date)
          oldIndex = uniqueIndex((candidate) => candidate.date === day.date);
        if (oldIndex < 0) oldIndex = uniqueIndex((candidate) => candidate.port === day.port);
      }
      const id = day.id || (oldIndex >= 0 ? oldSourceDays[oldIndex].id : undefined) || randomUUID();
      if (oldIndex >= 0) {
        matchedSourceDays.set(id, oldIndex);
        usedSourceIndexes.add(oldIndex);
      }
      return { ...day, id };
    });
    const selected = cruise.days.slice(0, cruise.disembarkAfterDay ?? cruise.days.length);
    const early = selected.length < cruise.days.length;
    const cruiseStartsTrip = !workspace.stops.length && !workspace.itinerary?.days.length;
    const oldNotes = oldCruise ? cruiseDraftToItinerary(oldCruise).notes : [];
    const schedule = (value: typeof cruise) =>
      JSON.stringify([
        value.days.map(({ day, date, port, arrival, departure }) => ({
          day,
          date,
          port,
          arrival,
          departure,
        })),
        value.disembarkAfterDay,
        value.onwardTransport,
        value.returnTransport,
      ]);
    const reconcileRoute = oldCruise
      ? schedule(oldCruise) !== schedule(cruise)
      : workspace.stops.length > 0;
    const originalItems = new Map(workspace.items.map((item) => [item.id, item]));
    workspace.cruises = [
      ...(workspace.cruises || []).filter((value) => value.id !== cruise.id),
      cruise,
    ];
    if (workspace.cruises.length > 20)
      throw new StudioError(400, 'Keep at most 20 cruise plans per workspace.');
    const plan = cruiseDraftToItinerary(
      cruise,
      selected.map(
        (day) =>
          workspace.stops.find((stop) => stop.name.toLowerCase() === day.port.toLowerCase())?.id ||
          '',
      ),
    );
    const previous = workspace.itinerary;
    const previousCruiseDays = (previous?.days || []).filter((day) => day.cruiseId === cruise.id);
    const oldPlan = oldCruise ? cruiseDraftToItinerary(oldCruise) : null;
    const usedEditedDays = new Set<(typeof previousCruiseDays)[number]>();
    plan.days = plan.days.map((day, index) => {
      const oldIndex = matchedSourceDays.get(cruise.days[index].id!);
      const original = oldIndex === undefined ? undefined : oldPlan?.days[oldIndex];
      if (!original || oldIndex === undefined) return day;
      const uniqueEdited = (matches: (candidate: typeof day) => boolean) => {
        const candidates = previousCruiseDays.filter(matches);
        return candidates.length === 1 && !usedEditedDays.has(candidates[0])
          ? candidates[0]
          : undefined;
      };
      let edited = original.cruiseDayId
        ? uniqueEdited((candidate) => candidate.cruiseDayId === original.cruiseDayId)
        : undefined;
      if (!edited) {
        const legacy = (candidate: typeof day) => !candidate.cruiseDayId;
        if (
          oldPlan!.days.filter(
            (value) => value.date === original.date && value.title === original.title,
          ).length === 1
        )
          edited = uniqueEdited(
            (candidate) =>
              (legacy(candidate) || hasRedactedStudioIdentifier(candidate.cruiseDayId)) &&
              candidate.date === original.date &&
              candidate.title === original.title,
          );
        if (
          !edited &&
          original.date &&
          oldPlan!.days.filter((value) => value.date === original.date).length === 1
        )
          edited = uniqueEdited(
            (candidate) => legacy(candidate) && candidate.date === original.date,
          );
        if (!edited && oldPlan!.days.filter((value) => value.title === original.title).length === 1)
          edited = uniqueEdited(
            (candidate) => legacy(candidate) && candidate.title === original.title,
          );
      }
      if (!edited) return day;
      usedEditedDays.add(edited);
      const literalDay = (value: (typeof cruise.days)[number]) =>
        JSON.stringify([value.date, value.port, value.arrival, value.departure, value.details]);
      if (oldCruise && literalDay(oldCruise.days[oldIndex]) === literalDay(cruise.days[index]))
        return {
          ...edited,
          cruiseDayId: day.cruiseDayId,
          day: day.day,
          // Update an early-disembarkation notice without erasing an agent's own summary.
          summary: edited.summary === original.summary ? day.summary : edited.summary,
        };
      // Refresh changed source details while retaining separately authored activities for review.
      const manualActivities = edited.activities.filter(
        (activity) =>
          !original.activities.some(
            (source) => JSON.stringify(source) === JSON.stringify(activity),
          ),
      );
      return { ...day, activities: [...day.activities, ...manualActivities] };
    });
    const firstIndex = previous?.days.findIndex((day) => day.cruiseId === cruise.id) ?? -1;
    const remaining = (previous?.days || []).filter((day) => day.cruiseId !== cruise.id);
    remaining.splice(
      firstIndex < 0 ? remaining.length : Math.min(firstIndex, remaining.length),
      0,
      ...plan.days,
    );
    const chronological = (days: typeof remaining) =>
      days.every(
        (day, index) =>
          Boolean(cruiseIsoDate(day.date)) && (!index || day.date >= days[index - 1].date),
      );
    const landDays = (previous?.days || []).filter((day) => day.cruiseId !== cruise.id);
    // Merge fully dated sequences by calendar date, preserving the order within each sequence.
    // Incomplete or nonchronological source dates remain in their reviewed source order.
    if (chronological(landDays) && chronological(plan.days))
      remaining.sort((left, right) => left.date.localeCompare(right.date));
    workspace.itinerary = studioItinerarySchema.parse({
      generatedAt: new Date().toISOString(),
      days: remaining.map((day, index) => ({ ...day, day: index + 1 })),
      notes: [
        ...new Set([
          ...(previous?.notes || []).filter((note) => !oldNotes.includes(note)),
          ...workspace.cruises.flatMap((value) => cruiseDraftToItinerary(value).notes),
        ]),
      ].slice(-20),
    });
    workspace.itineraryManual = true;
    const itemId = `cruise:${cruise.id}`,
      onwardId = `cruise-onward:${cruise.id}`,
      returnId = `cruise-return:${cruise.id}`;
    workspace.items = workspace.items.filter(
      (item) => ![itemId, onwardId, returnId].includes(item.id),
    );
    const validDate = cruiseIsoDate;
    workspace.items.push({
      id: itemId,
      kind: 'cruise',
      title: cruise.name,
      description: [
        cruise.ship,
        `${cruise.days.length}-day full voyage; ${selected.length} days included in this plan.`,
        early
          ? `Early disembarkation at ${selected.at(-1)!.port}. Full fare retained; no segment refund. Confirm permission with the cruise line.`
          : 'Full cruise fare retained.',
        cruise.returnTransport !== 'undecided'
          ? `Return by ${cruise.returnTransport}, arranged separately.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      stopId: '',
      startDate: validDate(selected[0].date),
      endDate: validDate(selected.at(-1)!.date),
      status: 'suggested',
      source: 'manual',
      sourceUrl: cruise.sourceUrl,
      supplier: cruise.ship,
      privateReference: '',
      price: cruise.fullFare,
      currency: cruise.currency,
      priceStatus: cruise.fullFare === null ? 'unpriced' : 'agent_estimate',
      quotedAt: '',
      included: true,
      needsReview: false,
      cost: null,
    });
    if (cruise.onwardTransport !== 'undecided')
      workspace.items.push({
        id: onwardId,
        kind: cruise.onwardTransport,
        title: `Onward ${cruise.onwardTransport} from ${selected.at(-1)!.port}`,
        description:
          'Arrange separately after disembarkation. Schedule, availability and fare are not confirmed.',
        stopId: '',
        startDate: validDate(selected.at(-1)!.date),
        endDate: '',
        status: 'placeholder',
        source: 'manual',
        sourceUrl: '',
        supplier: '',
        privateReference: '',
        price: null,
        currency: cruise.currency,
        priceStatus: 'unpriced',
        quotedAt: '',
        included: true,
        needsReview: false,
        cost: null,
      });
    if (cruise.returnTransport !== 'undecided')
      workspace.items.push({
        id: returnId,
        kind: cruise.returnTransport,
        title: `Return ${cruise.returnTransport}`,
        description:
          'Return journey to be arranged separately. Dates, schedule and fare are not confirmed.',
        stopId: '',
        startDate: '',
        endDate: '',
        status: 'placeholder',
        source: 'manual',
        sourceUrl: '',
        supplier: '',
        privateReference: '',
        price: null,
        currency: cruise.currency,
        priceStatus: 'unpriced',
        quotedAt: '',
        included: true,
        needsReview: false,
        cost: null,
      });
    workspace.items = workspace.items.map((item) => {
      if (![itemId, onwardId, returnId].includes(item.id)) return item;
      const previous = originalItems.get(item.id);
      if (!previous || previous.kind !== item.kind) return item;
      if (item.id === itemId)
        return {
          ...item,
          status: previous.status,
          privateReference: previous.privateReference,
          cost: previous.cost,
          supplier: cruise.ship || previous.supplier,
        };
      return { ...previous, needsReview: previous.needsReview || reconcileRoute };
    });
    for (const id of [onwardId, returnId]) {
      const old = originalItems.get(id),
        next = workspace.items.find((item) => item.id === id);
      if (
        old &&
        (!next || next.kind !== old.kind) &&
        (old.privateReference || old.status === 'externally_booked' || old.price !== null)
      )
        workspace.items.push({ ...old, id: randomUUID(), included: false, needsReview: true });
    }
    if (workspace.items.length > 150)
      throw new StudioError(400, 'Keep at most 150 proposal items.');
    if (reconcileRoute) {
      workspace.structureAccepted = false;
      workspace.stage = 'structure';
      workspace.items = workspace.items.map((item) => ({
        ...item,
        needsReview: item.included || item.needsReview,
      }));
      workspace.itinerary.notes = [
        ...new Set([
          ...workspace.itinerary.notes,
          'Cruise route changed. Review route stops, dates and linked services before accepting.',
        ]),
      ].slice(-20);
    }
    if (!workspace.stops.length) {
      const ports = selected.filter((day) => !/^at sea$|^cruising$|^sea day$/i.test(day.port));
      const route = ports.length > 20 ? [ports[0], ports.at(-1)!] : ports;
      workspace.stops = route.map((day) => ({
        id: randomUUID(),
        name: day.port.slice(0, 120),
        country: '',
        nights: 0,
        arrivalDate: validDate(day.date),
        arrivalFixed: Boolean(validDate(day.date)),
        departureDate: validDate(day.date),
        onwardTransport: 'other' as const,
        neighbourhood: '',
        notes: `Cruise port call: ${day.port}. See the daily cruise plan for arrival, departure and sailing days.`,
      }));
      if (!workspace.brief.startDate) workspace.brief.startDate = validDate(selected[0].date);
      if (!workspace.brief.endDate) workspace.brief.endDate = validDate(selected.at(-1)!.date);
      workspace.brief.preferredDestination = route[0]?.port || '';
      workspace.stage = 'structure';
      workspace.structureAccepted = false;
    }
    if (
      cruiseStartsTrip &&
      (!workspace.brief.outboundTransport || workspace.brief.outboundTransport === 'undecided')
    )
      workspace.brief.outboundTransport = 'cruise';
    if (cruise.returnTransport !== 'undecided')
      workspace.brief.returnTransport = cruise.returnTransport;
    workspace.qualification = qualifyStudio(workspace, store.getAgency(session(res).owner_id));
    workspace.entryRequirements = [];
    res.json({ workspace: save(res, workspace, body.revision) });
  });
  return controls;
}
