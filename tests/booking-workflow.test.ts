import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import type { BookingProvider } from '../server/booking-provider-types.ts';
import type { Booking, BookingKind } from '../shared/bookings.ts';
import { BookingStore, bookingFingerprint } from '../server/booking-store.ts';

const originalFetch = globalThis.fetch;
const envNames = [
  'OPENAI_API_KEY',
  'GOOGLE_PLACES_API_KEY',
  'LITEAPI_API_KEY',
  'LITEAPI_MODE',
  'DUFFEL_ACCESS_TOKEN',
  'LITEAPI_FLIGHT_BOOKING_ENABLED',
];
const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const apps: ReturnType<typeof createApp>[] = [];
const directories: string[] = [];
beforeEach(() => {
  for (const name of envNames) delete process.env[name];
  process.env.LITEAPI_API_KEY = 'sand_unit_only';
  globalThis.fetch = originalFetch;
});
after(async () => {
  globalThis.fetch = originalFetch;
  for (const app of apps) {
    await app.locals.planningRuns.shutdown();
    try {
      app.locals.db.close();
    } catch {
      /* Already closed for restart. */
    }
  }
  for (const path of directories) rmSync(path, { recursive: true, force: true });
  for (const name of envNames)
    originalEnv[name] === undefined
      ? delete process.env[name]
      : (process.env[name] = originalEnv[name]);
});
function provider(overrides: Partial<BookingProvider> = {}) {
  const calls = { prebook: 0, confirm: 0, retrieve: 0, cancel: 0 };
  const base: BookingProvider = {
    async prebook(offer) {
      calls.prebook++;
      return {
        prebookId: 'private-prebook-token',
        quote: {
          version: 'quote-version-1',
          price: 125,
          currency: 'USD',
          originalPrice: offer.view.price,
          priceChanged: offer.view.price !== 125,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          terms: ['Sandbox reservation. No real charge.'],
          cancellationPolicies: [{ description: 'Review the supplier cancellation conditions.' }],
        },
      };
    },
    async confirm(input) {
      calls.confirm++;
      assert.equal(input.quote.price, 125);
      return {
        status: 'confirmed',
        providerBookingId: 'supplier-reservation',
        confirmationCode: 'CONF-TEST',
        paymentStatus: 'simulated',
      };
    },
    async retrieve() {
      calls.retrieve++;
      return {
        status: 'confirmed',
        providerBookingId: 'supplier-reservation',
        confirmationCode: 'CONF-TEST',
        paymentStatus: 'simulated',
      };
    },
    async cancel() {
      calls.cancel++;
      return {
        status: 'cancelled',
        providerBookingId: 'supplier-reservation',
        paymentStatus: 'simulated',
        cancellation: { status: 'cancelled', fee: 0, currency: 'USD' },
      };
    },
    ...overrides,
  };
  return { adapter: base, calls };
}
function makeApp(adapter = provider().adapter, path = ':memory:') {
  const app = createApp(path, { bookingProviders: { hotel: adapter, flight: adapter } });
  apps.push(app);
  return app;
}
const credentials = { email: 'booking-traveler@example.com', password: 'long-password-123' };
async function register(client: ReturnType<typeof request.agent>) {
  return client
    .post('/api/auth/register')
    .send({ ...credentials, name: 'Booking Traveler' })
    .expect(201);
}
async function offer(
  app: ReturnType<typeof createApp>,
  client: ReturnType<typeof request.agent>,
  kind: BookingKind = 'hotel',
  tripId?: string,
) {
  await client.get('/api/session').expect(200);
  // An owned API read gives us the precise session's owner without exposing cookies.
  const profile = await client
    .patch('/api/profile')
    .send({ planningNotes: randomUUID() })
    .expect(200);
  const row = app.locals.db
    .prepare("SELECT owner_id FROM travel_profiles WHERE json_extract(data, '$.planningNotes') = ?")
    .get(profile.body.profile.planningNotes);
  const ownerId = String(row.owner_id);
  const store = new BookingStore(app.locals.db);
  const offerId = store.saveOffer(ownerId, {
    provider: 'liteapi',
    providerOfferId: 'private-supplier-offer',
    hotelId: kind === 'hotel' ? 'hotel-1' : undefined,
    guestNationality: 'PK',
    view: {
      kind,
      name: 'Fixture stay',
      description: 'Owned supplier offer',
      price: 100,
      currency: 'USD',
      adults: 2,
      startDate: '2027-03-01',
      endDate: '2027-03-03',
      location: 'London',
      tripId,
      confirmationAvailable: kind === 'hotel',
    },
  });
  return { ownerId, offerId, store };
}
async function prebook(
  client: ReturnType<typeof request.agent>,
  offerId: string,
  key = randomUUID(),
): Promise<Booking> {
  return (await client.post('/api/bookings/prebook').send({ offerId, requestId: key }).expect(200))
    .body.booking;
}
function confirmation(booking: Booking) {
  return {
    requestId: randomUUID(),
    quoteVersion: booking.quote.version,
    acceptedPrice: booking.quote.price,
    acceptedCurrency: booking.quote.currency,
    holder: {
      firstName: 'Ada',
      lastName: 'Test',
      email: 'ada@example.com',
      phone: '5551234567',
      phoneCountryCode: '1',
    },
    guests: [{ firstName: 'Ada', lastName: 'Test' }],
    acceptSandbox: true,
    acceptTerms: true,
  };
}

