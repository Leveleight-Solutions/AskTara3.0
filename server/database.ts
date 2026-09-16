import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Trip } from '../shared/types.ts';
import type { PlanningRun, TripRevision } from '../shared/planning.ts';
import { stripGooglePlaceContent } from './agents/places.ts';
import { initializeBookingStorage } from './booking-store.ts';
import { initializeStudioStorage } from './studio-store.ts';

export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, user_id TEXT REFERENCES users(id),
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, data TEXT NOT NULL,
      share_token TEXT UNIQUE, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS trips_owner ON trips(owner_id);
    CREATE TABLE IF NOT EXISTS saved (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, type TEXT NOT NULL,
      item_id TEXT NOT NULL, UNIQUE(owner_id, type, item_id)
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS travel_profiles (
      owner_id TEXT PRIMARY KEY, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS planning_runs (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, session_id TEXT NOT NULL,
      request_id TEXT NOT NULL, trip_id TEXT NOT NULL, data TEXT NOT NULL,
      error_status INTEGER, UNIQUE(owner_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS planning_runs_trip ON planning_runs(trip_id, owner_id);
    CREATE TABLE IF NOT EXISTS trip_revisions (
      id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL,
      data TEXT NOT NULL, UNIQUE(trip_id, version)
    );
  `);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  // A process restart cannot safely resume an in-flight supplier/model call.
  for (const row of db.prepare('SELECT id, data FROM planning_runs').all()) {
    const run = JSON.parse(String(row.data)) as PlanningRun;
    if (run.status === 'queued' || run.status === 'running') {
      run.status = 'failed';
      run.error =
        'Planning was interrupted by a server restart. Your saved trip is unchanged. Please retry.';
      run.updatedAt = new Date().toISOString();
      db.prepare('UPDATE planning_runs SET data = ?, error_status = 503 WHERE id = ?').run(
        JSON.stringify(run),
        row.id,
      );
    }
  }
  initializeBookingStorage(db);
  initializeStudioStorage(db);
  return db;
}

/** Save the visible trip and its version in one SQLite transaction. */
export function persistTripRevision(
  db: DatabaseSync,
  ownerId: string,
  trip: Trip,
  reason: string,
  options: { transaction?: boolean } = {},
) {
  const ownsTransaction = options.transaction !== false;
  if (ownsTransaction) db.exec('BEGIN IMMEDIATE');
  try {
    const previous = ownedTrip(db, ownerId, trip.id);
    const insert = db.prepare(
      'INSERT OR IGNORE INTO trip_revisions (id, trip_id, version, reason, created_at, data) VALUES (?, ?, ?, ?, ?, ?)',
    );
    if (previous) {
      insert.run(
        randomUUID(),
        previous.id,
        previous.revision ?? 0,
        'Previous saved plan',
        previous.updatedAt,
        JSON.stringify(stripGooglePlaceContent(previous)),
      );
    }
    trip.revision = (previous?.revision ?? 0) + 1;
    trip.updatedAt = new Date().toISOString();
    persistTrip(db, ownerId, trip);
    insert.run(
      randomUUID(),
      trip.id,
      trip.revision,
      reason,
      trip.updatedAt,
      JSON.stringify(stripGooglePlaceContent(trip)),
    );
    // Keep a useful bounded history without storing unbounded full trip copies.
    db.prepare('DELETE FROM trip_revisions WHERE trip_id = ? AND version < ?').run(
      trip.id,
      trip.revision - 49,
    );
    if (ownsTransaction) db.exec('COMMIT');
  } catch (error) {
    if (ownsTransaction) db.exec('ROLLBACK');
    throw error;
  }
  return trip;
}

export function tripRevisions(db: DatabaseSync, tripId: string): TripRevision[] {
  return db
    .prepare(
      'SELECT id, trip_id AS tripId, version, reason, created_at AS createdAt FROM trip_revisions WHERE trip_id = ? ORDER BY version DESC',
    )
    .all(tripId) as unknown as TripRevision[];
}

export function persistTrip(db: DatabaseSync, ownerId: string, trip: Trip) {
  db.prepare(
    `INSERT INTO trips (id, owner_id, data, share_token, updated_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
    data = excluded.data, share_token = excluded.share_token, updated_at = excluded.updated_at
    WHERE trips.owner_id = excluded.owner_id`,
  ).run(
    trip.id,
    ownerId,
    JSON.stringify(stripGooglePlaceContent(trip)),
    trip.shareToken,
    trip.updatedAt,
  );
}

export function ownedTrip(db: DatabaseSync, ownerId: string, id: string): Trip | undefined {
  const row = db.prepare('SELECT data FROM trips WHERE id = ? AND owner_id = ?').get(id, ownerId);
  return row ? JSON.parse(String(row.data)) : undefined;
}
