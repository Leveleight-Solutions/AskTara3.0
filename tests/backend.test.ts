import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { destinations } from '../shared/catalog.ts';
import { detectDestinationIntent, matchDestination } from '../server/planner.ts';
import type { Trip } from '../shared/types.ts';

const initialEnv = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  DUFFEL_ACCESS_TOKEN: process.env.DUFFEL_ACCESS_TOKEN,
  LITEAPI_API_KEY: process.env.LITEAPI_API_KEY,
  LITEAPI_MODE: process.env.LITEAPI_MODE,
};
const apps: ReturnType<typeof createApp>[] = [];
const temporaryPaths: string[] = [];
const makeApp = (path = ':memory:') => {
  const app = createApp(path);
  apps.push(app);
  return app;
};
const originalFetch = globalThis.fetch;
// Full customer intake for tests whose subject is a generated itinerary, not the interview.
const itineraryRequest = (message: string) =>
  `${message}. For 2 adults, dates are flexible, budget USD 1500. We enjoy culture. Just the itinerary, please.`;
// If a mock assertion rejects before opening its gate, surface the completed HTTP
// request immediately instead of waiting forever for an unreachable started().
async function waitForProviderStart(started: Promise<void>, pending: Promise<{ status: number }>) {
  await Promise.race([
    started,
    pending.then((result) => {
      throw new Error(
        `Planning request completed with HTTP ${result.status} before the provider gate opened`,
      );
    }),
  ]);
}
beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.DUFFEL_ACCESS_TOKEN;
  delete process.env.LITEAPI_API_KEY;
  delete process.env.LITEAPI_MODE;
  globalThis.fetch = originalFetch;
});
after(() => {
  globalThis.fetch = originalFetch;
  for (const app of apps)
    try {
      app.locals.db.close();
    } catch {
      /* Persistence test already closed this connection. */
    }
  for (const path of temporaryPaths) rmSync(path, { recursive: true, force: true });
  for (const [key, value] of Object.entries(initialEnv))
    value === undefined ? delete process.env[key] : (process.env[key] = value);
});

test('local planner creates and edits a real persisted itinerary, including dates and preferences', async () => {
  const app = makeApp(),
    client = request.agent(app);
  const response = await client
    .post('/api/chat')
    .send({
      message:
        'Plan 4 days in Kyoto for 3 people with a USD $2400 budget. I love food and culture. Start 2027-04-12. Just the itinerary, please.',
    })
    .expect(200);
  const trip = response.body.trip as Trip;
  assert.equal(response.body.mode, 'local');
  assert.match(response.body.warning, /Local planner/);
  assert.equal(trip.destinationId, 'kyoto');
  assert.equal(trip.days, 4);
  assert.equal(trip.travelers, 3);
  assert.equal(trip.budget, 2400);
  assert.equal(trip.startDate, '2027-04-12');
  assert.ok(trip.interests.includes('Food'));
  assert.ok(trip.interests.includes('Culture'));
  assert.equal(trip.itinerary.length, 4);
  assert.equal(trip.messages.length, 2);
  assert.ok(trip.itinerary.every((day) => day.items.length >= 4));
  const list = await client.get('/api/trips').expect(200);
  assert.equal(list.body.trips[0].id, trip.id);
  const change = await client
    .post('/api/chat')
    .send({ message: 'Make it 6 days, more relaxing, budget $1800', tripId: trip.id })
    .expect(200);
  assert.equal(change.body.trip.days, 6);
  assert.equal(change.body.trip.itinerary.length, 6);
  assert.equal(change.body.trip.budget, 1800);
  assert.equal(change.body.trip.messages.length, 4);
  assert.ok(change.body.trip.interests.includes('Relaxation'));
  assert.equal(change.body.trip.startDate, trip.startDate);
});

test('unknown destinations ask for clarification and do not silently become Kyoto', async () => {
  const client = request.agent(makeApp());
  const response = await client
    .post('/api/chat')
    .send({ message: 'I want to visit Atlantis for 3 days' })
    .expect(200);
  assert.equal(response.body.trip.destinationId, '');
  assert.deepEqual(response.body.trip.itinerary, []);
  assert.match(response.body.message.content, /Which one/);
  const followup = await client
    .post('/api/chat')
    .send({ message: 'Lisbon please', tripId: response.body.trip.id })
    .expect(200);
  assert.equal(followup.body.trip.destinationId, 'lisbon');
  assert.equal(followup.body.trip.days, 3);
});