test('opaque offer refs, quote review, confirmation and cancellation are persisted and owner isolated', async () => {
  const fake = provider(),
    app = makeApp(fake.adapter),
    alice = request.agent(app),
    bob = request.agent(app);
  const { offerId } = await offer(app, alice);
  await bob.get(`/api/bookings/offers/${offerId}`).expect(404);
  const visible = await alice.get(`/api/bookings/offers/${offerId}`).expect(200);
  assert.equal(visible.body.offer.price, 100);
  assert.equal(visible.body.offer.mode, 'test');
  assert.equal(JSON.stringify(visible.body).includes('private-supplier-offer'), false);
  const booking = await prebook(alice, offerId);
  assert.equal(booking.quote.price, 125);
  assert.equal(booking.quote.priceChanged, true);
  assert.equal(booking.status, 'checkout');
  await bob.get(`/api/bookings/${booking.id}`).expect(404);
  await bob.post(`/api/bookings/${booking.id}/confirm`).send(confirmation(booking)).expect(404);
  const confirm = confirmation(booking);
  const result = await alice.post(`/api/bookings/${booking.id}/confirm`).send(confirm).expect(200);
  assert.equal(result.body.booking.status, 'confirmed');
  assert.equal(result.body.booking.confirmationCode, 'CONF-TEST');
  await alice.post(`/api/bookings/${booking.id}/confirm`).send(confirm).expect(200);
  assert.equal(fake.calls.confirm, 1);
  assert.equal(JSON.stringify(result.body).includes('private-prebook-token'), false);
  assert.equal((await alice.get('/api/bookings')).body.bookings.length, 1);
  const cancel = { requestId: randomUUID(), acceptCancellation: true };
  await alice.post(`/api/bookings/${booking.id}/cancel`).send(cancel).expect(200);
  await alice.post(`/api/bookings/${booking.id}/cancel`).send(cancel).expect(200);
  assert.equal(fake.calls.cancel, 1);
  assert.equal((await alice.get(`/api/bookings/${booking.id}`)).body.booking.status, 'cancelled');
});

