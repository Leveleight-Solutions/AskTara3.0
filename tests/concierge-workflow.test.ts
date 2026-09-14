import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { newTrip, detectDestinationIntent } from '../server/planner.ts';
import { runPlanningWorkflow, defaultBrief } from '../server/agents/index.ts';
import type { Trip } from '../shared/types.ts';

const oldFetch = globalThis.fetch;
const keys = [
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'GOOGLE_PLACES_API_KEY',
  'LITEAPI_API_KEY',
  'DUFFEL_ACCESS_TOKEN',
];
const oldEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const apps: ReturnType<typeof createApp>[] = [];
beforeEach(() => {
  keys.forEach((key) => delete process.env[key]);
  process.env.OPENAI_API_KEY = 'mock-concierge';
});
after(() => {
  globalThis.fetch = oldFetch;
  for (const [key, value] of Object.entries(oldEnv))
    value === undefined ? delete process.env[key] : (process.env[key] = value);
  for (const app of apps) app.locals.db.close();
});
const prompt =
  'Plan 4 days in London starting November 18, 2026, for 2 adults. We prefer vegetarian food, step-free access, and quiet places.';

test('duration changes are not misread as a new destination by the model repair guard', () => {
  for (const message of [
    'Extend the holiday to 7 days.',
    'Shorten the trip to 3 days.',
    'Update this to 5 days.',
  ])
    assert.equal(detectDestinationIntent(message).kind, 'unspecified');
});
function intakeOnly(change: Record<string, unknown> = {}, inspect?: (payload: any) => void) {
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    assert.equal(
      body.text.format.name,
      'travel_intake',
      'Research and suppliers must wait for core answers',
    );
    calls.push(body.text.format.name);
    const payload = JSON.parse(body.input[0].content);
    inspect?.(payload);
    return Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                ...payload.current,
                intent: 'plan',
                reply: 'I can help with London.',
                destinationRequests: [{ name: 'London', days: 4 }],
                startDate: '2026-11-18',
                days: 4,
                travelers: 2,
                consultationUpdates: {
                  facts: [],
                  services: [],
                  currency: null,
                  party: null,
                  flightJourney: null,
                },
                ...change,
              }),
            },
          ],
        },
      ],
    });
  };
  return calls;
}
function remember(trip: Trip, message: string, reply: string) {
  trip.messages.push(
    { id: randomUUID(), role: 'user', content: message, createdAt: new Date().toISOString() },
    { id: randomUUID(), role: 'assistant', content: reply, createdAt: new Date().toISOString() },
  );
  return trip;
}

test('the exact London prompt asks about flights and accommodation before research, with no invented budget', async () => {
  const calls = intakeOnly();
  const result = await runPlanningWorkflow({ trip: newTrip(), message: prompt });
  assert.deepEqual(calls, ['travel_intake']);
  assert.equal(result.trip.destinationId, 'london');
  assert.equal(result.trip.startDate, '2026-11-18');
  assert.deepEqual(result.trip.itinerary, []);
  assert.equal(result.trip.brief?.consultation?.services.flights.status, 'unknown');
  assert.equal(result.trip.brief?.consultation?.services.hotels.status, 'unknown');
  assert.equal(result.trip.brief?.consultation?.facts.budget, undefined);
  assert.deepEqual(
    result.report.questions.map((question) => question.field),
    ['flights', 'hotels'],
  );
  assert.ok(result.reply.length < 450);
  assert.doesNotMatch(result.reply, /no flights needed|1,500|Bali|Marrakech/i);
});

test('a contextual yes to both services persists and advances to budget and departure questions', async () => {
  intakeOnly();
  const first = await runPlanningWorkflow({ trip: newTrip(), message: prompt });
  const trip = remember(first.trip, prompt, first.reply);
  const answer = 'Yes, both please.';
  intakeOnly({
    consultationUpdates: {
      facts: [],
      services: [
        { service: 'flights', status: 'requested', evidence: answer },
        { service: 'hotels', status: 'requested', evidence: answer },
      ],
      currency: null,
      party: null,
      flightJourney: null,
    },
  });
  const second = await runPlanningWorkflow({ trip, message: answer });
  assert.equal(second.trip.brief?.consultation?.services.flights.status, 'requested');
  assert.equal(second.trip.brief?.consultation?.services.hotels.status, 'requested');
  assert.equal(second.trip.brief?.consultation?.currency, 'AUD');
  assert.deepEqual(
    second.report.questions.map((entry) => entry.field),
    ['budget', 'origin'],
  );
  assert.deepEqual(second.trip.itinerary, []);
  assert.equal(second.trip.startDate, '2026-11-18');
  assert.equal(second.trip.travelers, 2);
});