test('the exact London request preserves its city, date, party and accessibility preferences', async () => {
  const client = request.agent(makeApp());
  const response = await client
    .post('/api/chat')
    .send({
      message:
        'Plan 4 days in London starting November 18, 2026, for 2 adults. We prefer vegetarian food, step-free access, and quiet places. for 2 travelers',
    })
    .expect(200);
  const trip = response.body.trip as Trip;
  assert.equal(trip.destinationId, 'london');
  assert.equal(trip.startDate, '2026-11-18');
  assert.equal(trip.days, 4);
  assert.equal(trip.travelers, 2);
  assert.equal(trip.itinerary.length, 0, 'The first message leaves service scope and budget open');
  assert.deepEqual(
    trip.planning?.questions.map((entry) => entry.field),
    ['flights', 'hotels'],
  );
  assert.equal(trip.brief?.consultation?.services.flights.status, 'unknown');
  assert.deepEqual(trip.brief?.destinationStops, [{ destinationId: 'london', days: 4 }]);
  assert.match(trip.brief?.notes.join(' ') || '', /vegetarian food/);
  assert.match(trip.brief?.notes.join(' ') || '', /step-free access/);
  assert.match(trip.brief?.notes.join(' ') || '', /quiet places/);
  assert.doesNotMatch(
    response.body.message.content,
    /Bali|Marrakech|Istanbul|A few places come to mind/,
  );
  const persisted = await client.get(`/api/trips/${trip.id}`).expect(200);
  assert.deepEqual(persisted.body.trip.brief.notes, trip.brief?.notes);
  const planned = await client
    .post('/api/chat')
    .send({ tripId: trip.id, message: 'Just the itinerary, please. My budget is flexible.' })
    .expect(200);
  assert.equal(planned.body.trip.itinerary.length, 4);
  assert.ok(
    planned.body.trip.itinerary.every(
      (day: { destinationId: string }) => day.destinationId === 'london',
    ),
  );
  assert.equal(planned.body.trip.startDate, '2026-11-18');
  assert.equal(planned.body.trip.travelers, 2);
});

test('an unsupported named city with food preferences remains its own draft and never becomes discovery', async () => {
  const client = request.agent(makeApp());
  const response = await client
    .post('/api/chat')
    .send({
      message:
        'Plan 4 days in Osaka starting November 18, 2026, for 2 adults. We prefer vegetarian food, step-free access, and quiet places.',
    })
    .expect(200);
  const trip = response.body.trip as Trip;
  assert.equal(trip.destinationId, '');
  assert.deepEqual(trip.itinerary, []);
  assert.equal(trip.startDate, '2026-11-18');
  assert.equal(trip.days, 4);
  assert.equal(trip.travelers, 2);
  assert.match(trip.title, /Osaka/);
  assert.match(response.body.message.content, /Osaka/);
  assert.match(response.body.message.content, /not covered|not supported/);
  assert.doesNotMatch(response.body.message.content, /^\d\. |A few places come to mind|\$1,500/gm);
  assert.match(trip.brief?.notes.join(' ') || '', /vegetarian food/);
  const followup = await client
    .post('/api/chat')
    .send({
      tripId: trip.id,
      message: 'We also enjoy food and culture.',
    })
    .expect(200);
  assert.equal(followup.body.trip.destinationId, '');
  assert.equal(followup.body.trip.startDate, '2026-11-18');
  assert.doesNotMatch(followup.body.message.content, /^\d\. |A few places come to mind/gm);
});

test('an unsupported destination change preserves the existing itinerary and protected stop', async () => {
  const client = request.agent(makeApp());
  const created = await client
    .post('/api/chat')
    .send({
      message:
        'Plan 3 days in Kyoto starting 2026-11-18 for 2 travelers, budget USD $900. We enjoy culture. Just the itinerary, please.',
    })
    .expect(200);
  const itinerary = structuredClone(created.body.trip.itinerary);
  itinerary[0].items[0].title = 'My saved vegetarian breakfast';
  const edited = await client
    .patch(`/api/trips/${created.body.trip.id}`)
    .send({
      revision: created.body.trip.revision,
      itinerary,
    })
    .expect(200);
  const result = await client
    .post('/api/chat')
    .send({
      tripId: edited.body.trip.id,
      message:
        'Change my trip to Osaka for 5 days starting December 20, 2026. I want vegetarian food.',
    })
    .expect(200);
  assert.equal(result.body.trip.destinationId, 'kyoto');
  assert.equal(result.body.trip.startDate, edited.body.trip.startDate);
  assert.equal(result.body.trip.days, edited.body.trip.days);
  assert.deepEqual(result.body.trip.itinerary, edited.body.trip.itinerary);
  assert.deepEqual(
    result.body.trip.brief.destinationStops,
    edited.body.trip.brief.destinationStops,
  );
  assert.match(result.body.message.content, /Osaka/);
  assert.doesNotMatch(result.body.message.content, /A few places come to mind/);
});

test('open discovery asks a short intake question without presenting default budget or choosing a destination', async () => {
  const client = request.agent(makeApp());
  const result = await client
    .post('/api/chat')
    .send({
      message: 'Suggest somewhere for a 3-day beach escape for 2 travelers.',
    })
    .expect(200);
  assert.equal(result.body.trip.destinationId, '');
  assert.deepEqual(result.body.trip.itinerary, []);
  assert.equal(result.body.trip.brief.consultation.facts.budget, undefined);
  assert.equal(result.body.trip.brief.consultation.currency, 'AUD');
  assert.doesNotMatch(result.body.message.content, /\$1,500|flights (?:are )?separate|no flights/i);
  assert.ok(result.body.trip.planning.questions.length > 0);
  assert.ok(result.body.trip.planning.questions.length <= 2);
});