test('idempotency binds payloads, one offer creates one checkout, and client totals never change the supplier quote', async () => {
  const fake = provider(),
    app = makeApp(fake.adapter),
    client = request.agent(app),
    first = await offer(app, client);
  const key = randomUUID(),
    booking = await prebook(client, first.offerId, key);
  assert.equal((await prebook(client, first.offerId, key)).id, booking.id);
  const aliasKey = randomUUID();
  assert.equal((await prebook(client, first.offerId, aliasKey)).id, booking.id);
  assert.equal(fake.calls.prebook, 1);
  const second = await offer(app, client);
  await client
    .post('/api/bookings/prebook')
    .send({ offerId: second.offerId, requestId: aliasKey })
    .expect(409);
  for (const change of [
    { acceptedPrice: 1 },
    { acceptedCurrency: 'EUR' },
    { quoteVersion: 'older-quote' },
  ]) {
    const result = await client
      .post(`/api/bookings/${booking.id}/confirm`)
      .send({ ...confirmation(booking), ...change })
      .expect(409);
    assert.equal(result.body.code, 'QUOTE_CHANGED');
  }
  await client
    .post(`/api/bookings/${booking.id}/confirm`)
    .send({ ...confirmation(booking), acceptTerms: false })
    .expect(400);
  const confirm = confirmation(booking);
  await client.post(`/api/bookings/${booking.id}/confirm`).send(confirm).expect(200);
  const conflict = await client
    .post(`/api/bookings/${booking.id}/confirm`)
    .send({ ...confirm, holder: { ...confirm.holder, firstName: 'Another' } })
    .expect(409);
  assert.equal(conflict.body.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(fake.calls.confirm, 1);
});

test('sandbox eligibility uses the actual credential and expired quotes cannot be confirmed', async () => {
  const fake = provider(),
    app = makeApp(fake.adapter),
    client = request.agent(app),
    { offerId, ownerId, store } = await offer(app, client);
  process.env.LITEAPI_API_KEY = 'production-looking-key';
  process.env.LITEAPI_MODE = 'test';
  await client.post('/api/bookings/prebook').send({ offerId, requestId: randomUUID() }).expect(403);
  assert.equal(fake.calls.prebook, 0);
  process.env.LITEAPI_API_KEY = 'sand_unit_only';
  const booking = await prebook(client, offerId);
  const saved = store.owned(ownerId, booking.id);
  saved.booking.quote.expiresAt = '2020-01-01T00:00:00.000Z';
  store.write(saved);
  const result = await client
    .post(`/api/bookings/${booking.id}/confirm`)
    .send(confirmation(booking))
    .expect(409);
  assert.equal(result.body.code, 'QUOTE_EXPIRED');
  assert.equal(fake.calls.confirm, 0);
});

test('concurrent confirmations dispatch once and timeout outcomes only reconcile, never silently rebook', async () => {
  let release!: () => void,
    started!: () => void,
    confirmCalls = 0;
  const gate = new Promise<void>((resolve) => (release = resolve)),
    began = new Promise<void>((resolve) => (started = resolve));
  const fake = provider({
    async confirm() {
      confirmCalls++;
      started();
      await gate;
      throw new Error('Upstream token must never be logged');
    },
  });
  const app = makeApp(fake.adapter),
    client = request.agent(app),
    { offerId } = await offer(app, client),
    booking = await prebook(client, offerId),
    input = confirmation(booking);
  const first = client
    .post(`/api/bookings/${booking.id}/confirm`)
    .send(input)
    .then((result) => result);
  await began;
  assert.equal(
    (await client.post(`/api/bookings/${booking.id}/confirm`).send(input).expect(200)).body.booking
      .status,
    'confirming',
  );
  await client
    .post(`/api/bookings/${booking.id}/confirm`)
    .send({ ...input, requestId: randomUUID() })
    .expect(409);
  release();
  const result = await first;
  assert.equal(result.body.booking.status, 'unknown');
  assert.equal(confirmCalls, 1);
  assert.equal(JSON.stringify(result.body).includes('Upstream token'), false);
  await client.post(`/api/bookings/${booking.id}/confirm`).send(input).expect(200);
  assert.equal(confirmCalls, 1);
  const refreshed = await client.post(`/api/bookings/${booking.id}/refresh`).send({}).expect(200);
  assert.equal(refreshed.body.booking.status, 'confirmed');
  assert.equal(fake.calls.retrieve, 1);
  assert.equal(confirmCalls, 1);
});

test('restart retains dispatched identity for reconciliation and interrupted quote preparation never creates an order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'asktara-booking-'));
  directories.push(dir);
  const path = join(dir, 'store.sqlite');
  const fake = provider(),
    first = makeApp(fake.adapter, path),
    client = request.agent(first);
  await register(client);
  const { offerId, ownerId, store } = await offer(first, client),
    booking = await prebook(client, offerId);
  const saved = store.owned(ownerId, booking.id);
  saved.providerPrebookId = 'checkpointed-ref';
  store.begin(
    ownerId,
    randomUUID(),
    'confirm',
    bookingFingerprint({ bookingId: booking.id }),
    saved,
    'confirming',
  );
  const nextOffer = await offer(first, client);
  const incomplete = store.create(
    ownerId,
    store.offer(ownerId, nextOffer.offerId),
    randomUUID(),
    'initial-prebook',
  );
  first.locals.db.close();
  const restarted = makeApp(fake.adapter, path),
    session = request.agent(restarted);
  await session.post('/api/auth/login').send(credentials).expect(200);
  const restored = await session.get(`/api/bookings/${booking.id}`).expect(200);
  assert.equal(restored.body.booking.status, 'unknown');
  assert.equal(
    new BookingStore(restarted.locals.db).owned(ownerId, booking.id).providerPrebookId,
    'checkpointed-ref',
  );
  assert.equal(
    (await session.get(`/api/bookings/${incomplete.saved.booking.id}`)).body.booking.status,
    'failed',
  );
  await session.post(`/api/bookings/${booking.id}/refresh`).send({}).expect(200);
  assert.equal(fake.calls.confirm, 0);
  assert.equal(fake.calls.retrieve, 1);
});

