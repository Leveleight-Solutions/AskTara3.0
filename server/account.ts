import type { Express, Response, RequestHandler } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  defaultTravelProfile,
  dietaryPreferenceOptions,
  accessibilityPreferenceOptions,
  type TravelProfile,
} from '../shared/account.ts';
import type { Trip } from '../shared/types.ts';
import { StudioStore } from './studio-store.ts';
import type { PlanningRunManager } from './run-manager.ts';
import { BookingStore, assertBookingsDeletable, deleteBookings } from './booking-store.ts';
import { defaultConsultation } from '../shared/consultation.ts';

const deriveKey = promisify(scrypt);
export interface AccountSession {
  id: string;
  owner_id: string;
  user_id: string | null;
  expires_at: number;
}
export class AccountError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const profileSchema = z
  .object({
    pace: z.enum(['relaxed', 'balanced', 'active']),
    interests: z
      .array(z.string().trim().min(1).max(60))
      .max(15)
      .transform((values) => [...new Set(values)]),
    originAirport: z
      .string()
      .trim()
      .regex(/^([A-Za-z]{3})?$/, 'Use a three-letter airport code')
      .transform((value) => value.toUpperCase()),
    guestNationality: z
      .string()
      .trim()
      .regex(/^([A-Za-z]{2})?$/, 'Use a two-letter country code')
      .transform((value) => value.toUpperCase()),
    dietaryPreferences: z
      .array(z.enum(dietaryPreferenceOptions))
      .max(dietaryPreferenceOptions.length)
      .transform((values) => [...new Set(values)]),
    accessibilityPreferences: z
      .array(z.enum(accessibilityPreferenceOptions))
      .max(accessibilityPreferenceOptions.length)
      .transform((values) => [...new Set(values)]),
    planningNotes: z.string().trim().max(500),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide a preference to save');
const passwordSchema = z.object({ currentPassword: z.string().min(1).max(128) }).strict();

export function readProfile(db: DatabaseSync, ownerId: string): TravelProfile {
  const row = db.prepare('SELECT data FROM travel_profiles WHERE owner_id = ?').get(ownerId);
  return { ...structuredClone(defaultTravelProfile), ...(row ? JSON.parse(String(row.data)) : {}) };
}
export function migrateProfile(db: DatabaseSync, guestOwnerId: string, accountId: string) {
  // An existing account's explicit preferences win over the guest browser's choices.
  db.prepare(
    'INSERT OR IGNORE INTO travel_profiles (owner_id, data) SELECT ?, data FROM travel_profiles WHERE owner_id = ?',
  ).run(accountId, guestOwnerId);
  db.prepare('DELETE FROM travel_profiles WHERE owner_id = ?').run(guestOwnerId);
}
export function applyProfileDefaults(db: DatabaseSync, ownerId: string, trip: Trip) {
  const profile = readProfile(db, ownerId);
  const notes: string[] = [];
  if (profile.dietaryPreferences.length)
    notes.push(`Dietary preferences: ${profile.dietaryPreferences.join(', ')}.`);
  if (profile.accessibilityPreferences.length)
    notes.push(`Accessibility preferences: ${profile.accessibilityPreferences.join(', ')}.`);
  if (profile.planningNotes) notes.push(profile.planningNotes);
  if (profile.dietaryPreferences.length || profile.accessibilityPreferences.length)
    notes.push(
      'Dietary and accessibility suitability has not been verified. Confirm requirements directly with each venue, accommodation and transport provider.',
    );
  trip.interests = [...profile.interests];
  const consultation = defaultConsultation();
  if (profile.originAirport)
    consultation.facts.origin = {
      source: 'profile',
      valueState: 'specified',
      evidence: profile.originAirport,
    };
  if (profile.interests.length || notes.length)
    consultation.facts.interests = {
      source: 'profile',
      valueState: 'specified',
      evidence: [...profile.interests, ...notes].join('; ').slice(0, 500),
    };
  trip.brief = {
    pace: profile.pace,
    originAirport: profile.originAirport,
    guestNationality: profile.guestNationality,
    arrivalAirport: '',
    includeFlights: false,
    includeHotels: false,
    destinationStops: [],
    notes,
    consultation,
  };
}

type AccountRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
};
export function installAccountRoutes(
  app: Express,
  dependencies: {
    db: DatabaseSync;
    planningRuns: PlanningRunManager;
    session: (res: Response) => AccountSession;
    requireActiveSession: (res: Response) => void;
    createSession: (res: Response, userId?: string | null) => AccountSession;
    authLimiter: RequestHandler;
    cancelStudioSession?: (id: string) => void;
  },
) {
  const { db, planningRuns, session, requireActiveSession, createSession, authLimiter } =
    dependencies;
  const cancelPlanning = (id: string) => {
    planningRuns.cancelSession(id);
    dependencies.cancelStudioSession?.(id);
  };
  function account(res: Response): AccountRow {
    requireActiveSession(res);
    const userId = session(res).user_id;
    if (!userId) throw new AccountError(401, 'Sign in to manage your account.');
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
      AccountRow | undefined;
    if (!row) throw new AccountError(401, 'Sign in to manage your account.');
    return row;
  }
  function unchanged(res: Response, original: AccountRow) {
    const current = account(res);
    if (current.id !== original.id || current.password_hash !== original.password_hash)
      throw new AccountError(
        409,
        'Your account changed while this request was running. Please try again.',
      );
    return current;
  }
  async function verifyPassword(res: Response, password: string) {
    const row = account(res);
    const [salt, stored] = row.password_hash.split(':');
    const derived = (await deriveKey(password, salt, 64)) as Buffer;
    unchanged(res, row);
    if (!timingSafeEqual(Buffer.from(stored, 'hex'), derived))
      throw new AccountError(401, 'Your current password is incorrect.');
    return row;
  }
  const publicUser = (row: AccountRow) => ({ id: row.id, name: row.name, email: row.email });
  function sessionIds(userId: string, except?: string) {
    return db
      .prepare('SELECT id FROM sessions WHERE user_id = ?')
      .all(userId)
      .map((row) => String(row.id))
      .filter((id) => id !== except);
  }
  function transaction(action: () => void) {
    db.exec('BEGIN IMMEDIATE');
    try {
      action();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  app.get('/api/profile', (_req, res) =>
    res.json({ profile: readProfile(db, session(res).owner_id) }),
  );
  app.patch('/api/profile', (req, res) => {
    const body = profileSchema.parse(req.body);
    const ownerId = session(res).owner_id;
    const profile = { ...readProfile(db, ownerId), ...body, updatedAt: new Date().toISOString() };
    db.prepare(
      'INSERT INTO travel_profiles (owner_id, data) VALUES (?, ?) ON CONFLICT(owner_id) DO UPDATE SET data = excluded.data',
    ).run(ownerId, JSON.stringify(profile));
    res.json({ profile });
  });
  app.get('/api/account', (_req, res) => {
    const row = account(res);
    const others = db
      .prepare(
        'SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND id != ? AND expires_at > ?',
      )
      .get(row.id, session(res).id, Date.now());
    res.json({
      account: {
        ...publicUser(row),
        createdAt: row.created_at,
        otherSessions: Number(others?.count ?? 0),
      },
    });
  });
  app.patch('/api/account', (req, res) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(80) })
      .strict()
      .parse(req.body);
    const row = account(res);
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(body.name, row.id);
    res.json({ user: { ...publicUser(row), name: body.name } });
  });
  app.post('/api/account/password', authLimiter, async (req, res) => {
    const body = passwordSchema
      .extend({ newPassword: z.string().min(8, 'Use at least 8 characters').max(128) })
      .parse(req.body);
    const row = await verifyPassword(res, body.currentPassword);
    if (body.currentPassword === body.newPassword)
      throw new AccountError(400, 'Choose a different new password.');
    const salt = randomBytes(16).toString('hex');
    const derived = (await deriveKey(body.newPassword, salt, 64)) as Buffer;
    unchanged(res, row);
    const ids = sessionIds(row.id);
    transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
        `${salt}:${derived.toString('hex')}`,
        row.id,
      );
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
      res.locals.session = createSession(res, row.id);
    });
    ids.forEach(cancelPlanning);
    res.json({
      user: publicUser(row),
      message: 'Password updated. Other sessions have been signed out.',
    });
  });
  app.post('/api/account/sessions/revoke', authLimiter, async (req, res) => {
    const body = passwordSchema.parse(req.body);
    const row = await verifyPassword(res, body.currentPassword);
    const ids = sessionIds(row.id, session(res).id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(row.id, session(res).id);
    ids.forEach(cancelPlanning);
    res.json({ revoked: ids.length });
  });
  app.get('/api/account/export', (_req, res) => {
    const row = account(res);
    const exportTrip = (data: string) => {
      const { shareToken, ...trip } = JSON.parse(data) as Trip;
      return { ...trip, sharingEnabled: Boolean(shareToken) };
    };
    const trips = db
      .prepare('SELECT data FROM trips WHERE owner_id = ? ORDER BY updated_at DESC')
      .all(row.id)
      .map((trip) => exportTrip(String(trip.data)));
    const revisions = db
      .prepare(
        'SELECT revision.* FROM trip_revisions revision JOIN trips trip ON trip.id = revision.trip_id WHERE trip.owner_id = ? ORDER BY revision.created_at',
      )
      .all(row.id)
      .map((revision) => ({
        id: revision.id,
        tripId: revision.trip_id,
        version: revision.version,
        reason: revision.reason,
        createdAt: revision.created_at,
        trip: exportTrip(String(revision.data)),
      }));
    const saved = db
      .prepare('SELECT type, item_id AS itemId FROM saved WHERE owner_id = ?')
      .all(row.id);
    res.attachment('asktara-account.json').json({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      account: { ...publicUser(row), createdAt: row.created_at },
      profile: readProfile(db, row.id),
      trips,
      revisions,
      saved,
      bookings: new BookingStore(db).list(row.id),
      studio: {
        agency: new StudioStore(db).getAgency(row.id),
        workspaces: new StudioStore(db).list(row.id).map(({ proposal, ...workspace }) => ({
          ...workspace,
          proposalPublished: Boolean(proposal),
        })),
      },
    });
  });
  app.delete('/api/account', authLimiter, async (req, res) => {
    const body = passwordSchema.extend({ confirmation: z.literal('DELETE') }).parse(req.body);
    const row = await verifyPassword(res, body.currentPassword);
    assertBookingsDeletable(db, row.id);
    const ids = sessionIds(row.id);
    // Abort active upstream work while run records still exist. If deletion fails,
    // the account remains intact and the user can retry its cancelled plans.
    ids.forEach(cancelPlanning);
    transaction(() => {
      deleteBookings(db, row.id);
      db.prepare('DELETE FROM studio_workspaces WHERE owner_id = ?').run(row.id);
      db.prepare('DELETE FROM studio_agencies WHERE owner_id = ?').run(row.id);
      db.prepare('DELETE FROM planning_runs WHERE owner_id = ?').run(row.id);
      db.prepare('DELETE FROM trips WHERE owner_id = ?').run(row.id); // Revisions cascade.
      db.prepare('DELETE FROM saved WHERE owner_id = ?').run(row.id);
      db.prepare('DELETE FROM travel_profiles WHERE owner_id = ?').run(row.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
      res.locals.session = createSession(res);
    });
    res.json({ user: null, message: 'Your account and saved travel data have been deleted.' });
  });
}
