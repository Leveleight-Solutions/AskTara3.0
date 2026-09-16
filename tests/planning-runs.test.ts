import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { localPlan } from '../server/planner.ts';
import type { WorkflowInput, WorkflowResult, PlanningRun } from '../shared/planning.ts';
import type { Trip } from '../shared/types.ts';
import { defaultConsultation } from '../shared/consultation.ts';
import { defaultBrief } from '../server/agents/schedule.ts';

const apps: ReturnType<typeof createApp>[] = [];
const paths: string[] = [];
function fixtureResult(input: WorkflowInput): WorkflowResult {
  const result = localPlan(input.trip, input.message);
  return {
    ...result,
    mode: 'local',
    report: {
      generatedAt: new Date().toISOString(),
      mode: 'local',
      summary: 'Fixture plan',
      assumptions: [],
      questions: [],
      issues: [],
      sources: [],
      places: [],
      stays: [],
      flights: [],
      destinations: [],
      budget: {
        currency: 'USD',
        target: result.trip.budget,
        activities: 0,
        accommodation: 0,
        flights: null,
        total: 0,
        unpriced: [],
      },
      agentIds: ['intake', 'itinerary', 'review'],
    },
  };
}
const makeApp = (
  workflow: (input: WorkflowInput) => Promise<WorkflowResult> = async (input) =>
    fixtureResult(input),
  path = ':memory:',
) => {
  const app = createApp(path, { workflow });
  apps.push(app);
  return app;
};
function deferredWorkflow() {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let signal: AbortSignal | undefined;
  return {
    ready,
    release: () => release(),
    get signal() {
      return signal;
    },
    workflow: async (input: WorkflowInput) => {
      if (!input.message.includes('Wait')) return fixtureResult(input);
      signal = input.signal;
      input.onEvent?.({
        id: randomUUID(),
        agent: 'intake',
        status: 'running',
        label: 'Understanding your trip',
        detail: 'Reading the request',
        at: new Date().toISOString(),
      });
      started();
      await gate;
      return fixtureResult(input);
    },
  };
}
async function finished(client: ReturnType<typeof request.agent>, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const run = (await client.get(`/api/planning/runs/${id}`).expect(200)).body.run as PlanningRun;
    if (!['queued', 'running'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Planning run did not finish');
}
after(async () => {
  for (const app of apps) {
    try {
      await app.locals.planningRuns.shutdown();
      app.locals.db.close();
    } catch {
      /* Restart test closes its first connection. */
    }
  }
  for (const path of paths) rmSync(path, { recursive: true, force: true });
});

test('async planning persists progress and commits one revision; request IDs deduplicate running and completed requests', async () => {
  const pending = deferredWorkflow();
  let calls = 0;
  const app = makeApp(async (input) => {
    calls++;
    return pending.workflow(input);
  });
  const client = request.agent(app);
  const body = { message: 'Wait then plan 3 days in Kyoto', requestId: randomUUID() };
  const created = (await client.post('/api/planning/runs').send(body).expect(202)).body
    .run as PlanningRun;
  await pending.ready;
  const running = (await client.get(`/api/planning/runs/${created.id}`).expect(200)).body
    .run as PlanningRun;
  assert.equal(running.status, 'running');
  assert.equal(running.events[0].agent, 'intake');
  assert.equal(
    (await client.post('/api/planning/runs').send(body).expect(202)).body.run.id,
    created.id,
  );
  const draft = (await client.get(`/api/trips/${created.tripId}`).expect(200)).body.trip;
  assert.equal(draft.revision, 0);
  assert.deepEqual(draft.messages, []);
  pending.release();
  const complete = await finished(client, created.id);
  assert.equal(complete.status, 'completed');
  assert.equal(complete.result?.trip.revision, 1);
  assert.equal(complete.result?.trip.messages.length, 2);
  assert.equal(
    (await client.post('/api/planning/runs').send(body).expect(202)).body.run.id,
    created.id,
  );
  assert.equal(calls, 1);
  assert.equal((await client.get('/api/trips')).body.trips.length, 1);
  assert.equal((await client.get(`/api/trips/${created.tripId}/runs`)).body.runs.length, 1);
});

test('cancelling aborts actual workflow and late supplier results cannot update the saved trip', async () => {
  const pending = deferredWorkflow();
  const client = request.agent(makeApp(pending.workflow));
  const run = (
    await client
      .post('/api/planning/runs')
      .send({ message: 'Wait for 4 days in Kyoto', requestId: randomUUID() })
      .expect(202)
  ).body.run as PlanningRun;
  await pending.ready;
  const cancelled = await client.post(`/api/planning/runs/${run.id}/cancel`).expect(200);
  assert.equal(cancelled.body.run.status, 'cancelled');
  assert.equal(pending.signal?.aborted, true);
  pending.release();
  assert.equal((await finished(client, run.id)).status, 'cancelled');
  const trip = (await client.get(`/api/trips/${run.tripId}`)).body.trip;
  assert.equal(trip.revision, 0);
  assert.deepEqual(trip.itinerary, []);
  assert.deepEqual(trip.messages, []);
  assert.equal(
    (await client.post(`/api/planning/runs/${run.id}/cancel`)).body.run.status,
    'cancelled',
  );
});

test('a concurrent manual edit wins over an older planning run', async () => {
  const pending = deferredWorkflow();
  const client = request.agent(makeApp(pending.workflow));
  const original = (await client.post('/api/chat').send({ message: '3 days in Kyoto' })).body
    .trip as Trip;
  const run = (
    await client
      .post('/api/planning/runs')
      .send({ message: 'Wait and make it 5 days', tripId: original.id, requestId: randomUUID() })
      .expect(202)
  ).body.run;
  await pending.ready;
  const changed = (
    await client
      .patch(`/api/trips/${original.id}`)
      .send({ title: 'My own title', revision: original.revision })
      .expect(200)
  ).body.trip;
  await client
    .patch(`/api/trips/${original.id}`)
    .send({ title: 'Stale edit', revision: original.revision })
    .expect(409);
  pending.release();
  const result = await finished(client, run.id);
  assert.equal(result.status, 'failed');
  assert.match(result.error!, /trip changed/);
  const saved = (await client.get(`/api/trips/${original.id}`)).body.trip;
  assert.equal(saved.title, 'My own title');
  assert.equal(saved.days, 3);
  assert.equal(saved.revision, changed.revision);
  assert.equal(saved.messages.length, 2);
});

test('run access, cancellation, revision access, and restore are isolated by owner', async () => {
  const app = makeApp();
  const owner = request.agent(app),
    stranger = request.agent(app);
  const run = (
    await owner
      .post('/api/planning/runs')
      .send({ message: '3 days in Kyoto', requestId: randomUUID() })
  ).body.run;
  await finished(owner, run.id);
  await stranger.get(`/api/planning/runs/${run.id}`).expect(404);
  await stranger.post(`/api/planning/runs/${run.id}/cancel`).expect(404);
  await stranger.get(`/api/trips/${run.tripId}/runs`).expect(404);
  await stranger.get(`/api/trips/${run.tripId}/revisions`).expect(404);
  const history = (await owner.get(`/api/trips/${run.tripId}/revisions`)).body.revisions;
  await stranger
    .post(`/api/trips/${run.tripId}/revisions/${history[0].id}/restore`)
    .send({ revision: 1 })
    .expect(404);
});

test('restoring creates a new revision without restoring chat or revoked sharing credentials', async () => {
  const client = request.agent(makeApp());
  const initial = (await client.post('/api/chat').send({ message: '2 days in Kyoto' })).body
    .trip as Trip;
  const firstRevision = (await client.get(`/api/trips/${initial.id}/revisions`)).body.revisions[0];
  const shared = (await client.post(`/api/trips/${initial.id}/share`)).body.shareToken;
  const next = (
    await client.post('/api/chat').send({ message: 'Make it 4 days', tripId: initial.id })
  ).body.trip as Trip;
  await client.delete(`/api/trips/${initial.id}/share`).expect(204);
  await client
    .post(`/api/trips/${initial.id}/revisions/${firstRevision.id}/restore`)
    .send({ revision: initial.revision })
    .expect(409);
  const restored = (
    await client
      .post(`/api/trips/${initial.id}/revisions/${firstRevision.id}/restore`)
      .send({ revision: next.revision })
      .expect(200)
  ).body.trip as Trip;
  assert.equal(restored.days, 2);
  assert.equal(restored.messages.length, 4);
  assert.equal(restored.shareToken, null);
  assert.equal(restored.revision, 3);
  await client.get(`/api/shared/${shared}`).expect(404);
  assert.match(
    (await client.get(`/api/trips/${initial.id}/revisions`)).body.revisions[0].reason,
    /Restored version 1/,
  );
});

test('manual content edits become protected and survive regeneration; completed checkboxes do not lock stops', async () => {
  const client = request.agent(makeApp());
  const initial = (await client.post('/api/chat').send({ message: '3 days in Kyoto' })).body
    .trip as Trip;
  initial.itinerary[2].items[0].title = 'My non-negotiable breakfast';
  initial.itinerary[0].items[0].completed = true;
  const edited = (
    await client
      .patch(`/api/trips/${initial.id}`)
      .send({ itinerary: initial.itinerary, revision: initial.revision })
      .expect(200)
  ).body.trip as Trip;
  assert.equal(edited.itinerary[2].items[0].locked, true);
  assert.notEqual(edited.itinerary[0].items[0].locked, true);
  const regenerated = (
    await client
      .patch(`/api/trips/${initial.id}`)
      .send({ days: 5, revision: edited.revision })
      .expect(200)
  ).body.trip as Trip;
  assert.ok(
    regenerated.itinerary[2].items.some(
      (item) => item.title === 'My non-negotiable breakfast' && item.locked,
    ),
  );
  await client
    .patch(`/api/trips/${initial.id}`)
    .send({ days: 2, revision: regenerated.revision })
    .expect(409);
  regenerated.itinerary[2].items.find((item) => item.locked)!.locked = false;
  const unlocked = (
    await client
      .patch(`/api/trips/${initial.id}`)
      .send({ itinerary: regenerated.itinerary, revision: regenerated.revision })
      .expect(200)
  ).body.trip;
  await client
    .patch(`/api/trips/${initial.id}`)
    .send({ days: 2, revision: unlocked.revision })
    .expect(200);
});

test('logout cancels in-flight work, revokes its session, and prevents a delayed result from committing', async () => {
  const pending = deferredWorkflow();
  const app = makeApp(pending.workflow),
    client = request.agent(app);
  const run = (
    await client
      .post('/api/planning/runs')
      .send({ message: 'Wait for Kyoto', requestId: randomUUID() })
  ).body.run;
  await pending.ready;
  await client.post('/api/auth/logout').expect(200);
  assert.equal(pending.signal?.aborted, true);
  pending.release();
  await client.get(`/api/planning/runs/${run.id}`).expect(404);
  const stored = JSON.parse(
    String(app.locals.db.prepare('SELECT data FROM planning_runs WHERE id = ?').get(run.id).data),
  );
  assert.equal(stored.status, 'failed');
  assert.match(stored.error, /session changed/);
  const trip = JSON.parse(
    String(app.locals.db.prepare('SELECT data FROM trips WHERE id = ?').get(run.tripId).data),
  );
  assert.equal(trip.messages.length, 0);
});

test('application restart makes interrupted runs retryable and preserves previously saved versions', async () => {
  const path = mkdtempSync(join(tmpdir(), 'asktara-runs-'));
  paths.push(path);
  const database = join(path, 'test.sqlite');
  const app = makeApp(undefined, database);
  const response = await request(app).post('/api/chat').send({ message: '3 days in Kyoto' });
  const trip = response.body.trip as Trip;
  const row = app.locals.db.prepare('SELECT owner_id, session_id FROM planning_runs LIMIT 1').get();
  const run: PlanningRun = {
    id: randomUUID(),
    tripId: trip.id,
    requestId: randomUUID(),
    status: 'running',
    events: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  app.locals.db
    .prepare(
      'INSERT INTO planning_runs (id, owner_id, session_id, request_id, trip_id, data) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(run.id, row.owner_id, row.session_id, run.requestId, trip.id, JSON.stringify(run));
  await app.locals.planningRuns.shutdown();
  app.locals.db.close();
  const restarted = makeApp(undefined, database);
  const cookie = response.headers['set-cookie'][0].split(';')[0];
  const recovered = (
    await request(restarted).get(`/api/planning/runs/${run.id}`).set('Cookie', cookie).expect(200)
  ).body.run;
  assert.equal(recovered.status, 'failed');
  assert.match(recovered.error, /restart/);
  const saved = (await request(restarted).get(`/api/trips/${trip.id}`).set('Cookie', cookie)).body
    .trip;
  assert.equal(saved.revision, trip.revision);
  assert.equal(saved.messages.length, 2);
});

test('deleting a trip cancels its workflow and deletes run results and revision history', async () => {
  const pending = deferredWorkflow();
  const app = makeApp(pending.workflow),
    client = request.agent(app);
  const trip = (await client.post('/api/chat').send({ message: '3 days in Kyoto' })).body.trip;
  const run = (
    await client
      .post('/api/planning/runs')
      .send({ message: 'Wait for Kyoto', tripId: trip.id, requestId: randomUUID() })
  ).body.run;
  await pending.ready;
  await client.delete(`/api/trips/${trip.id}`).expect(204);
  pending.release();
  await client.get(`/api/planning/runs/${run.id}`).expect(404);
  assert.equal(
    app.locals.db
      .prepare('SELECT COUNT(*) AS count FROM trip_revisions WHERE trip_id = ?')
      .get(trip.id).count,
    0,
  );
  assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS count FROM trips').get().count, 0);
});

test('calendar end times respect edited durations and cross midnight correctly', async () => {
  const client = request.agent(makeApp());
  const trip = (await client.post('/api/chat').send({ message: '1 day in Kyoto' })).body
    .trip as Trip;
  trip.itinerary[0].items[0].time = '23:30';
  trip.itinerary[0].items[0].durationMinutes = 90;
  await client
    .patch(`/api/trips/${trip.id}`)
    .send({ itinerary: trip.itinerary, startDate: '2027-04-30' })
    .expect(200);
  const calendar = await client.get(`/api/trips/${trip.id}/calendar.ics`).expect(200);
  assert.match(calendar.text, /DTSTART:20270430T233000/);
  assert.match(calendar.text, /DTEND:20270501T010000/);
});

test('shared itineraries clone directly into private editable trips without leaking briefing or conversation', async () => {
  let calls = 0;
  const app = makeApp(async (input) => {
    calls++;
    const result = fixtureResult(input);
    result.trip.brief = {
      pace: 'balanced',
      originAirport: 'LHR',
      arrivalAirport: 'KIX',
      guestNationality: 'GB',
      includeFlights: false,
      includeHotels: false,
      destinationStops: [{ destinationId: 'kyoto', days: result.trip.days }],
      notes: ['Private preference'],
    };
    return result;
  });
  const owner = request.agent(app),
    visitor = request.agent(app);
  const original = (await owner.post('/api/chat').send({ message: '2 days in Kyoto' })).body
    .trip as Trip;
  const token = (await owner.post(`/api/trips/${original.id}/share`)).body.shareToken;
  const publicTrip = (await visitor.get(`/api/shared/${token}`)).body.trip;
  assert.equal(publicTrip.brief, undefined);
  assert.equal(publicTrip.planning, undefined);
  const copy = (await visitor.post(`/api/shared/${token}/clone`).send({}).expect(201)).body
    .trip as Trip;
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.revision, 1);
  assert.equal(copy.itinerary.length, original.itinerary.length);
  assert.equal(copy.shareToken, null);
  assert.deepEqual(copy.messages, []);
  assert.equal(copy.brief, undefined);
  assert.equal(copy.planning, undefined);
  assert.equal(calls, 1, 'Cloning performs no model or supplier call');
  await owner.get(`/api/trips/${copy.id}`).expect(404);
  await visitor
    .patch(`/api/trips/${copy.id}`)
    .send({ title: 'My version', revision: 1 })
    .expect(200);
  await owner.delete(`/api/trips/${original.id}/share`).expect(204);
  await visitor.post(`/api/shared/${token}/clone`).send({}).expect(404);
});

test('Google display content is transient across trip/run/revision storage and refreshed only for owned itinerary places', async () => {
  const app = makeApp(async (input) => {
    const result = fixtureResult(input);
    const place = {
      id: 'google-fixture_place',
      name: 'TRANSIENT_PROVIDER_NAME',
      destinationId: 'kyoto',
      address: 'TRANSIENT_PROVIDER_ADDRESS',
      coordinates: [35.1, 135.7] as [number, number],
      category: 'sight' as const,
      durationMinutes: 90,
      estimatedCost: 10,
      sourceId: 'google-places-kyoto',
      openingHours: ['Monday: TRANSIENT_PROVIDER_HOURS'],
    };
    result.report.places = [place];
    result.trip.itinerary[0].items[0] = {
      ...result.trip.itinerary[0].items[0],
      title: place.name,
      description: 'Provider detail',
      location: place.address,
      placeId: place.id,
      sourceId: place.sourceId,
    };
    return result;
  });
  const owner = request.agent(app),
    stranger = request.agent(app);
  const run = (
    await owner
      .post('/api/planning/runs')
      .send({ message: '2 days in Kyoto', requestId: randomUUID() })
  ).body.run;
  const completed = await finished(owner, run.id);
  assert.equal(completed.status, 'completed');
  for (const table of ['trips', 'planning_runs', 'trip_revisions']) {
    const rows = app.locals.db.prepare(`SELECT data FROM ${table}`).all();
    assert.ok(rows.length);
    for (const row of rows) assert.doesNotMatch(String(row.data), /TRANSIENT_PROVIDER_/);
  }
  const trip = completed.result!.trip;
  assert.equal(trip.itinerary[0].items[0].placeId, 'google-fixture_place');
  await stranger.get(`/api/trips/${trip.id}/places/google-fixture_place`).expect(404);
  await owner.get(`/api/trips/${trip.id}/places/google-unrelated_place`).expect(404);
  const originalFetch = globalThis.fetch,
    priorKey = process.env.GOOGLE_PLACES_API_KEY;
  try {
    process.env.GOOGLE_PLACES_API_KEY = 'fixture-key';
    globalThis.fetch = async (url) => {
      assert.equal(
        String(url),
        'https://places.googleapis.com/v1/places/fixture_place?languageCode=en',
      );
      return Response.json({
        id: 'fixture_place',
        displayName: { text: 'Fresh provider name' },
        formattedAddress: 'Fresh address',
        regularOpeningHours: { weekdayDescriptions: ['Monday: Open'] },
      });
    };
    const refreshed = await owner
      .get(`/api/trips/${trip.id}/places/google-fixture_place`)
      .expect(200);
    assert.equal(refreshed.body.place.name, 'Fresh provider name');
    assert.equal(refreshed.headers['cache-control'], 'no-store');
    const stored = String(
      app.locals.db.prepare('SELECT data FROM trips WHERE id = ?').get(trip.id).data,
    );
    assert.doesNotMatch(stored, /Fresh provider name/);
    trip.itinerary[0].items[0].title = 'My own custom stop';
    const edited = (
      await owner
        .patch(`/api/trips/${trip.id}`)
        .send({ itinerary: trip.itinerary, revision: trip.revision })
        .expect(200)
    ).body.trip;
    assert.equal(edited.itinerary[0].items[0].title, 'My own custom stop');
    assert.equal(edited.itinerary[0].items[0].placeId, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (priorKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = priorKey;
  }
});

test('manual cost changes refresh the group budget and warnings; date changes invalidate old research offers', async () => {
  const client = request.agent(makeApp());
  const original = (
    await client.post('/api/chat').send({ message: '2 days in Kyoto for 3 people' })
  ).body.trip as Trip;
  original.itinerary[0].items[0].cost = 2500;
  const expectedActivities =
    original.itinerary.reduce(
      (total, day) => total + day.items.reduce((sum, item) => sum + item.cost, 0),
      0,
    ) * original.travelers;
  const consultation = defaultConsultation();
  consultation.currency = 'USD';
  consultation.facts.budget = {
    source: 'form',
    valueState: 'specified',
    evidence: 'Budget settings: USD 1500 total',
  };
  const changed = (
    await client
      .patch(`/api/trips/${original.id}`)
      .send({
        itinerary: original.itinerary,
        revision: original.revision,
        budget: 1500,
        brief: { ...(original.brief || defaultBrief()), consultation },
      })
      .expect(200)
  ).body.trip as Trip;
  assert.equal(changed.planning?.budget.activities, expectedActivities);
  assert.equal(changed.planning?.budget.total, expectedActivities);
  assert.ok(changed.planning?.issues.some((issue) => issue.code === 'over_budget'));
  const dated = (
    await client
      .patch(`/api/trips/${original.id}`)
      .send({ startDate: '2027-05-01', revision: changed.revision })
      .expect(200)
  ).body.trip as Trip;
  assert.deepEqual(dated.planning?.flights, []);
  assert.deepEqual(dated.planning?.stays, []);
  assert.equal(dated.planning?.budget.flights, null);
  assert.equal(dated.planning?.budget.accommodation, 0);
  assert.ok(dated.planning?.issues.some((issue) => issue.code === 'research_refresh'));
  assert.deepEqual(dated.planning?.sources, changed.planning?.sources);
  assert.equal(dated.itinerary[0].items[0].cost, 2500);
});

test('trip, revision, and completed run commit atomically when persistence fails', async () => {
  const app = makeApp(),
    client = request.agent(app);
  app.locals.db.exec(
    "CREATE TRIGGER simulate_failed_commit BEFORE UPDATE ON planning_runs WHEN json_extract(NEW.data, '$.status') = 'completed' BEGIN SELECT RAISE(ABORT, 'Simulated terminal storage failure'); END;",
  );
  const run = (
    await client
      .post('/api/planning/runs')
      .send({ message: '2 days in Kyoto', requestId: randomUUID() })
      .expect(202)
  ).body.run;
  const failed = await finished(client, run.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.result, undefined);
  const trip = (await client.get(`/api/trips/${run.tripId}`).expect(200)).body.trip;
  assert.equal(trip.revision, 0);
  assert.deepEqual(trip.itinerary, []);
  assert.deepEqual(trip.messages, []);
  assert.equal(
    app.locals.db.prepare('SELECT COUNT(*) AS count FROM trip_revisions').get().count,
    0,
  );
});

test('brief validation rejects unsupported destinations, duplicate stops and excessive route duration', async () => {
  const client = request.agent(makeApp());
  for (const destinationStops of [
    [{ destinationId: 'not-supported', days: 2 }],
    [
      { destinationId: 'kyoto', days: 2 },
      { destinationId: 'kyoto', days: 2 },
    ],
    [
      { destinationId: 'kyoto', days: 21 },
      { destinationId: 'lisbon', days: 21 },
    ],
  ])
    await client
      .post('/api/planning/runs')
      .send({ message: 'Plan my trip', requestId: randomUUID(), brief: { destinationStops } })
      .expect(400);
});

test('guest plans and history merge into an account even when their owner-scoped request IDs collide', async () => {
  const app = makeApp(),
    owner = request.agent(app),
    guest = request.agent(app);
  const credentials = { email: 'merged@example.com', password: 'safe-password-123' };
  await owner
    .post('/api/auth/register')
    .send({ ...credentials, name: 'Traveler' })
    .expect(201);
  const requestId = randomUUID();
  const accountRun = (
    await owner.post('/api/planning/runs').send({ message: '2 days in Kyoto', requestId })
  ).body.run;
  const guestRun = (
    await guest.post('/api/planning/runs').send({ message: '3 days in Lisbon', requestId })
  ).body.run;
  await finished(owner, accountRun.id);
  await finished(guest, guestRun.id);
  await guest.post('/api/auth/login').send(credentials).expect(200);
  assert.equal((await guest.get('/api/trips').expect(200)).body.trips.length, 2);
  await owner.get(`/api/planning/runs/${guestRun.id}`).expect(200);
  const revisions = (await owner.get(`/api/trips/${guestRun.tripId}/revisions`).expect(200)).body
    .revisions;
  assert.equal(revisions.length, 2);
});