test('guest bookings migrate to accounts, export privately, survive trip deletion and never enter public shares', async () => {
  const app = makeApp(),
    client = request.agent(app),
    other = request.agent(app);
  const trip = (
    await client
      .post('/api/chat')
      .send({ message: '2 days in London starting 2027-03-01' })
      .expect(200)
  ).body.trip;
  const { offerId, ownerId } = await offer(app, client, 'hotel', trip.id),
    booking = await prebook(client, offerId);
  await client.post(`/api/bookings/${booking.id}/confirm`).send(confirmation(booking)).expect(200);
  const share = (await client.post(`/api/trips/${trip.id}/share`).send({}).expect(200)).body
    .shareToken;
  const shared = await other.get(`/api/shared/${share}`).expect(200);
  assert.equal(JSON.stringify(shared.body).includes('CONF-TEST'), false);
  assert.equal(JSON.stringify(shared.body).includes(booking.id), false);
  await register(client);
  assert.equal(
    app.locals.db.prepare('SELECT COUNT(*) AS count FROM bookings WHERE owner_id = ?').get(ownerId)
      .count,
    0,
  );
  await other.post('/api/auth/login').send(credentials).expect(200);
  assert.equal((await other.get('/api/bookings')).body.bookings[0].id, booking.id);
  const exported = await other.get('/api/account/export').expect(200);
  assert.equal(exported.body.bookings[0].id, booking.id);
  assert.equal(JSON.stringify(exported.body).includes('private-prebook-token'), false);
  await other.delete(`/api/trips/${trip.id}`).expect(204);
  await other.get(`/api/bookings/${booking.id}`).expect(200);
  await other
    .delete('/api/account')
    .send({ currentPassword: credentials.password, confirmation: 'DELETE' })
    .expect(200);
  assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS count FROM bookings').get().count, 0);
});

test('account deletion is blocked while outcomes are unresolved and revocation cannot lose a dispatched result', async () => {
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve)),
    began = new Promise<void>((resolve) => (started = resolve));
  const fake = provider({
    async confirm() {
      started();
      await gate;
      return {
        status: 'confirmed',
        providerBookingId: 'persist-after-logout',
        paymentStatus: 'simulated',
      };
    },
  });
  const app = makeApp(fake.adapter),
    client = request.agent(app),
    second = request.agent(app);
  await register(client);
  await second.post('/api/auth/login').send(credentials).expect(200);
  const { offerId } = await offer(app, client),
    booking = await prebook(client, offerId);
  const pending = client
    .post(`/api/bookings/${booking.id}/confirm`)
    .send(confirmation(booking))
    .then((result) => result);
  await began;
  const deletion = await second
    .delete('/api/account')
    .send({ currentPassword: credentials.password, confirmation: 'DELETE' })
    .expect(409);
  assert.equal(deletion.body.code, 'BOOKINGS_UNRESOLVED');
  await client.post('/api/auth/logout').expect(200);
  release();
  assert.equal((await pending).status, 409);
  const persisted = await second.get(`/api/bookings/${booking.id}`).expect(200);
  assert.equal(persisted.body.booking.providerBookingId, 'persist-after-logout');
});

