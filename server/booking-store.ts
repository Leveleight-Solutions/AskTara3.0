import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Booking, BookingOfferView, BookingStatus } from '../shared/bookings.ts';
import type { StoredBookingOffer } from './booking-provider-types.ts';

export class BookingError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'BOOKING_ERROR',
  ) {
    super(message);
  }
}
export const sandboxBookingsEnabled = () =>
  /^(sand_|sandbox_)/.test(process.env.LITEAPI_API_KEY || '');
export function requireSandboxBookings() {
  if (!sandboxBookingsEnabled())
    throw new BookingError(
      403,
      'Checkout is available only with a verified sandbox credential. No reservation or charge was made.',
      'SANDBOX_ONLY',
    );
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const bookingFingerprint = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
export interface StoredBooking {
  booking: Booking;
  offer: StoredBookingOffer;
  prebookId?: string;
  providerPrebookId?: string;
  cancelRequestedAt?: string;
  beforeCancellation?: 'confirmed' | 'pending';
}
export interface BookingOperation {
  id: string;
  booking_id: string;
  action: 'prebook' | 'confirm' | 'cancel' | 'refresh';
  fingerprint: string;
  status: 'pending' | 'done';
}
function pruneBookingOffers(db: DatabaseSync) {
  db.prepare(
    'DELETE FROM booking_offers WHERE expires_at < ? AND NOT EXISTS (SELECT 1 FROM bookings WHERE bookings.offer_id = booking_offers.id)',
  ).run(new Date(Date.now() - 86_400_000).toISOString());
}

export function initializeBookingStorage(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS booking_offers (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, data TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS booking_offers_owner ON booking_offers(owner_id);
    CREATE INDEX IF NOT EXISTS booking_offers_expiry ON booking_offers(expires_at);
    CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, offer_id TEXT NOT NULL UNIQUE, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS bookings_owner ON bookings(owner_id);
    CREATE TABLE IF NOT EXISTS booking_operations (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, request_id TEXT NOT NULL, booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE, action TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, UNIQUE(owner_id, request_id));
    CREATE INDEX IF NOT EXISTS booking_operations_booking ON booking_operations(booking_id);
  `);
  pruneBookingOffers(db);
  const store = new BookingStore(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const operation of db
      .prepare("SELECT * FROM booking_operations WHERE status = 'pending'")
      .all() as unknown as BookingOperation[]) {
      const saved = store.internal(operation.booking_id);
      if (!saved) continue;
      if (operation.action === 'prebook') {
        saved.booking.status = 'failed';
        saved.booking.message =
          'Quote preparation was interrupted. Search again for a fresh offer; no booking was submitted.';
      } else if (operation.action !== 'refresh') {
        saved.booking.status = 'unknown';
        saved.booking.message =
          'The supplier operation was interrupted. Check its status before taking another action; do not submit another booking.';
        if (operation.action === 'cancel') saved.booking.cancellation = { status: 'unknown' };
        else saved.booking.paymentStatus = 'unknown';
      }
      store.write(saved);
      store.finish(operation.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export class BookingStore {
  constructor(readonly db: DatabaseSync) {}
  internal(id: string): StoredBooking | undefined {
    const row = this.db.prepare('SELECT data FROM bookings WHERE id = ?').get(id);
    return row ? JSON.parse(String(row.data)) : undefined;
  }
  owned(ownerId: string, id: string): StoredBooking {
    const row = this.db
      .prepare('SELECT data FROM bookings WHERE id = ? AND owner_id = ?')
      .get(id, ownerId);
    if (!row) throw new BookingError(404, 'Booking not found.', 'BOOKING_NOT_FOUND');
    return JSON.parse(String(row.data));
  }
  list(ownerId: string, tripId?: string): Booking[] {
    return this.db
      .prepare('SELECT data FROM bookings WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 250')
      .all(ownerId)
      .map((row) => (JSON.parse(String(row.data)) as StoredBooking).booking)
      .filter((booking) => !tripId || booking.offer.tripId === tripId);
  }
  offer(ownerId: string, id: string): StoredBookingOffer {
    const row = this.db
      .prepare('SELECT data FROM booking_offers WHERE id = ? AND owner_id = ?')
      .get(id, ownerId);
    if (!row)
      throw new BookingError(
        404,
        'This checkout offer was not found. Search again for current availability.',
        'OFFER_NOT_FOUND',
      );
    return JSON.parse(String(row.data));
  }
  saveOffer(
    ownerId: string,
    input: Omit<StoredBookingOffer, 'view'> & {
      view: Omit<BookingOfferView, 'id' | 'expiresAt' | 'mode'>;
      expiresAt?: string;
    },
  ): string {
    requireSandboxBookings();
    pruneBookingOffers(this.db);
    const expires = Math.min(
      Date.now() + 10 * 60_000,
      input.expiresAt ? Date.parse(input.expiresAt) : Infinity,
    );
    if (!Number.isFinite(expires) || expires <= Date.now())
      throw new BookingError(409, 'This offer has expired. Search again.', 'QUOTE_EXPIRED');
    const id = randomUUID();
    const offer: StoredBookingOffer = {
      provider: input.provider,
      providerOfferId: input.providerOfferId,
      hotelId: input.hotelId,
      guestNationality: input.guestNationality,
      view: { ...input.view, id, mode: 'test', expiresAt: new Date(expires).toISOString() },
    };
    this.db
      .prepare('INSERT INTO booking_offers(id,owner_id,data,expires_at) VALUES(?,?,?,?)')
      .run(id, ownerId, JSON.stringify(offer), offer.view.expiresAt);
    return id;
  }
  operation(
    ownerId: string,
    requestId: string,
    action: BookingOperation['action'],
    fingerprint: string,
  ): BookingOperation | undefined {
    const existing = this.db
      .prepare('SELECT * FROM booking_operations WHERE owner_id = ? AND request_id = ?')
      .get(ownerId, requestId) as unknown as BookingOperation | undefined;
    if (existing && (existing.action !== action || existing.fingerprint !== fingerprint))
      throw new BookingError(
        409,
        'This request ID was already used for different details. Start a new request.',
        'IDEMPOTENCY_CONFLICT',
      );
    return existing;
  }
  active(id: string) {
    return Boolean(
      this.db
        .prepare("SELECT id FROM booking_operations WHERE booking_id = ? AND status = 'pending'")
        .get(id),
    );
  }
  begin(
    ownerId: string,
    requestId: string,
    action: BookingOperation['action'],
    fingerprint: string,
    saved: StoredBooking,
    status: BookingStatus,
  ) {
    const id = randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.active(saved.booking.id))
        throw new BookingError(
          409,
          'A supplier request is already in progress. Check the booking status.',
          'BOOKING_IN_PROGRESS',
        );
      saved.booking.status = status;
      this.write(saved);
      this.db
        .prepare(
          'INSERT INTO booking_operations(id,owner_id,request_id,booking_id,action,fingerprint,status) VALUES(?,?,?,?,?,?,?)',
        )
        .run(id, ownerId, requestId, saved.booking.id, action, fingerprint, 'pending');
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return id;
  }
  create(ownerId: string, offer: StoredBookingOffer, requestId: string, fingerprint: string) {
    const previous = this.db
      .prepare('SELECT data FROM bookings WHERE owner_id = ? AND offer_id = ?')
      .get(ownerId, offer.view.id);
    if (previous) {
      const saved = JSON.parse(String(previous.data)) as StoredBooking;
      this.db
        .prepare(
          'INSERT INTO booking_operations(id,owner_id,request_id,booking_id,action,fingerprint,status) VALUES(?,?,?,?,?,?,?)',
        )
        .run(randomUUID(), ownerId, requestId, saved.booking.id, 'prebook', fingerprint, 'done');
      return { saved, operationId: undefined };
    }
    const now = new Date().toISOString(),
      id = randomUUID();
    const booking: Booking = {
      id,
      kind: offer.view.kind,
      mode: 'test',
      status: 'checkout',
      offer: offer.view,
      quote: {
        version: '',
        price: offer.view.price,
        originalPrice: offer.view.price,
        priceChanged: false,
        currency: offer.view.currency,
        expiresAt: offer.view.expiresAt,
        terms: [],
        cancellationPolicies: [],
      },
      paymentStatus: 'not_charged',
      message: 'Preparing your quote. No booking has been submitted.',
      createdAt: now,
      updatedAt: now,
    };
    const saved: StoredBooking = { booking, offer };
    const operationId = randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('INSERT INTO bookings(id,owner_id,offer_id,data,updated_at) VALUES(?,?,?,?,?)')
        .run(id, ownerId, offer.view.id, JSON.stringify(saved), now);
      this.db
        .prepare(
          'INSERT INTO booking_operations(id,owner_id,request_id,booking_id,action,fingerprint,status) VALUES(?,?,?,?,?,?,?)',
        )
        .run(operationId, ownerId, requestId, id, 'prebook', fingerprint, 'pending');
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { saved, operationId };
  }
  write(saved: StoredBooking) {
    saved.booking.updatedAt = new Date().toISOString();
    this.db
      .prepare('UPDATE bookings SET data = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(saved), saved.booking.updatedAt, saved.booking.id);
  }
  finish(operationId: string) {
    this.db.prepare("UPDATE booking_operations SET status = 'done' WHERE id = ?").run(operationId);
  }
  complete(operationId: string, saved: StoredBooking) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.write(saved);
      this.finish(operationId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function migrateBookings(db: DatabaseSync, from: string, to: string) {
  for (const row of db
    .prepare(
      'SELECT guest.id FROM booking_operations guest JOIN booking_operations account ON account.request_id = guest.request_id WHERE guest.owner_id = ? AND account.owner_id = ?',
    )
    .all(from, to))
    db.prepare('UPDATE booking_operations SET request_id = ? WHERE id = ?').run(
      randomUUID(),
      row.id,
    );
  for (const table of ['booking_offers', 'bookings', 'booking_operations'])
    db.prepare(`UPDATE ${table} SET owner_id = ? WHERE owner_id = ?`).run(to, from);
}
export function assertBookingsDeletable(db: DatabaseSync, ownerId: string) {
  const unresolved = db
    .prepare(
      "SELECT id FROM bookings WHERE owner_id = ? AND json_extract(data, '$.booking.status') IN ('confirming','pending','unknown','cancelling') LIMIT 1",
    )
    .get(ownerId);
  const active = db
    .prepare("SELECT id FROM booking_operations WHERE owner_id = ? AND status = 'pending' LIMIT 1")
    .get(ownerId);
  if (unresolved || active)
    throw new BookingError(
      409,
      'Resolve pending booking requests before deleting your account so their supplier records remain accessible.',
      'BOOKINGS_UNRESOLVED',
    );
}
export function deleteBookings(db: DatabaseSync, ownerId: string) {
  for (const table of ['booking_operations', 'bookings', 'booking_offers'])
    db.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).run(ownerId);
}
