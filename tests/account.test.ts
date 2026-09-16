import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.ts';
import { runPlanningWorkflow } from '../server/agents/index.ts';
import type { WorkflowResult } from '../shared/planning.ts';

const apps: ReturnType<typeof createApp>[] = [];
const keys = ['OPENAI_API_KEY', 'DUFFEL_ACCESS_TOKEN', 'LITEAPI_API_KEY', 'GOOGLE_PLACES_API_KEY'];
const initialEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
beforeEach(() => {
  for (const key of keys) delete process.env[key];
});
after(async () => {
  for (const app of apps) {
    await app.locals.planningRuns.shutdown();
    app.locals.db.close();
  }
  for (const [key, value] of Object.entries(initialEnv))
    value === undefined ? delete process.env[key] : (process.env[key] = value);
});
function makeApp(options: Parameters<typeof createApp>[1] = {}) {
  const app = createApp(':memory:', options);
  apps.push(app);
  return app;
}
const credentials = { email: 'account@example.com', password: 'correct-password-123' };
const itineraryRequest = (message: string) =>
  `${message}. For 2 adults, dates are flexible, budget USD 1500. We enjoy culture. Just the itinerary, please.`;
const register = (client: ReturnType<typeof request.agent>, email = credentials.email) =>
  client
    .post('/api/auth/register')
    .send({ ...credentials, email, name: 'Traveler' })
    .expect(201);

test('profiles normalize and validate input and remain isolated between owners', async () => {
  const app = makeApp(),
    alice = request.agent(app),
    bob = request.agent(app);
  const initial = await alice.get('/api/profile').expect(200);
  assert.equal(initial.body.profile.pace, 'balanced');
  const saved = await alice
    .patch('/api/profile')
    .send({
      pace: 'relaxed',
      interests: ['Food', 'Food', 'Art'],
      originAirport: ' khi ',
      guestNationality: 'pk',
    })
    .expect(200);
  assert.deepEqual(saved.body.profile.interests, ['Food', 'Art']);
  assert.equal(saved.body.profile.originAirport, 'KHI');
  assert.equal(saved.body.profile.guestNationality, 'PK');
  assert.ok(saved.body.profile.updatedAt);
  assert.equal((await bob.get('/api/profile')).body.profile.originAirport, '');
  await alice.patch('/api/profile').send({ ownerId: 'other', pace: 'active' }).expect(400);
  await alice.patch('/api/profile').send({ originAirport: 'Karachi' }).expect(400);
  await alice.patch('/api/profile').send({}).expect(400);
  await alice.patch('/api/profile').send({ interests: [], originAirport: '' }).expect(200);
  assert.equal((await alice.get('/api/profile')).body.profile.pace, 'relaxed');
});

test('guest preferences transfer on registration and follow the account across sessions', async () => {
  const app = makeApp(),
    first = request.agent(app),
    second = request.agent(app);
  await first.patch('/api/profile').send({ pace: 'active', originAirport: 'LHR' }).expect(200);
  const guestOwner = app.locals.db.prepare('SELECT owner_id FROM travel_profiles').get().owner_id;
  await register(first);
  await second.post('/api/auth/login').send(credentials).expect(200);
  assert.equal((await second.get('/api/profile')).body.profile.originAirport, 'LHR');
  assert.equal(
    app.locals.db
      .prepare('SELECT COUNT(*) AS count FROM travel_profiles WHERE owner_id = ?')
      .get(guestOwner).count,
    0,
  );
  await first.post('/api/auth/logout').expect(200);
  assert.equal((await first.get('/api/profile')).body.profile.originAirport, '');
});