test('destination intent separates origins, unsupported places, discovery and ordinary edits', () => {
  const route = detectDestinationIntent('Travel from London to Kyoto for 4 days.');
  assert.equal(route.kind, 'explicit');
  assert.equal(route.kind === 'explicit' && route.destination?.id, 'kyoto');
  const writtenDuration = detectDestinationIntent('Plan four days in Kyoto for food and culture');
  assert.equal(writtenDuration.kind === 'explicit' && writtenDuration.destination?.id, 'kyoto');
  for (const message of [
    'I want to visit Atlantis for 3 days with food.',
    'Osaka for 4 days',
    'Plan Oslo',
  ]) {
    const intent = detectDestinationIntent(message);
    assert.equal(intent.kind, 'explicit');
    assert.equal(intent.kind === 'explicit' && intent.destination, undefined);
  }
  assert.equal(
    detectDestinationIntent('Where should we go for food and culture?').kind,
    'discovery',
  );
  for (const message of [
    'Less walking please',
    'We prefer vegetarian food.',
    'Add dinner in Soho',
    'Find lunch in restaurants with vegetarian food',
    'Birthday dinner',
    'Add dinner to my trip in Soho',
    'Plan a museum visit in Soho',
  ])
    assert.equal(detectDestinationIntent(message).kind, 'unspecified', message);
  assert.equal(matchDestination('I enjoy Balinese food and Parisian cafés'), undefined);
});

test('neighborhood activity edits do not become unsupported destination requests', async () => {
  const client = request.agent(makeApp());
  let result = await client
    .post('/api/chat')
    .send({
      message:
        'Plan 4 days in London starting 2026-11-18 for 2 travelers, budget USD 1500. We enjoy culture. Just the itinerary, please.',
    })
    .expect(200);
  for (const message of [
    'Add dinner in Soho',
    'Find lunch in restaurants with vegetarian food',
    'Birthday dinner',
  ]) {
    result = await client
      .post('/api/chat')
      .send({ tripId: result.body.trip.id, message })
      .expect(200);
    assert.equal(result.body.trip.destinationId, 'london');
    assert.equal(result.body.trip.days, 4);
    assert.equal(result.body.trip.startDate, '2026-11-18');
    assert.doesNotMatch(
      result.body.message.content,
      /not covered|not supported|unsupported|choose a supported destination/i,
    );
  }
});

test('beach discovery retains the requested budget and interests through intake without choosing a destination', async () => {
  const client = request.agent(makeApp());
  const result = await client
    .post('/api/chat')
    .send({ message: 'Suggest somewhere for a 3-day beach escape for 2 travelers, budget $900.' })
    .expect(200);
  assert.equal(result.body.trip.destinationId, '');
  assert.deepEqual(result.body.trip.itinerary, []);
  assert.equal(result.body.trip.days, 3);
  assert.equal(result.body.trip.budget, 900);
  assert.equal(result.body.trip.brief.consultation.facts.budget.source, 'message');
  assert.equal(result.body.trip.brief.consultation.currency, 'AUD');
  assert.ok(result.body.trip.planning.questions.length <= 2);
  assert.doesNotMatch(result.body.message.content, /\$1,500|flights (?:are )?separate/i);
  const selected = await client
    .post('/api/chat')
    .send({
      message: 'Bali please. Dates are flexible. Just the itinerary; we enjoy beaches.',
      tripId: result.body.trip.id,
    })
    .expect(200);
  assert.equal(selected.body.trip.destinationId, 'bali');
  assert.equal(selected.body.trip.budget, 900);
  assert.equal(selected.body.trip.days, 3);
  assert.ok(selected.body.trip.interests.includes('Beaches'));
});

test('weekly and hyphenated day durations remain distinct from traveler counts', async () => {
  const client = request.agent(makeApp());
  const fortnight = await client
    .post('/api/chat')
    .send({ message: itineraryRequest('Kyoto for 2 weeks') })
    .expect(200);
  assert.equal(fortnight.body.trip.days, 14);
  assert.equal(fortnight.body.trip.itinerary.length, 14);
  assert.equal(fortnight.body.trip.travelers, 2);
  const short = await client
    .post('/api/chat')
    .send({ message: itineraryRequest('Kyoto for 3-day trip') })
    .expect(200);
  assert.equal(short.body.trip.days, 3);
  assert.equal(short.body.trip.travelers, 2);
});