test('pending cancellation retains confirmation until supplier completion and does not repeat cancellation', async () => {
  const fake = provider({
    async cancel() {
      return {
        status: 'confirmed',
        providerBookingId: 'supplier-reservation',
        paymentStatus: 'simulated',
        cancellation: { status: 'pending' },
      };
    },
  });
  const app = makeApp(fake.adapter),
    client = request.agent(app),
    { offerId } = await offer(app, client),
    booking = await prebook(client, offerId);
  await client.post(`/api/bookings/${booking.id}/confirm`).send(confirmation(booking)).expect(200);
  const result = await client
    .post(`/api/bookings/${booking.id}/cancel`)
    .send({ requestId: randomUUID(), acceptCancellation: true })
    .expect(200);
  assert.equal(result.body.booking.status, 'cancelling');
  assert.equal(result.body.booking.confirmationCode, 'CONF-TEST');
  const refreshed = await client.post(`/api/bookings/${booking.id}/refresh`).send({}).expect(200);
  assert.equal(refreshed.body.booking.status, 'cancelling');
  assert.equal(refreshed.body.booking.confirmationCode, 'CONF-TEST');
  await client
    .post(`/api/bookings/${booking.id}/cancel`)
    .send({ requestId: randomUUID(), acceptCancellation: true })
    .expect(409);
});

test('flight confirmation persists its supplier checkpoint and later failures remain unknown', async () => {
  let app: ReturnType<typeof createApp>;
  const fake = provider({
    async confirm(input) {
      await input.checkpoint?.({ providerPrebookId: 'durable-before-book' });
      assert.equal(
        new BookingStore(app.locals.db).internal(input.clientReference)?.providerPrebookId,
        'durable-before-book',
      );
      throw Object.assign(new Error('Connection lost after reservation'), {
        code: 'BOOKING_OUTCOME_UNKNOWN',
      });
    },
  });
  app = makeApp(fake.adapter);
  const client = request.agent(app),
    { offerId } = await offer(app, client, 'flight'),
    booking = await prebook(client, offerId),
    input = confirmation(booking);
  input.guests.push({ firstName: 'Alan', lastName: 'Test' });
  const result = await client.post(`/api/bookings/${booking.id}/confirm`).send(input).expect(200);
  assert.equal(result.body.booking.status, 'unknown');
  assert.equal(JSON.stringify(result.body).includes('durable-before-book'), false);
});

test('flight validation and stale quotes are definitive pre-dispatch outcomes, not unknown reservations', async () => {
  for (const code of [
    'INVALID_BOOKING_GUESTS',
    'FLIGHT_PAYMENT_NOT_CONFIGURED',
    'SANDBOX_BOOKING_REQUIRED',
    'FLIGHT_OFFER_CHANGED',
    'FLIGHT_OFFER_EXPIRED',
  ]) {
    const fake = provider({
      async confirm() {
        throw Object.assign(new Error('Not dispatched'), { code });
      },
    });
    const app = makeApp(fake.adapter),
      client = request.agent(app),
      { offerId } = await offer(app, client, 'flight'),
      booking = await prebook(client, offerId),
      input = confirmation(booking);
    input.guests.push({ firstName: 'Alan', lastName: 'Test' });
    const result = await client.post(`/api/bookings/${booking.id}/confirm`).send(input).expect(200);
    assert.equal(
      result.body.booking.status,
      code === 'FLIGHT_OFFER_CHANGED' || code === 'FLIGHT_OFFER_EXPIRED' ? 'expired' : 'checkout',
    );
    assert.equal(result.body.booking.paymentStatus, 'not_charged');
  }
});

test('cancellation preview refusal keeps the reservation active without inventing a cancellation request', async () => {
  const fake = provider({
    async cancel() {
      throw Object.assign(new Error('Fee review needed'), {
        code: 'FLIGHT_CANCELLATION_REVIEW_REQUIRED',
      });
    },
  });
  const app = makeApp(fake.adapter),
    client = request.agent(app),
    { offerId, ownerId, store } = await offer(app, client),
    booking = await prebook(client, offerId);
  await client.post(`/api/bookings/${booking.id}/confirm`).send(confirmation(booking)).expect(200);
  const result = await client
    .post(`/api/bookings/${booking.id}/cancel`)
    .send({ requestId: randomUUID(), acceptCancellation: true })
    .expect(200);
  assert.equal(result.body.booking.status, 'confirmed');
  assert.equal(result.body.booking.cancellation.status, 'review_required');
  assert.equal(store.owned(ownerId, booking.id).cancelRequestedAt, undefined);
});