test('an existing account profile wins over guest preferences during sign-in', async () => {
  const app = makeApp(),
    account = request.agent(app),
    guest = request.agent(app);
  await register(account);
  await account
    .patch('/api/profile')
    .send({ pace: 'relaxed', interests: ['Culture'], originAirport: 'KHI' })
    .expect(200);
  await guest
    .patch('/api/profile')
    .send({ pace: 'active', interests: ['Adventure'], originAirport: 'JFK' })
    .expect(200);
  await guest.post('/api/auth/login').send(credentials).expect(200);
  const profile = (await guest.get('/api/profile')).body.profile;
  assert.equal(profile.pace, 'relaxed');
  assert.equal(profile.originAirport, 'KHI');
  assert.deepEqual(profile.interests, ['Culture']);
  assert.equal(
    app.locals.db.prepare('SELECT COUNT(*) AS count FROM travel_profiles').get().count,
    1,
  );
});

test('profile defaults reach actual new plans while explicit requests win and existing trips retain settings', async () => {
  const app = makeApp(),
    client = request.agent(app);
  await client
    .patch('/api/profile')
    .send({ pace: 'relaxed', interests: ['Food'], originAirport: 'KHI', guestNationality: 'PK' })
    .expect(200);
  const first = await client
    .post('/api/chat')
    .send({ message: 'Plan 3 days in Kyoto' })
    .expect(200);
  assert.equal(first.body.trip.brief.pace, 'relaxed');
  assert.equal(first.body.trip.brief.originAirport, 'KHI');
  assert.ok(first.body.trip.interests.includes('Food'));
  assert.equal(first.body.trip.messages[0].content, 'Plan 3 days in Kyoto');
  await client.patch('/api/profile').send({ pace: 'active', originAirport: 'LHR' }).expect(200);
  const existing = await client
    .post('/api/chat')
    .send({ tripId: first.body.trip.id, message: 'Keep the same details' })
    .expect(200);
  assert.equal(existing.body.trip.brief.pace, 'relaxed');
  assert.equal(existing.body.trip.brief.originAirport, 'KHI');
  const explicit = await client
    .post('/api/chat')
    .send({ message: 'Plan 2 relaxed days in Paris from JFK', brief: { guestNationality: 'GB' } })
    .expect(200);
  assert.equal(explicit.body.trip.brief.pace, 'relaxed');
  assert.equal(explicit.body.trip.brief.originAirport, 'JFK');
  assert.equal(explicit.body.trip.brief.guestNationality, 'GB');
});

test('account details require sign-in and profile name updates are shared across sessions', async () => {
  const app = makeApp(),
    client = request.agent(app),
    other = request.agent(app);
  await client.get('/api/account').expect(401);
  await client.patch('/api/account').send({ name: 'New' }).expect(401);
  await register(client);
  await other.post('/api/auth/login').send(credentials).expect(200);
  const updated = await client.patch('/api/account').send({ name: ' New name ' }).expect(200);
  assert.equal(updated.body.user.name, 'New name');
  const details = (await client.get('/api/account')).body.account;
  assert.equal(details.otherSessions, 1);
  assert.equal(details.password_hash, undefined);
  assert.equal((await other.get('/api/session')).body.user.name, 'New name');
  await client.patch('/api/account').send({ email: 'different@example.com' }).expect(400);
});