test('anonymous owners cannot read, mutate, share, export, or delete each other’s trips or saves', async () => {
  const app = makeApp(),
    alice = request.agent(app),
    bob = request.agent(app);
  const created = await alice.post('/api/chat').send({ message: '3 days in Bali' }).expect(200),
    id = created.body.trip.id;
  await bob.get(`/api/trips/${id}`).expect(404);
  await bob.patch(`/api/trips/${id}`).send({ title: 'stolen' }).expect(404);
  await bob.post(`/api/trips/${id}/share`).expect(404);
  await bob.get(`/api/trips/${id}/calendar.ics`).expect(404);
  await bob.delete(`/api/trips/${id}`).expect(404);
  assert.deepEqual((await bob.get('/api/trips').expect(200)).body.trips, []);
  const saved = await alice
    .post('/api/saved')
    .send({ type: 'destination', itemId: 'bali' })
    .expect(201);
  await bob.delete(`/api/saved/${saved.body.item.id}`).expect(404);
  assert.deepEqual((await bob.get('/api/saved')).body.items, []);
});

test('registration transfers anonymous data, stores scrypt hashes, and rotates/revokes sessions', async () => {
  const app = makeApp(),
    client = request.agent(app);
  const created = await client.post('/api/chat').send({ message: '4 days in Paris' }).expect(200);
  const oldCookie = created.headers['set-cookie'][0].split(';')[0];
  await client.post('/api/saved').send({ type: 'destination', itemId: 'paris' }).expect(201);
  const registered = await client
    .post('/api/auth/register')
    .send({ name: 'Sam', email: 'Sam@Example.com', password: 'a very good password' })
    .expect(201);
  assert.equal(registered.body.user.email, 'sam@example.com');
  assert.equal(registered.body.user.password_hash, undefined);
  const row = app.locals.db.prepare('SELECT password_hash FROM users').get();
  assert.notEqual(row.password_hash, 'a very good password');
  assert.match(row.password_hash, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.equal((await client.get('/api/trips')).body.trips.length, 1);
  assert.equal((await client.get('/api/saved')).body.items.length, 1);
  await request(app).get(`/api/trips/${created.body.trip.id}`).set('Cookie', oldCookie).expect(404);
  await client.post('/api/auth/logout').expect(200);
  assert.equal((await client.get('/api/session')).body.user, null);
  assert.equal((await client.get('/api/trips')).body.trips.length, 0);
  await client
    .post('/api/auth/login')
    .send({ email: 'sam@example.com', password: 'incorrect-password' })
    .expect(401);
  await client
    .post('/api/auth/login')
    .send({ email: 'sam@example.com', password: 'a very good password' })
    .expect(200);
  assert.equal((await client.get('/api/trips')).body.trips[0].id, created.body.trip.id);
});

test('signing into an existing account merges only anonymous data and deduplicates saves', async () => {
  const app = makeApp(),
    account = request.agent(app),
    guest = request.agent(app);
  const auth = { email: 'owner@example.com', password: 'safe-password-123' };
  await account
    .post('/api/auth/register')
    .send({ ...auth, name: 'Owner' })
    .expect(201);
  await account.post('/api/saved').send({ type: 'destination', itemId: 'kyoto' }).expect(201);
  const trip = (await guest.post('/api/chat').send({ message: '4 days in Kyoto' })).body.trip;
  await guest.post('/api/saved').send({ type: 'destination', itemId: 'kyoto' }).expect(201);
  await guest.post('/api/auth/login').send(auth).expect(200);
  assert.equal((await guest.get('/api/saved')).body.items.length, 1);
  await account.get(`/api/trips/${trip.id}`).expect(200);
  const other = request.agent(app);
  await other
    .post('/api/auth/register')
    .send({ name: 'Other', email: 'other@example.com', password: 'safe-password-123' })
    .expect(201);
  await other.post('/api/auth/login').send(auth).expect(409);
});

test('editing activities survives subsequent reads and date changes, and duration edits regenerate days', async () => {
  const client = request.agent(makeApp());
  const trip = (
    await client.post('/api/chat').send({ message: itineraryRequest('3 days in Kyoto') })
  ).body.trip as Trip;
  trip.itinerary[0].items[0].title = 'My favorite breakfast';
  trip.itinerary[0].items[0].completed = true;
  const edited = await client
    .patch(`/api/trips/${trip.id}`)
    .send({ itinerary: trip.itinerary, title: 'Spring escape', status: 'planned' })
    .expect(200);
  assert.equal(edited.body.trip.title, 'Spring escape');
  // The settings form sends all values, including unchanged planning details.
  const dated = await client
    .patch(`/api/trips/${trip.id}`)
    .send({
      title: 'Spring escape, updated',
      startDate: '2027-03-01',
      days: trip.days,
      travelers: trip.travelers,
      budget: trip.budget,
      interests: trip.interests,
    })
    .expect(200);
  assert.equal(dated.body.trip.itinerary[0].items[0].title, 'My favorite breakfast');
  assert.equal(dated.body.trip.itinerary[0].items[0].completed, true);
  assert.deepEqual(dated.body.trip.itinerary, edited.body.trip.itinerary);
  assert.equal(dated.body.trip.itinerary[0].items[0].locked, true);
  const resized = await client.patch(`/api/trips/${trip.id}`).send({ days: 5 }).expect(200);
  assert.equal(resized.body.trip.itinerary.length, 5);
  await client.patch(`/api/trips/${trip.id}`).send({ itinerary: trip.itinerary }).expect(400);
});

test('public share links omit chat, allow read-only access, and are revoked immediately', async () => {
  const app = makeApp(),
    owner = request.agent(app);
  const trip = (
    await owner.post('/api/chat').send({ message: itineraryRequest('5 days in Lisbon') })
  ).body.trip;
  const share = (await owner.post(`/api/trips/${trip.id}/share`).expect(200)).body;
  assert.match(share.url, /^\/shared\/[a-f0-9]{48}$/);
  const publicResponse = await request(app).get(`/api/shared/${share.shareToken}`).expect(200);
  assert.deepEqual(publicResponse.body.trip.messages, []);
  assert.equal(publicResponse.body.trip.shareToken, null);
  await request(app).patch(`/api/trips/${trip.id}`).send({ title: 'Public edit' }).expect(404);
  await owner.delete(`/api/trips/${trip.id}/share`).expect(204);
  await request(app).get(`/api/shared/${share.shareToken}`).expect(404);
});

test('calendar uses dated events, escaping and CRLF folding; undated trips cannot export', async () => {
  const client = request.agent(makeApp());
  const trip = (
    await client.post('/api/chat').send({ message: itineraryRequest('2 days in Kyoto') })
  ).body.trip as Trip;
  await client.get(`/api/trips/${trip.id}/calendar.ics`).expect(400);
  trip.itinerary[0].items[0].title = 'Kyoto, tea; walk\\view\nNext line';
  trip.itinerary[0].items[0].description = '京都'.repeat(70);
  await client
    .patch(`/api/trips/${trip.id}`)
    .send({ startDate: '2027-04-30', itinerary: trip.itinerary })
    .expect(200);
  const calendar = await client.get(`/api/trips/${trip.id}/calendar.ics`).expect(200);
  assert.match(calendar.headers['content-type'], /text\/calendar/);
  assert.match(calendar.text, /DTSTART:20270430T090000/);
  assert.match(calendar.text, /DTSTART:20270501T090000/);
  assert.ok(calendar.text.includes('SUMMARY:Kyoto\\, tea\\; walk\\\\view\\nNext line'));
  assert.ok(calendar.text.split('\r\n').every((line: string) => Buffer.byteLength(line) <= 75));
  assert.equal(calendar.text.replaceAll('\r\n', '').includes('\n'), false);
});

test('SQLite data and anonymous sessions survive application restart', async () => {
  const path = mkdtempSync(join(tmpdir(), 'asktara-test-'));
  temporaryPaths.push(path);
  const app = makeApp(join(path, 'test.sqlite'));
  const response = await request(app)
    .post('/api/chat')
    .send({ message: itineraryRequest('4 days in Madeira') })
    .expect(200);
  const cookie = response.headers['set-cookie'][0].split(';')[0];
  app.locals.db.close();
  const restarted = makeApp(join(path, 'test.sqlite'));
  const persisted = await request(restarted)
    .get(`/api/trips/${response.body.trip.id}`)
    .set('Cookie', cookie)
    .expect(200);
  assert.equal(persisted.body.trip.destinationId, 'madeira');
});

test('validation rejects invalid dates, excessive lengths, unknown fields, foreign origins, and malformed JSON', async () => {
  const client = request.agent(makeApp());
  await client.post('/api/chat').send({ message: '' }).expect(400);
  await client
    .post('/api/chat')
    .send({ message: 'x'.repeat(4001) })
    .expect(400);
  await client.post('/api/chat').send({ message: 'Kyoto', owner_id: 'forged' }).expect(400);
  await client
    .post('/api/chat')
    .set('Origin', 'https://evil.example')
    .send({ message: 'Kyoto' })
    .expect(403);
  await client
    .post('/api/chat')
    .set('Content-Type', 'application/json')
    .send('{broken')
    .expect(400);
  await client.post('/api/saved').send({ type: 'destination', itemId: 'not-a-place' }).expect(404);
  const trip = (
    await client.post('/api/chat').send({ message: itineraryRequest('3 days in Paris') })
  ).body.trip;
  for (const patch of [
    { startDate: '2027-02-31' },
    { days: 0 },
    { travelers: 0 },
    { budget: -1 },
    { shareToken: 'injected' },
    { messages: [] },
    {},
  ])
    await client.patch(`/api/trips/${trip.id}`).send(patch).expect(400);
});

test('provider status and absent flight/hotel credentials are explicit', async () => {
  const client = request.agent(makeApp());
  assert.deepEqual((await client.get('/api/integrations')).body, {
    ai: false,
    flights: false,
    hotels: false,
    activities: false,
    mode: 'local',
  });
  const flight = await client
    .post('/api/flights/search')
    .send({ origin: 'LHR', destination: 'JFK', departureDate: '2027-11-01' })
    .expect(503);
  assert.equal(flight.body.code, 'FLIGHTS_NOT_CONFIGURED');
  await client
    .post('/api/flights/search')
    .send({ origin: 'LHR', destination: 'LHR', departureDate: '2027-11-01' })
    .expect(400);
  const hotel = await client
    .post('/api/hotels/search')
    .send({
      destinationId: 'kyoto',
      checkin: '2027-11-01',
      checkout: '2027-11-05',
      guestNationality: 'PK',
    })
    .expect(503);
  assert.equal(hotel.body.code, 'HOTELS_NOT_CONFIGURED');
  assert.equal((await client.get('/api/catalog')).body.destinations.length, destinations.length);
});

test('AI provider failure returns an unavailable error without creating a replacement trip', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  globalThis.fetch = async () => new Response('{}', { status: 503 });
  const client = request.agent(makeApp());
  const response = await client
    .post('/api/chat')
    .send({ message: '6 days in Istanbul' })
    .expect(503);
  assert.equal(response.body.trip, undefined);
  assert.equal(response.body.mode, undefined);
  assert.match(response.body.error, /unavailable|could not|status 503/i);
  assert.deepEqual((await client.get('/api/trips').expect(200)).body.trips, []);
});