test('expired unreferenced offers are pruned without deleting current offers or booking recovery references', async () => {
  const app = makeApp(),
    client = request.agent(app),
    first = await offer(app, client),
    second = await offer(app, client),
    third = await offer(app, client);
  const booking = await prebook(client, second.offerId);
  app.locals.db
    .prepare('UPDATE booking_offers SET expires_at = ? WHERE id IN (?,?)')
    .run('2020-01-01T00:00:00.000Z', first.offerId, second.offerId);
  await offer(app, client);
  await client.get(`/api/bookings/offers/${first.offerId}`).expect(404);
  await client.get(`/api/bookings/offers/${third.offerId}`).expect(200);
  await client.get(`/api/bookings/${booking.id}`).expect(200);
  assert.ok(
    app.locals.db.prepare('SELECT id FROM booking_offers WHERE id = ?').get(second.offerId),
  );
});

test('long hotel conditions and complete multi-line fare rules survive quote review without silent truncation', async () => {
  const base = provider(),
    terms = [
      'x'.repeat(30000),
      ...Array.from({ length: 99 }, (_, index) => `Fare condition ${index + 1}`),
    ];
  const adapter = {
    ...base.adapter,
    async prebook(value: Parameters<BookingProvider['prebook']>[0]) {
      const result = await base.adapter.prebook(value);
      result.quote.terms = terms;
      return result;
    },
  };
  const app = makeApp(adapter),
    client = request.agent(app),
    { offerId } = await offer(app, client);
  const booking = await prebook(client, offerId);
  assert.equal(booking.status, 'checkout');
  assert.deepEqual(booking.quote.terms, terms);
});

test('a rejected cancellation preserves the prior reservation state and clears stale cancellation intent', async () => {
  const fake = provider({
    async confirm() {
      return {
        status: 'pending',
        providerBookingId: 'pending-reservation',
        paymentStatus: 'simulated',
      };
    },
    async cancel() {
      return {
        status: 'failed',
        paymentStatus: 'simulated',
        message: 'Supplier rejected cancellation.',
      };
    },
  });
  const app = makeApp(fake.adapter),
    client = request.agent(app),
    { offerId, ownerId, store } = await offer(app, client);
  const booking = await prebook(client, offerId);
  await client.post(`/api/bookings/${booking.id}/confirm`).send(confirmation(booking)).expect(200);
  const cancelled = await client
    .post(`/api/bookings/${booking.id}/cancel`)
    .send({ requestId: randomUUID(), acceptCancellation: true })
    .expect(200);
  assert.equal(cancelled.body.booking.status, 'pending');
  assert.equal(cancelled.body.booking.cancellation.status, 'failed');
  assert.equal(store.owned(ownerId, booking.id).cancelRequestedAt, undefined);
  const refreshed = await client.post(`/api/bookings/${booking.id}/refresh`).send({}).expect(200);
  assert.equal(refreshed.body.booking.status, 'confirmed');
});

test('hotel search issues refs only for actual sandbox rate IDs and rejects foreign dynamic trip context', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        sandbox: true,
        data: [
          {
            hotelId: 'hotel-1',
            roomTypes: [
              {
                offerId: 'actual-rate-id',
                rates: [
                  {
                    name: 'Double room',
                    retailRate: { total: [{ amount: 100, currency: 'USD' }] },
                  },
                ],
              },
            ],
          },
          {
            hotelId: 'hotel-without-rate',
            roomTypes: [{ rates: [{ retailRate: { total: [{ amount: 90, currency: 'USD' }] } }] }],
          },
        ],
        hotels: [{ id: 'hotel-1', name: 'Test Hotel' }],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  const app = makeApp(),
    client = request.agent(app),
    other = request.agent(app);
  const query = {
    destinationId: 'london',
    checkin: '2027-03-01',
    checkout: '2027-03-03',
    adults: 2,
    guestNationality: 'PK',
  };
  const response = await client.post('/api/hotels/search').send(query).expect(200);
  assert.ok(response.body.offers[0].bookingOfferId);
  assert.equal(response.body.offers[1].bookingOfferId, undefined);
  const ref = response.body.offers[0].bookingOfferId;
  await client.get(`/api/bookings/offers/${ref}`).expect(200);
  await other.get(`/api/bookings/offers/${ref}`).expect(404);
  await other
    .post('/api/hotels/search')
    .send({ ...query, tripId: randomUUID() })
    .expect(404);
});
