import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { defaultStudioAgency, type StudioAgency, type StudioWorkspace } from '../shared/studio.ts';

export class StudioError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'STUDIO_ERROR',
  ) {
    super(message);
  }
}
export function initializeStudioStorage(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_workspaces (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, revision INTEGER NOT NULL,
      data TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS studio_workspace_owner ON studio_workspaces(owner_id, updated_at);
    CREATE TABLE IF NOT EXISTS studio_agencies (owner_id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS studio_requests (
      owner_id TEXT NOT NULL, request_id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES studio_workspaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
      result TEXT, created_at TEXT NOT NULL, PRIMARY KEY(owner_id, request_id)
    );
    CREATE TABLE IF NOT EXISTS studio_quotes (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES studio_workspaces(id) ON DELETE CASCADE,
      structure TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  /* Pinning is a sidebar preference, not an edit to the proposal: it lives in its own column so
     it never bumps the revision (an open Studio tab would then hit a save conflict) or the
     updated_at the recent list is ordered by. Added in place for databases created before it. */
  const columns = db.prepare('PRAGMA table_info(studio_workspaces)').all();
  if (!columns.some((column) => column.name === 'pinned_at'))
    db.exec('ALTER TABLE studio_workspaces ADD COLUMN pinned_at TEXT');
}
/** Rows carry `pinned_at` beside the JSON document; it is merged in on read, never stored in it. */
function readWorkspace(row: Record<string, unknown>): StudioWorkspace {
  return {
    ...(JSON.parse(String(row.data)) as StudioWorkspace),
    pinnedAt: row.pinned_at ? String(row.pinned_at) : null,
  };
}
function documentOf(workspace: StudioWorkspace): string {
  const { pinnedAt: _pinnedAt, ...document } = workspace;
  return JSON.stringify(document);
}
export function newStudioWorkspace(): StudioWorkspace {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    revision: 1,
    title: 'New client proposal',
    stage: 'brief',
    brief: {
      clientName: '',
      context: '',
      request: '',
      startDate: '',
      endDate: '',
      datesFlexible: false,
      adults: null,
      children: null,
      childAges: [],
      budget: null,
      currency: 'AUD',
      origin: '',
      hotelStandard: '',
      hotelLocation: '',
      cabin: '',
      interests: [],
      requirements: [],
      output: 'proposal',
    },
    qualification: { score: 0, known: [], questions: [], skipped: false },
    stops: [],
    structureAccepted: false,
    items: [],
    recommendations: [],
    imports: [],
    messages: [],
    pricing: { mode: 'itemised', packagePrice: null, currency: 'AUD', notes: '', marginPercent: 0 },
    proposal: null,
    createdAt: now,
    updatedAt: now,
  };
}
export class StudioStore {
  constructor(public readonly db: DatabaseSync) {}
  get(ownerId: string, id: string): StudioWorkspace | undefined {
    const row = this.db
      .prepare('SELECT data, pinned_at FROM studio_workspaces WHERE id = ? AND owner_id = ?')
      .get(id, ownerId);
    return row ? readWorkspace(row) : undefined;
  }
  require(ownerId: string, id: string, revision?: number): StudioWorkspace {
    const workspace = this.get(ownerId, id);
    if (!workspace) throw new StudioError(404, 'Workspace not found.');
    if (revision !== undefined && workspace.revision !== revision)
      throw new StudioError(
        409,
        'This workspace changed. Reload the latest version before saving.',
        'STUDIO_REVISION_CONFLICT',
      );
    return workspace;
  }
  /** Pinned first (most recently pinned on top), then everything else newest-updated first. */
  list(ownerId: string): StudioWorkspace[] {
    return this.db
      .prepare(
        `SELECT data, pinned_at FROM studio_workspaces WHERE owner_id = ?
         ORDER BY pinned_at IS NULL, pinned_at DESC, updated_at DESC LIMIT 200`,
      )
      .all(ownerId)
      .map(readWorkspace);
  }
  setPinned(ownerId: string, id: string, pinned: boolean): StudioWorkspace {
    this.require(ownerId, id);
    this.db
      .prepare('UPDATE studio_workspaces SET pinned_at=? WHERE id=? AND owner_id=?')
      .run(pinned ? new Date().toISOString() : null, id, ownerId);
    return this.require(ownerId, id);
  }
  create(ownerId: string, workspace = newStudioWorkspace()): StudioWorkspace {
    this.db
      .prepare(
        'INSERT INTO studio_workspaces (id,owner_id,revision,data,updated_at) VALUES (?,?,?,?,?)',
      )
      .run(workspace.id, ownerId, workspace.revision, documentOf(workspace), workspace.updatedAt);
    return workspace;
  }
  /** A single CAS statement; may be called inside a publication transaction. */
  save(ownerId: string, workspace: StudioWorkspace, expectedRevision: number): StudioWorkspace {
    const next = {
      ...workspace,
      revision: expectedRevision + 1,
      updatedAt: new Date().toISOString(),
    };
    const saved = this.db
      .prepare(
        'UPDATE studio_workspaces SET revision=?,data=?,updated_at=? WHERE id=? AND owner_id=? AND revision=?',
      )
      .run(
        next.revision,
        documentOf(next),
        next.updatedAt,
        workspace.id,
        ownerId,
        expectedRevision,
      );
    if (saved.changes !== 1) {
      if (!this.get(ownerId, workspace.id)) throw new StudioError(404, 'Workspace not found.');
      throw new StudioError(
        409,
        'This workspace changed. Reload the latest version before saving.',
        'STUDIO_REVISION_CONFLICT',
      );
    }
    Object.assign(workspace, next);
    return workspace;
  }
  delete(ownerId: string, id: string) {
    this.require(ownerId, id);
    this.db.prepare('DELETE FROM studio_workspaces WHERE id=? AND owner_id=?').run(id, ownerId);
  }
  getAgency(ownerId: string): StudioAgency {
    const row = this.db.prepare('SELECT data FROM studio_agencies WHERE owner_id=?').get(ownerId);
    return row
      ? { ...defaultStudioAgency(), ...JSON.parse(String(row.data)) }
      : defaultStudioAgency();
  }
  saveAgency(ownerId: string, agency: StudioAgency): StudioAgency {
    this.db
      .prepare(
        'INSERT INTO studio_agencies (owner_id,data) VALUES (?,?) ON CONFLICT(owner_id) DO UPDATE SET data=excluded.data',
      )
      .run(ownerId, JSON.stringify(agency));
    return agency;
  }
}
export function migrateStudio(db: DatabaseSync, guest: string, user: string) {
  db.prepare('UPDATE studio_workspaces SET owner_id=? WHERE owner_id=?').run(user, guest);
  db.prepare('UPDATE studio_quotes SET owner_id=? WHERE owner_id=?').run(user, guest);
  // Completed request IDs remain meaningful in their original owner scope only.
  db.prepare('DELETE FROM studio_requests WHERE owner_id=?').run(guest);
  db.prepare(
    'INSERT OR IGNORE INTO studio_agencies(owner_id,data) SELECT ?,data FROM studio_agencies WHERE owner_id=?',
  ).run(user, guest);
  db.prepare('DELETE FROM studio_agencies WHERE owner_id=?').run(guest);
  if (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='studio_proposals'")
      .get()
  )
    db.prepare('UPDATE studio_proposals SET owner_id=? WHERE owner_id=?').run(user, guest);
}