test('unasked services cannot be declined by unsupported model evidence', async () => {
  intakeOnly({
    includeFlights: false,
    consultationUpdates: {
      facts: [],
      services: [{ service: 'flights', status: 'not_needed', evidence: 'No flights needed' }],
      currency: null,
      party: null,
      flightJourney: null,
    },
  });
  const result = await runPlanningWorkflow({ trip: newTrip(), message: prompt });
  assert.equal(result.trip.brief?.consultation?.services.flights.status, 'unknown');
  assert.ok(result.report.questions.some((entry) => entry.field === 'flights'));
});

test('global pending route survives consultation without substituting a featured city', async () => {
  intakeOnly({ destinationRequests: [{ name: 'Muscat, Oman', days: 4 }] });
  const first = await runPlanningWorkflow({
    trip: newTrip(),
    message: 'Plan 4 days in Muscat, Oman for 2 adults.',
  });
  const trip = remember(first.trip, 'Plan 4 days in Muscat, Oman for 2 adults.', first.reply);
  intakeOnly({ destinationRequests: [{ name: 'Muscat, Oman', days: 4 }] }, (payload) =>
    assert.equal(payload.current.destinationRequests[0].name, 'Muscat, Oman'),
  );
  const next = await runPlanningWorkflow({ trip, message: 'Our dates are flexible.' });
  assert.equal(next.trip.brief?.consultation?.route?.[0].name, 'Muscat, Oman');
  assert.deepEqual(next.trip.itinerary, []);
  assert.equal(next.trip.startDate, '');
});

test('editing a draft records only the explicit form answers and never creates a premature itinerary', async () => {
  intakeOnly();
  const app = createApp(':memory:');
  apps.push(app);
  const owner = request.agent(app);
  const created = await owner.post('/api/chat').send({ message: prompt }).expect(200);
  const initial = created.body.trip as Trip;
  const changed = await owner
    .patch(`/api/trips/${initial.id}`)
    .send({ revision: initial.revision, budget: 4200 })
    .expect(200);
  const trip = changed.body.trip as Trip;
  assert.equal(trip.brief?.consultation?.facts.budget?.source, 'form');
  assert.equal(trip.budget, 4200);
  assert.equal(trip.brief?.consultation?.services.flights.status, 'unknown');
  assert.deepEqual(trip.itinerary, []);
});

test('family trip hotel search rejects adult-only substitution before any supplier request', async () => {
  intakeOnly();
  const app = createApp(':memory:');
  apps.push(app);
  const owner = request.agent(app);
  const created = await owner
    .post('/api/chat')
    .send({ message: 'Plan 4 days in London for 2 adults and 1 child aged 7.' })
    .expect(200);
  const trip = created.body.trip as Trip;
  const result = await owner
    .post('/api/hotels/search')
    .send({
      tripId: trip.id,
      destinationId: 'london',
      checkin: '2027-11-18',
      checkout: '2027-11-22',
      adults: 3,
      guestNationality: 'AU',
    })
    .expect(400);
  assert.match(result.body.error, /not price them as adults/);
});

test('offline consultation also leaves an incomplete itinerary unbuilt', async () => {
  delete process.env.OPENAI_API_KEY;
  const result = await runPlanningWorkflow({
    trip: newTrip(),
    message: prompt,
    brief: defaultBrief(),
  });
  assert.deepEqual(result.trip.itinerary, []);
  assert.deepEqual(
    result.report.questions.map((entry) => entry.field),
    ['flights', 'hotels'],
  );
});

test('invalid model research is retried only once and never replaces a trip with unvalidated content', async () => {
  intakeOnly({ budget: 3000 });
  const intakeFetch = globalThis.fetch;
  const feedback: (string | undefined)[] = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.text.format.name === 'travel_intake') return intakeFetch(url, init);
    assert.equal(body.text.format.name, 'destination_research');
    feedback.push(JSON.parse(body.input[0].content).validationFeedback);
    return Response.json({
      status: 'completed',
      output: [
        {
          type: 'web_search_call',
          status: 'completed',
          action: { sources: [{ url: 'https://www.visitlondon.com/', title: 'London tourism' }] },
        },
        { type: 'message', content: [{ type: 'output_text', text: '{}' }] },
      ],
    });
  };
  const trip = newTrip();
  await assert.rejects(
    runPlanningWorkflow({
      trip,
      message: `${prompt} Itinerary only. Total group budget AUD 3000.`,
    }),
    /failed validation/,
  );
  assert.deepEqual(feedback, [undefined, 'model_schema']);
  assert.deepEqual(trip.itinerary, []);
});