test('Duffel adapter sends validated requests and distinguishes test offers', async () => {
  process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_example';
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /^https:\/\/api\.duffel\.com\/air\/offer_requests/);
    const body = JSON.parse(String(options?.body));
    assert.equal(body.data.slices.length, 2);
    assert.equal(body.data.passengers.length, 2);
    assert.equal((options?.headers as Record<string, string>)['Duffel-Version'], 'v2');
    return Response.json({
      data: {
        offers: [
          {
            id: 'offer_1',
            owner: { name: 'Duffel Airways' },
            total_amount: '500.25',
            total_currency: 'USD',
            slices: [
              {
                duration: 'PT7H',
                segments: [
                  {
                    departing_at: '2027-11-01T09:00:00',
                    arriving_at: '2027-11-01T12:00:00',
                    origin: { iata_code: 'LHR' },
                    destination: { iata_code: 'JFK' },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
  };
  const response = await request(makeApp())
    .post('/api/flights/search')
    .send({
      origin: 'lhr',
      destination: 'jfk',
      departureDate: '2027-11-01',
      returnDate: '2027-11-10',
      adults: 2,
    })
    .expect(200);
  assert.equal(response.body.mode, 'test');
  assert.match(response.body.warning, /simulated/);
  assert.equal(response.body.offers[0].price, 500.25);
  assert.equal(response.body.roundTrip, true);
});

test('LiteAPI adapter can provide flight search and one key is enough for both services', async () => {
  process.env.LITEAPI_API_KEY = 'sand_liteapi_test_key';
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.liteapi.travel/v3.0/flights/rates');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.origin, undefined);
    assert.equal(body.legs.length, 1);
    assert.equal(body.legs[0].origin, 'LHR');
    assert.equal(body.legs[0].destination, 'JFK');
    return Response.json({
      sandbox: true,
      data: [
        {
          journeys: [
            {
              cheapestOffer: {
                offerId: 'lite-offer-1',
                pricing: { display: { currency: 'USD', total: '321.5' } },
              },
              legDurations: [
                { direction: 'OUTBOUND', duration: { iso8601: 'PT8H', minutes: 480 } },
              ],
              segments: [
                {
                  direction: 'OUTBOUND',
                  originCode: 'LHR',
                  destinationCode: 'JFK',
                  departureTime: '2027-11-01T09:00:00',
                  arrivalTime: '2027-11-01T17:00:00',
                  duration: { iso8601: 'PT8H', minutes: 480 },
                  flight: { marketingNumber: 'AB123' },
                },
              ],
            },
          ],
        },
      ],
    });
  };
  const response = await request(makeApp())
    .post('/api/flights/search')
    .send({
      origin: 'lhr',
      destination: 'jfk',
      departureDate: '2027-11-01',
      adults: 2,
    })
    .expect(200);
  assert.equal(response.body.mode, 'test');
  assert.equal(response.body.roundTrip, false);
  assert.equal(response.body.offers[0].id, 'lite-offer-1');
  assert.equal(response.body.offers[0].price, 321.5);
  assert.equal(response.body.offers[0].currency, 'USD');
  assert.equal(response.body.offers[0].airline, 'Airline unavailable');
  assert.equal(response.body.offers[0].journeys?.length, 1);
  assert.equal(response.body.offers[0].journeys?.[0].duration, 'PT8H');
});

test('live structured agent plan is validated, persisted, and cannot restore a revoked share link', async () => {
  const app = makeApp(),
    client = request.agent(app);
  const trip = (
    await client.post('/api/chat').send({ message: itineraryRequest('2 days in Kyoto') })
  ).body.trip as Trip;
  const token = (await client.post(`/api/trips/${trip.id}/share`)).body.shareToken;
  process.env.OPENAI_API_KEY = 'test-key';
  let respond!: (value: Response) => void, started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const researchUrl = 'https://kyoto.travel/en/';
  const response = (value: unknown, researched = false) =>
    Response.json({
      status: 'completed',
      output: [
        ...(researched
          ? [
              {
                type: 'web_search_call',
                status: 'completed',
                action: { sources: [{ url: researchUrl, title: 'Kyoto tourism' }] },
              },
            ]
          : []),
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
      ],
    });
  const schemas: string[] = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.store, false);
    assert.equal(body.text.format.type, 'json_schema');
    schemas.push(body.text.format.name);
    if (body.text.format.name === 'travel_intake') {
      const delayed = new Promise<Response>((resolve) => {
        respond = resolve;
      });
      started();
      assert.match(body.instructions, /never infer nationality/i);
      return delayed;
    }
    if (body.text.format.name === 'destination_research') {
      assert.ok(body.tools.some((tool: { type: string }) => tool.type === 'web_search'));
      const input = JSON.parse(body.input[0].content);
      assert.deepEqual(input.destinationRequests, [{ name: 'Kyoto', days: 2 }]);
      const kyoto = destinations.find((destination) => destination.id === 'kyoto')!;
      return response(
        {
          reply: 'Kyoto has researched garden and cultural options for a quiet visit.',
          summary: 'Kyoto has researched garden and cultural options for a quiet visit.',
          questions: [],
          destinations: [
            {
              requestIndex: 0,
              requestedName: 'Kyoto',
              name: 'Kyoto',
              country: 'Japan',
              region: 'Asia',
              description: 'Kyoto has historic gardens and temples.',
              bestTime: 'Check seasonal conditions for the travel dates.',
              dailyBudget: kyoto.dailyBudget,
              coordinates: { latitude: kyoto.coordinates[0], longitude: kyoto.coordinates[1] },
              tags: ['Culture'],
              vibe: 'Culture & charm',
              sourceUrls: [researchUrl],
            },
          ],
          places: [
            {
              destinationIndex: 0,
              name: 'Temple garden',
              address: 'Kyoto, Japan',
              category: 'sight',
              description: 'A researched garden option.',
              suitability: ['Confirm opening times directly.'],
              durationMinutes: 90,
              estimatedCost: 10,
              coordinates: null,
              sourceUrls: [researchUrl],
            },
          ],
        },
        true,
      );
    }
    if (body.text.format.name === 'place_verification') {
      assert.ok(body.tools.some((tool: { type: string }) => tool.type === 'web_search'));
      const input = JSON.parse(body.input[0].content);
      assert.equal(input.places.length, 1);
      return response(
        {
          places: input.places.map((place: { id: string }) => ({
            id: place.id,
            status: 'no_closure_found',
            reason: 'No dated closure found; confirm opening hours directly.',
            sourceUrls: [researchUrl],
            closureDate: null,
            reopeningDate: null,
          })),
        },
        true,
      );
    }
    assert.equal(body.text.format.name, 'itinerary_composition');
    assert.match(body.instructions, /Use only supplied place IDs/i);
    return response({
      summary: 'A quieter visit with time to pause.',
      days: [
        { day: 1, title: 'A quiet afternoon', placeIds: [], note: 'Leave room to pause.' },
        { day: 2, title: 'An unhurried day', placeIds: [], note: 'Explore slowly.' },
      ],
    });
  };
  const pending = client
    .post('/api/chat')
    .send({ message: 'Suggest a quieter afternoon', tripId: trip.id })
    .timeout(8000)
    .then((result) => result);
  await waitForProviderStart(startedPromise, pending);
  await client.delete(`/api/trips/${trip.id}/share`).expect(204);
  await client.patch(`/api/trips/${trip.id}`).send({ title: 'Concurrent edit' }).expect(409);
  respond(
    response({
      destinationStops: [{ destinationId: 'kyoto', days: 2 }],
      destinationRequests: [{ name: 'Kyoto', days: 2 }],
      intent: 'plan',
      reply: 'I will adjust your Kyoto itinerary.',
      startDate: trip.startDate,
      days: 2,
      travelers: trip.travelers,
      budget: trip.budget,
      interests: ['Relaxation'],
      pace: 'relaxed',
      originAirport: '',
      arrivalAirport: '',
      guestNationality: '',
      includeFlights: false,
      includeHotels: false,
      notes: [],
    }),
  );
  const result = await pending;
  assert.equal(result.status, 200);
  assert.equal(result.body.mode, 'live');
  assert.deepEqual(schemas, [
    'travel_intake',
    'destination_research',
    'place_verification',
    'itinerary_composition',
  ]);
  assert.equal(result.body.trip.itinerary[0].title, 'A quiet afternoon');
  assert.equal(result.body.trip.shareToken, null);
  await request(app).get(`/api/shared/${token}`).expect(404);
});

test('in-flight AI work cannot write or return an old owner’s trip after logout', async () => {
  const app = makeApp(),
    client = request.agent(app);
  await client
    .post('/api/auth/register')
    .send({ name: 'Owner', email: 'race@example.com', password: 'safe-password-123' })
    .expect(201);
  const trip = (
    await client.post('/api/chat').send({ message: itineraryRequest('2 days in Kyoto') })
  ).body.trip as Trip;
  process.env.OPENAI_API_KEY = 'test-key';
  let respond!: (value: Response) => void, started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  globalThis.fetch = async () => {
    started();
    return new Promise<Response>((resolve) => {
      respond = resolve;
    });
  };
  const pending = client
    .post('/api/chat')
    .send({ message: 'Make it 3 days', tripId: trip.id })
    .timeout(8000)
    .then((result) => result);
  await waitForProviderStart(startedPromise, pending);
  await client.post('/api/auth/logout').expect(200);
  respond(new Response('{}', { status: 503 }));
  const result = await pending;
  assert.equal(result.status, 409);
  assert.match(result.body.error, /session changed/i);
  assert.equal(result.body.trip, undefined);
  assert.equal(
    JSON.parse(
      String(app.locals.db.prepare('SELECT data FROM trips WHERE id = ?').get(trip.id).data),
    ).messages.length,
    2,
  );
  await client.get(`/api/trips/${trip.id}`).expect(404);
});

test('signing in while a new guest plan is generating cannot leave a trip under an orphaned owner', async () => {
  const app = makeApp(),
    client = request.agent(app);
  await client.get('/api/session').expect(200);
  process.env.OPENAI_API_KEY = 'test-key';
  let respond!: (value: Response) => void, started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  globalThis.fetch = async () => {
    started();
    return new Promise<Response>((resolve) => {
      respond = resolve;
    });
  };
  const pending = client
    .post('/api/chat')
    .send({ message: itineraryRequest('3 days in Kyoto') })
    .timeout(8000)
    .then((result) => result);
  await waitForProviderStart(startedPromise, pending);
  await client
    .post('/api/auth/register')
    .send({ name: 'New owner', email: 'guest-race@example.com', password: 'safe-password-123' })
    .expect(201);
  respond(new Response('{}', { status: 503 }));
  const result = await pending;
  assert.equal(result.status, 409);
  assert.equal(Number(app.locals.db.prepare('SELECT COUNT(*) AS count FROM trips').get().count), 0);
});

test('untrusted AI output fails without altering the saved destination, days or itinerary', async () => {
  const client = request.agent(makeApp());
  const trip = (
    await client.post('/api/chat').send({ message: itineraryRequest('3 days in Kyoto') })
  ).body.trip as Trip;
  const saved = (await client.get(`/api/trips/${trip.id}`).expect(200)).body.trip;
  process.env.OPENAI_API_KEY = 'test-key';
  globalThis.fetch = async () =>
    Response.json({
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                reply: 'Done',
                destinationId: 'invented-place',
                startDate: '',
                days: 3,
                travelers: 2,
                budget: 1500,
                interests: [],
                itinerary: trip.itinerary,
              }),
            },
          ],
        },
      ],
    });
  const result = await client
    .post('/api/chat')
    .send({ message: 'Make it 5 days', tripId: trip.id })
    .expect(500);
  assert.equal(result.body.trip, undefined);
  assert.match(result.body.error, /saved trip is unchanged/i);
  assert.deepEqual((await client.get(`/api/trips/${trip.id}`).expect(200)).body.trip, saved);
});