test('password change verifies the current password, rotates this session and revokes all others', async () => {
  const app = makeApp(),
    current = request.agent(app),
    other = request.agent(app);
  const registered = await register(current);
  const oldCookie = String(registered.headers['set-cookie'][0]).split(';')[0];
  await other.post('/api/auth/login').send(credentials).expect(200);
  await current
    .post('/api/account/password')
    .send({ currentPassword: 'wrong', newPassword: 'replacement-password' })
    .expect(401);
  await other.get('/api/account').expect(200);
  await current
    .post('/api/account/password')
    .send({ currentPassword: credentials.password, newPassword: 'replacement-password' })
    .expect(200);
  await current.get('/api/account').expect(200);
  await other.get('/api/account').expect(401);
  await request(app).get('/api/account').set('Cookie', oldCookie).expect(401);
  await other.post('/api/auth/login').send(credentials).expect(401);
  await other
    .post('/api/auth/login')
    .send({ ...credentials, password: 'replacement-password' })
    .expect(200);
  const stored = String(
    app.locals.db.prepare('SELECT password_hash FROM users').get().password_hash,
  );
  assert.match(stored, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.ok(!stored.includes('replacement-password'));
});

test('revoking another session aborts its planning request and keeps the current session active', async () => {
  let signal: AbortSignal | undefined;
  const app = makeApp({
    workflow: async (input) => {
      signal = input.signal;
      return new Promise<WorkflowResult>(() => {});
    },
  });
  const current = request.agent(app),
    other = request.agent(app);
  await register(current);
  await other.post('/api/auth/login').send(credentials).expect(200);
  const started = await other
    .post('/api/planning/runs')
    .send({ message: 'Plan Kyoto', requestId: randomUUID() })
    .expect(202);
  await new Promise((resolve) => setImmediate(resolve));
  await current.post('/api/account/sessions/revoke').send({ currentPassword: 'wrong' }).expect(401);
  assert.equal(signal?.aborted, false);
  const revoked = await current
    .post('/api/account/sessions/revoke')
    .send({ currentPassword: credentials.password })
    .expect(200);
  assert.equal(revoked.body.revoked, 1);
  assert.equal(signal?.aborted, true);
  assert.equal(
    (await current.get(`/api/planning/runs/${started.body.run.id}`)).body.run.status,
    'failed',
  );
  await other.get('/api/account').expect(401);
  await current.get('/api/account').expect(200);
});

test('account export contains only owned data and excludes authentication and share credentials', async () => {
  const app = makeApp(),
    alice = request.agent(app),
    bob = request.agent(app);
  await register(alice);
  await register(bob, 'bob@example.com');
  const trip = (await alice.post('/api/chat').send({ message: 'Plan 2 days in Kyoto' }).expect(200))
    .body.trip;
  const other = (await bob.post('/api/chat').send({ message: 'Plan 3 days in Paris' }).expect(200))
    .body.trip;
  const share = (await alice.post(`/api/trips/${trip.id}/share`).expect(200)).body.shareToken;
  await alice.post('/api/saved').send({ type: 'destination', itemId: 'kyoto' }).expect(201);
  const response = await alice.get('/api/account/export').expect(200);
  assert.match(response.headers['content-disposition'], /asktara-account.json/);
  assert.equal(response.body.trips.length, 1);
  assert.equal(response.body.trips[0].id, trip.id);
  assert.equal(response.body.trips[0].sharingEnabled, true);
  assert.equal(response.body.saved[0].itemId, 'kyoto');
  assert.ok(response.body.revisions.length > 0);
  const serialized = JSON.stringify(response.body);
  for (const secret of [other.id, 'password_hash', credentials.password, share, 'session_id'])
    assert.ok(!serialized.includes(secret));
});

test('account deletion requires explicit confirmation, removes all owned data and aborts active work', async () => {
  let activeSignal: AbortSignal | undefined;
  const app = makeApp({
    workflow: async (input) => {
      if (input.message === 'Wait for deletion') {
        activeSignal = input.signal;
        return new Promise<WorkflowResult>(() => {});
      }
      return runPlanningWorkflow(input);
    },
  });
  const owner = request.agent(app),
    otherSession = request.agent(app),
    outsider = request.agent(app);
  const user = (await register(owner)).body.user;
  await otherSession.post('/api/auth/login').send(credentials).expect(200);
  const other = (await register(outsider, 'other@example.com')).body.user;
  const trip = (await owner.post('/api/chat').send({ message: 'Plan 2 days in Kyoto' }).expect(200))
    .body.trip;
  const token = (await owner.post(`/api/trips/${trip.id}/share`).expect(200)).body.shareToken;
  await owner
    .patch('/api/profile')
    .send({ interests: ['Food'] })
    .expect(200);
  await owner.post('/api/saved').send({ type: 'destination', itemId: 'kyoto' }).expect(201);
  await owner.delete('/api/account').send({ currentPassword: credentials.password }).expect(400);
  await owner
    .delete('/api/account')
    .send({ currentPassword: 'wrong', confirmation: 'DELETE' })
    .expect(401);
  await owner.get(`/api/trips/${trip.id}`).expect(200);
  await otherSession
    .post('/api/planning/runs')
    .send({ message: 'Wait for deletion', tripId: trip.id, requestId: randomUUID() })
    .expect(202);
  await new Promise((resolve) => setImmediate(resolve));
  await owner
    .delete('/api/account')
    .send({ currentPassword: credentials.password, confirmation: 'DELETE' })
    .expect(200);
  assert.equal(activeSignal?.aborted, true);
  await new Promise((resolve) => setImmediate(resolve));
  for (const table of ['trips', 'saved', 'travel_profiles', 'planning_runs'])
    assert.equal(
      app.locals.db
        .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id = ?`)
        .get(user.id).count,
      0,
    );
  assert.equal(
    app.locals.db.prepare('SELECT COUNT(*) AS count FROM trip_revisions').get().count,
    0,
  );
  assert.equal(
    app.locals.db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(user.id)
      .count,
    0,
  );
  await request(app).get(`/api/shared/${token}`).expect(404);
  await otherSession.get('/api/account').expect(401);
  assert.equal((await owner.get('/api/session')).body.user, null);
  assert.equal((await outsider.get('/api/account')).body.account.id, other.id);
  await owner.post('/api/auth/login').send(credentials).expect(401);
});

test('failed account deletion rolls back all persistent account and trip removal', async () => {
  const app = makeApp(),
    client = request.agent(app);
  await register(client);
  const trip = (
    await client.post('/api/chat').send({ message: 'Plan 2 days in Paris' }).expect(200)
  ).body.trip;
  await client.patch('/api/profile').send({ pace: 'relaxed' }).expect(200);
  app.locals.db.exec(
    "CREATE TRIGGER reject_account_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'test rollback'); END;",
  );
  await client
    .delete('/api/account')
    .send({ currentPassword: credentials.password, confirmation: 'DELETE' })
    .expect(500);
  await client.get('/api/account').expect(200);
  await client.get(`/api/trips/${trip.id}`).expect(200);
  assert.equal((await client.get('/api/profile')).body.profile.pace, 'relaxed');
  assert.ok(app.locals.db.prepare('SELECT COUNT(*) AS count FROM trip_revisions').get().count > 0);
});

test('a password changed during an in-flight login cannot mint a session from old credentials', async () => {
  const app = makeApp(),
    owner = request.agent(app),
    signingIn = request.agent(app);
  await register(owner);
  const db = app.locals.db;
  const prepare = db.prepare.bind(db);
  let changed = false;
  db.prepare = (sql: string) => {
    const statement = prepare(sql);
    if (sql === 'SELECT id, name, email, password_hash FROM users WHERE email = ?') {
      return {
        get: (...args: unknown[]) => {
          const row = statement.get(...args);
          if (row && !changed) {
            changed = true;
            // Schedule the credential change after the login has read its snapshot,
            // while the real asynchronous scrypt operation is still pending.
            queueMicrotask(() =>
              prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
                `${'12'.repeat(16)}:${'34'.repeat(64)}`,
                row.id,
              ),
            );
          }
          return row;
        },
      };
    }
    return statement;
  };
  try {
    await signingIn.post('/api/auth/login').send(credentials).expect(401);
    assert.equal(changed, true);
    assert.equal((await signingIn.get('/api/session')).body.user, null);
    assert.equal(
      prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id IS NOT NULL').get().count,
      1,
    );
  } finally {
    db.prepare = prepare;
  }
});

test('dietary and accessibility preference allowlists reject unknown values and older profiles receive empty defaults', async () => {
  const app = makeApp(),
    client = request.agent(app);
  await register(client);
  const userId = (await client.get('/api/session')).body.user.id;
  app.locals.db.prepare('INSERT INTO travel_profiles (owner_id, data) VALUES (?, ?)').run(
    userId,
    JSON.stringify({
      pace: 'relaxed',
      interests: ['Food'],
      originAirport: 'KHI',
      guestNationality: 'PK',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }),
  );
  const old = (await client.get('/api/profile').expect(200)).body.profile;
  assert.equal(old.pace, 'relaxed');
  assert.deepEqual(old.dietaryPreferences, []);
  assert.deepEqual(old.accessibilityPreferences, []);
  assert.equal(old.planningNotes, '');
  await client
    .patch('/api/profile')
    .send({ dietaryPreferences: ['Unspecified restriction'] })
    .expect(400);
  await client
    .patch('/api/profile')
    .send({ accessibilityPreferences: ['Guaranteed access'] })
    .expect(400);
  await client
    .patch('/api/profile')
    .send({ planningNotes: 'x'.repeat(501) })
    .expect(400);
  const updated = await client
    .patch('/api/profile')
    .send({
      dietaryPreferences: ['Vegan', 'Vegan', 'Nut allergy'],
      accessibilityPreferences: ['Step-free access', 'Elevator'],
      planningNotes: ' Quiet stays and craft markets. ',
    })
    .expect(200);
  assert.deepEqual(updated.body.profile.dietaryPreferences, ['Vegan', 'Nut allergy']);
  assert.equal(updated.body.profile.planningNotes, 'Quiet stays and craft markets.');
  assert.equal(updated.body.profile.originAirport, 'KHI');
});

test('dietary and access requirements reach the saved plan and review without claiming verified suitability', async () => {
  const app = makeApp(),
    client = request.agent(app);
  await client
    .patch('/api/profile')
    .send({
      dietaryPreferences: ['Halal', 'Nut allergy'],
      accessibilityPreferences: ['Wheelchair access', 'Accessible bathroom'],
      planningNotes: 'Stay near craft markets and avoid nightlife.',
    })
    .expect(200);
  const first = (
    await client
      .post('/api/chat')
      .send({ message: itineraryRequest('Plan 2 days in Kyoto') })
      .expect(200)
  ).body.trip;
  assert.match(first.brief.notes.join(' '), /Halal, Nut allergy/);
  assert.match(first.brief.notes.join(' '), /Wheelchair access, Accessible bathroom/);
  assert.ok(first.brief.notes.includes('Stay near craft markets and avoid nightlife.'));
  const warning = first.planning.issues.find(
    (issue: { code: string }) => issue.code === 'requirements_unverified',
  );
  assert.equal(warning.severity, 'warning');
  assert.match(warning.message, /suitability has not been verified/);
  assert.match(warning.message, /Confirm them directly/);
  await client
    .patch('/api/profile')
    .send({ dietaryPreferences: [], accessibilityPreferences: [], planningNotes: '' })
    .expect(200);
  const existing = (
    await client
      .post('/api/chat')
      .send({ tripId: first.id, message: 'Keep this trip the same' })
      .expect(200)
  ).body.trip;
  assert.deepEqual(existing.brief.notes, first.brief.notes);
  const changed = (
    await client
      .patch(`/api/trips/${first.id}`)
      .send({
        revision: existing.revision,
        brief: { ...existing.brief, notes: ['Quiet stays only for this journey.'] },
      })
      .expect(200)
  ).body.trip;
  assert.deepEqual(changed.brief.notes, ['Quiet stays only for this journey.']);
  assert.ok(
    !changed.planning?.issues.some(
      (issue: { code: string }) => issue.code === 'requirements_unverified',
    ),
  );
  const next = (
    await client.post('/api/chat').send({ message: 'Plan 2 days in Paris' }).expect(200)
  ).body.trip;
  assert.deepEqual(next.brief.notes, []);
});

test('AI intake cannot silently discard saved requirements before itinerary composition', async () => {
  const app = makeApp(),
    client = request.agent(app);
  await client
    .patch('/api/profile')
    .send({
      dietaryPreferences: ['Gluten-free'],
      accessibilityPreferences: ['Ground-floor room'],
      planningNotes: 'Prefer quiet stays.',
    })
    .expect(200);
  process.env.OPENAI_API_KEY = 'unit-test-model-key';
  const originalFetch = globalThis.fetch;
  let compositionNotes: string[] = [];
  let compositionInstructions = '';
  const modelResponse = (value: unknown, web = false) =>
    Response.json({
      status: 'completed',
      output: [
        ...(web
          ? [
              {
                type: 'web_search_call',
                status: 'completed',
                action: { sources: [{ url: 'https://kyoto.travel/en/', title: 'Kyoto Tourism' }] },
              },
            ]
          : []),
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
      ],
    });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const input = JSON.parse(body.input[0].content);
    if (body.text.format.name === 'travel_intake')
      return modelResponse({
        ...input.current,
        days: 2,
        destinationRequests: [{ name: 'Kyoto', days: 2 }],
        intent: 'plan',
        reply: 'I will plan Kyoto.',
        notes: [],
      });
    if (body.text.format.name === 'place_verification')
      return modelResponse(
        {
          places: input.places.map((place: { id: string }) => ({
            id: place.id,
            status: 'no_closure_found',
            reason: 'No current closure notice found; confirm hours directly.',
            sourceUrls: ['https://kyoto.travel/en/'],
            closureDate: null,
            reopeningDate: null,
          })),
        },
        true,
      );
    if (body.text.format.name === 'destination_research')
      return modelResponse(
        {
          reply: 'Consider these Kyoto places for your visit.',
          summary: 'Researched Kyoto places.',
          questions: [],
          destinations: [
            {
              requestIndex: 0,
              requestedName: 'Kyoto',
              name: 'Kyoto',
              country: 'Japan',
              region: 'Asia',
              description: 'A historic city in Japan.',
              bestTime: 'Check seasonal conditions.',
              dailyBudget: 100,
              coordinates: { latitude: 35.0116, longitude: 135.7681 },
              tags: ['Culture'],
              vibe: 'Culture & charm',
              sourceUrls: ['https://kyoto.travel/en/'],
            },
          ],
          places: ['Temple gardens', 'Craft museum'].map((name) => ({
            destinationIndex: 0,
            name,
            address: 'Kyoto, Japan',
            category: 'sight',
            description: 'A researched cultural stop.',
            suitability: ['Confirm access directly.'],
            durationMinutes: 60,
            estimatedCost: 10,
            coordinates: null,
            sourceUrls: ['https://kyoto.travel/en/'],
          })),
        },
        true,
      );
    compositionNotes = input.brief.notes;
    compositionInstructions = body.instructions;
    return modelResponse({
      summary: 'Two flexible days in Kyoto.',
      days: [
        { day: 1, title: 'Explore Kyoto', placeIds: [input.places[0].id], note: '' },
        { day: 2, title: 'A flexible Kyoto day', placeIds: [input.places[1].id], note: '' },
      ],
    });
  };
  try {
    const result = await client
      .post('/api/chat')
      .send({ message: itineraryRequest('Plan 2 days in Kyoto') })
      .expect(200);
    assert.equal(result.body.mode, 'live');
    assert.match(compositionNotes.join(' '), /Gluten-free/);
    assert.match(compositionNotes.join(' '), /Ground-floor room/);
    assert.ok(compositionNotes.includes('Prefer quiet stays.'));
    assert.match(
      compositionInstructions,
      /never claim all dietary\/accessibility needs are verified/i,
    );
    assert.ok(
      result.body.trip.planning.issues.some(
        (issue: { code: string }) => issue.code === 'requirements_unverified',
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
