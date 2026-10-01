import { randomUUID } from 'node:crypto';
import type { Express, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { StudioClientProfile } from '../shared/studio-clients.ts';
import { normalizeStudioCountry } from '../shared/studio-travel-research.ts';
import { StudioError, type StudioStore } from './studio-store.ts';
import { redactIdentityAndPayment } from './studio-imports.ts';

const text = (max: number) => z.string().trim().max(max).transform(redactIdentityAndPayment);
export const studioClientProfileSchema = z
  .object({
    name: text(200).refine((v) => Boolean(v), 'Enter a client name.'),
    context: text(4000).default(''),
    passportNationality: z
      .string()
      .refine((v) => !v || Boolean(normalizeStudioCountry(v)))
      .transform((v) => normalizeStudioCountry(v)?.code || '')
      .default(''),
    photoDataUrl: z
      .string()
      .max(200000)
      .refine((value) => {
        if (!value) return true;
        const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
        if (!match) return false;
        const bytes = Buffer.from(match[2], 'base64');
        return match[1] === 'png'
          ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : match[1] === 'jpeg'
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      }, 'Choose a small PNG, JPEG or WebP photo.')
      .default(''),
    interests: z.array(text(200)).max(30).default([]),
    foodPreferences: z.array(text(200)).max(30).default([]),
    history: z
      .array(
        z
          .object({
            destination: text(200),
            country: text(100).optional(),
            visitedAt: text(40).optional(),
            interests: z.array(text(200)).max(30).optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();

export function listStudioClientProfiles(db: DatabaseSync, ownerId: string): StudioClientProfile[] {
  return db
    .prepare('SELECT data FROM studio_clients WHERE owner_id=? ORDER BY updated_at DESC LIMIT 500')
    .all(ownerId)
    .map((row) => JSON.parse(String(row.data)));
}
export function getStudioClientProfile(
  db: DatabaseSync,
  ownerId: string,
  id: string,
): StudioClientProfile | undefined {
  const row = db
    .prepare('SELECT data FROM studio_clients WHERE owner_id=? AND id=?')
    .get(ownerId, id);
  return row ? JSON.parse(String(row.data)) : undefined;
}
export function studioClientTravelHistory(
  db: DatabaseSync,
  store: StudioStore,
  ownerId: string,
  clientId: string,
  currentId: string,
) {
  if (!clientId) return [];
  const profile = getStudioClientProfile(db, ownerId, clientId);
  if (!profile) return [];
  const today = new Date().toISOString().slice(0, 10);
  const trips = store
    .list(ownerId)
    .filter(
      (w) =>
        w.id !== currentId &&
        w.brief.clientId === clientId &&
        w.brief.endDate &&
        w.brief.endDate < today,
    );
  return [
    ...profile.history,
    ...trips.flatMap((w) =>
      w.stops.map((s) => ({
        destination: s.name,
        country: s.country,
        visitedAt: w.brief.endDate,
        interests: w.brief.interests,
      })),
    ),
  ].slice(-100);
}
export function installStudioClientRoutes(
  app: Express,
  deps: {
    db: DatabaseSync;
    store: StudioStore;
    session: (res: Response) => { owner_id: string };
    requireActiveSession: (res: Response) => void;
  },
) {
  const { db, store, session, requireActiveSession } = deps;
  app.get('/api/studio/client-profiles', (_req, res) => {
    const owner = session(res).owner_id;
    const trips = store.list(owner),
      today = new Date().toISOString().slice(0, 10);
    res.json({
      clients: listStudioClientProfiles(db, owner).map((client) => ({
        ...client,
        previousTripCount: trips.filter(
          (trip) =>
            trip.brief.clientId === client.id && trip.brief.endDate && trip.brief.endDate < today,
        ).length,
      })),
    });
  });
  app.post('/api/studio/client-profiles', (req, res) => {
    const data = studioClientProfileSchema.parse(req.body);
    requireActiveSession(res);
    const client = { ...data, id: randomUUID(), updatedAt: new Date().toISOString() };
    db.prepare('INSERT INTO studio_clients(id,owner_id,data,updated_at) VALUES (?,?,?,?)').run(
      client.id,
      session(res).owner_id,
      JSON.stringify(client),
      client.updatedAt,
    );
    res.status(201).json({ client });
  });
  app.patch('/api/studio/client-profiles/:clientId', (req, res) => {
    const previous = getStudioClientProfile(db, session(res).owner_id, String(req.params.clientId));
    if (!previous) throw new StudioError(404, 'Client profile not found.');
    const data = studioClientProfileSchema.parse(req.body);
    const client = { ...data, id: previous.id, updatedAt: new Date().toISOString() };
    requireActiveSession(res);
    db.prepare('UPDATE studio_clients SET data=?,updated_at=? WHERE id=? AND owner_id=?').run(
      JSON.stringify(client),
      client.updatedAt,
      client.id,
      session(res).owner_id,
    );
    res.json({ client });
  });
  app.delete('/api/studio/client-profiles/:clientId', (req, res) => {
    const client = getStudioClientProfile(db, session(res).owner_id, String(req.params.clientId));
    if (!client) throw new StudioError(404, 'Client profile not found.');
    requireActiveSession(res);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM studio_clients WHERE id=? AND owner_id=?').run(
        client.id,
        session(res).owner_id,
      );
      for (const workspace of store.list(session(res).owner_id))
        if (workspace.brief.clientId === client.id) {
          workspace.brief.clientId = '';
          store.save(session(res).owner_id, workspace, workspace.revision);
        }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.status(204).end();
  });
}