test('calendar activity IDs cannot inject extra events through request input', async () => {
  const client = request.agent(makeApp());
  const trip = (
    await client.post('/api/chat').send({ message: itineraryRequest('2 days in Paris') })
  ).body.trip as Trip;
  trip.itinerary[0].items[0].id = 'malicious\r\nBEGIN:VEVENT';
  await client.patch(`/api/trips/${trip.id}`).send({ itinerary: trip.itinerary }).expect(400);
});

test('LiteAPI adapter uses catalog coordinates, guest nationality and clearly marked test rates', async () => {
  process.env.LITEAPI_API_KEY = 'test-hotel-key';
  process.env.LITEAPI_MODE = 'live';
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.liteapi.travel/v3.0/hotels/rates');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.latitude, destinations.find((d) => d.id === 'kyoto')!.coordinates[0]);
    assert.equal(body.guestNationality, 'PK');
    assert.equal(body.occupancies[0].adults, 2);
    return Response.json({
      sandbox: true,
      hotels: [{ id: 'hotel_1', name: 'Provider Hotel', address: 'Kyoto' }],
      data: [
        {
          hotelId: 'hotel_1',
          roomTypes: [
            {
              offerId: 'room_1',
              rates: [
                { name: 'Double room', retailRate: { total: [{ amount: 400, currency: 'USD' }] } },
              ],
            },
          ],
        },
      ],
    });
  };
  const response = await request(makeApp())
    .post('/api/hotels/search')
    .send({
      destinationId: 'kyoto',
      checkin: '2027-11-01',
      checkout: '2027-11-05',
      guestNationality: 'pk',
    })
    .expect(200);
  assert.equal(response.body.mode, 'test');
  assert.match(response.body.warning, /test mode/);
  assert.equal(response.body.offers[0].price, 400);
  assert.equal(response.body.offers[0].name, 'Provider Hotel');
});
