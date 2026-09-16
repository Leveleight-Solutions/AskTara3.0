import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { newTrip } from '../server/planner.ts';
import { runPlanningWorkflow } from '../server/agents/index.ts';
import { findDestination } from '../shared/destinations.ts';
import type { Trip } from '../shared/types.ts';

const originalFetch = globalThis.fetch;
const variables = [
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_REASONING_EFFORT',
  'GOOGLE_PLACES_API_KEY',
  'LITEAPI_API_KEY',
  'LITEAPI_MODE',
  'DUFFEL_ACCESS_TOKEN',
];
const environment = Object.fromEntries(variables.map((name) => [name, process.env[name]]));
const apps: ReturnType<typeof createApp>[] = [];
const makeApp = () => {
  const app = createApp(':memory:');
  apps.push(app);
  return app;
};
beforeEach(() => {
  for (const name of variables) delete process.env[name];
  process.env.OPENAI_API_KEY = 'unit-global-planner-key';
  globalThis.fetch = async () => {
    throw new Error('Unexpected external request');
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  for (const app of apps) app.locals.db.close();
  for (const [name, value] of Object.entries(environment))
    value === undefined ? delete process.env[name] : (process.env[name] = value);
});

const tourismUrl = 'https://visitreykjavik.is/';
const museumUrl = 'https://reykjavikcitymuseum.is/';
// Research/scheduling regressions start from a complete customer brief. Sparse
// discovery prompts below intentionally remain incomplete to exercise that path.
const confirmedReykjavikRequest =
  'Plan 3 days in Reykjavik, Iceland, starting 2027-11-18, for 2 adults. Total budget USD 2500. I enjoy food and culture, with vegetarian food and step-free places. No flights needed. Find hotels for me.';
const response = (data: unknown, web = false) =>
  Response.json({
    status: 'completed',
    output: [
      ...(web
        ? [
            {
              type: 'web_search_call',
              status: 'completed',
              action: {
                sources: [
                  { url: tourismUrl, title: 'Destination tourism source' },
                  { url: museumUrl, title: 'Museum source' },
                ],
              },
            },
          ]
        : []),
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
    ],
  });

function mockPlanner(
  options: {
    intent?: 'plan' | 'discover' | 'answer';
    failResearch?: boolean;
    failIntake?: boolean;
    days?: number;
    includeHotels?: boolean;
    closePlace?: string;
    verificationTrace?: { closedPlaceId?: string; compositionPlaceIds?: string[] };
  } = {},
) {
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    if (options.includeHotels && String(url) === 'https://api.liteapi.travel/v3.0/hotels/rates') {
      calls.push('hotel_rates');
      return Response.json({
        sandbox: true,
        hotels: [{ id: 'hotel-fixture', name: 'Supplier test hotel' }],
        data: [
          {
            hotelId: 'hotel-fixture',
            roomTypes: [
              {
                offerId: 'offer-fixture',
                rates: [
                  {
                    name: 'Supplier double room',
                    retailRate: { total: [{ amount: 456, currency: 'USD' }] },
                  },
                ],
              },
            ],
          },
        ],
      });
    }
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    const payload = JSON.parse(body.input[0].content);
    const stage = body.text.format.name;
    calls.push(stage);
    assert.equal(body.store, false);
    if (stage === 'travel_intake') {
      if (options.failIntake) return new Response(null, { status: 503 });
      const days = options.days || 3;
      return response({
        ...payload.current,
        startDate: payload.current.startDate || '2027-11-18',
        travelers: 2,
        budget: /(?:USD|AUD) 2500/.test(payload.request) ? 2500 : payload.current.budget,
        interests: ['Food', 'Culture'],
        days,
        destinationStops: [],
        destinationRequests:
          options.intent === 'discover' ? [] : [{ name: 'Reykjavik, Iceland', days }],
        intent: options.intent || 'plan',
        reply:
          options.intent === 'discover'
            ? 'Here is a destination to consider.'
            : 'I will plan your Reykjavik trip.',
        ...(options.includeHotels ? { includeHotels: true, guestNationality: 'PK' } : {}),
      });
    }
    if (stage === 'place_verification') {
      assert.ok(body.tools.some((tool: { type: string }) => tool.type === 'web_search'));
      return response(
        {
          places: payload.places.map((place: { id: string; name: string }) => {
            const closed = place.name === options.closePlace;
            if (closed && options.verificationTrace)
              options.verificationTrace.closedPlaceId = place.id;
            return {
              id: place.id,
              status: closed ? 'closed' : 'no_closure_found',
              reason: closed
                ? 'A sourced fixture reports permanent closure before the trip.'
                : 'No dated closure found; confirm opening hours directly.',
              sourceUrls: [closed ? museumUrl : tourismUrl],
              closureDate: closed ? '2026-01-01' : null,
              reopeningDate: null,
            };
          }),
        },
        true,
      );
    }
    if (stage === 'itinerary_composition') {
      if (options.verificationTrace)
        options.verificationTrace.compositionPlaceIds = payload.places.map(
          (place: { id: string }) => place.id,
        );
      const used = new Set<string>();
      return response({
        summary:
          'A researched Reykjavik itinerary with time for your preferences. Confirm venue access directly.',
        days: Array.from({ length: payload.trip.days }, (_, index) => {
          const place = payload.places.find((entry: { id: string }) => !used.has(entry.id));
          if (place) used.add(place.id);
          return {
            day: index + 1,
            title: `Reykjavik day ${index + 1}`,
            placeIds: place ? [place.id] : [],
            note: '',
          };
        }),
      });
    }
    assert.ok(body.tools.some((tool: { type: string }) => tool.type === 'web_search'));
    if (options.failResearch) return new Response(null, { status: 503 });
    if (options.intent === 'answer')
      return response(
        {
          reply: `The saved dates and requested budget remain unchanged. [Destination information](${tourismUrl})`,
          summary: `This answer explains the existing trip without changing it. [Destination information](${tourismUrl})`,
          questions: [],
          destinations: [],
          places: [],
        },
        true,
      );
    return response(
      {
        reply: 'Reykjavik offers compact cultural sights. Would you like to explore these options?',
        summary:
          'Reykjavik has researched city and museum options; access requirements need confirmation.',
        questions: [],
        destinations: [
          {
            requestIndex: 0,
            requestedName: 'Reykjavik, Iceland',
            name: 'Reykjavik',
            country: 'Iceland',
            region: 'Europe',
            description: 'A compact city destination with cultural sights.',
            bestTime: 'Confirm seasonal conditions for your dates.',
            dailyBudget: 120,
            coordinates: { latitude: 64.1466, longitude: -21.9426 },
            tags: ['Culture', 'City'],
            vibe: 'City escapes',
            sourceUrls: [tourismUrl],
          },
        ],
        places: ['City museum', 'City square', 'Harbour walk', 'Cultural centre'].map(
          (name, index) => ({
            destinationIndex: 0,
            name,
            address: 'Reykjavik, Iceland',
            category: index === 2 ? 'leisure' : 'sight',
            description: `Researched test suggestion ${index + 1}.`,
            suitability: ['Confirm step-free access directly.'],
            durationMinutes: 90,
            estimatedCost: 15,
            coordinates: { latitude: 64.1466 + index * 0.001, longitude: -21.9426 },
            sourceUrls: [index === 0 ? museumUrl : tourismUrl],
          }),
        ),
      },
      true,
    );
  };
  return calls;
}

test('a rejected research output gets one fresh validated attempt before itinerary composition', async () => {
  mockPlanner();
  const provider = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.text?.format?.name === 'destination_research') {
      attempts++;
      if (attempts === 1) return response({}, true);
      assert.equal(JSON.parse(body.input[0].content).validationFeedback, 'model_schema');
    }
    return provider(url, init);
  };
  const result = await runPlanningWorkflow({ trip: newTrip(), message: confirmedReykjavikRequest });
  assert.equal(attempts, 2);
  assert.equal(result.trip.itinerary.length, 3);
  assert.ok(result.report.agentIds.includes('verification'));
  assert.ok(
    result.trip.itinerary
      .flatMap((day) => day.items)
      .some((item) => item.placeId?.startsWith('web-')),
  );
});

test('a noncatalog named destination creates a sourced schedule and persists its trip-owned destination snapshot', async () => {
  const calls = mockPlanner();
  const app = makeApp();
  const owner = request.agent(app);
  const result = await owner
    .post('/api/chat')
    .send({
      message: confirmedReykjavikRequest,
    })
    .expect(200);
  const trip = result.body.trip as Trip;
  assert.equal(result.body.mode, 'live');
  assert.deepEqual(calls, [
    'travel_intake',
    'destination_research',
    'place_verification',
    'itinerary_composition',
  ]);
  assert.equal(trip.days, 3);
  assert.equal(trip.startDate, '2027-11-18');
  assert.equal(
    findDestination(trip.destinationId),
    undefined,
    'Global research must not mutate the shared catalog',
  );
  assert.equal(findDestination(trip.destinationId, trip)?.name, 'Reykjavik');
  assert.equal(trip.itinerary.length, 3);
  assert.ok(trip.itinerary.every((day) => day.destinationId === trip.destinationId));
  assert.ok(trip.itinerary.some((day) => day.items.some((item) => item.placeId)));
  assert.ok(
    trip.planning!.sources.every((source) => source.kind === 'web' && source.status === 'live'),
  );
  assert.ok(trip.planning!.places.every((place) => place.evidenceUrls?.length));
  assert.ok(trip.planning!.budget.unpriced.includes('Accommodation in Reykjavik'));
  const saved = await owner.get(`/api/trips/${trip.id}`).expect(200);
  assert.deepEqual(saved.body.trip.destinations, trip.destinations);
  assert.deepEqual(saved.body.trip.planning.places, trip.planning!.places);
  assert.equal(findDestination(trip.destinationId), undefined);
});

test('declining hotels keeps researched global activities without adding accommodation costs', async () => {
  const calls = mockPlanner();
  const result = await runPlanningWorkflow({
    trip: newTrip(),
    message: confirmedReykjavikRequest.replace('Find hotels for me.', 'No hotels needed.'),
  });
  assert.deepEqual(calls, [
    'travel_intake',
    'destination_research',
    'place_verification',
    'itinerary_composition',
  ]);
  assert.equal(result.trip.brief!.consultation!.services.hotels.status, 'not_needed');
  assert.ok(result.report.places.length > 0);
  assert.ok(result.trip.itinerary.some((day) => day.items.some((item) => item.placeId)));
  assert.equal(result.report.budget.accommodation, 0);
  assert.deepEqual(result.report.stays, []);
  assert.equal(
    result.report.budget.unpriced.some((item) => /accommodation/i.test(item)),
    false,
  );
  assert.equal(
    result.report.issues.some((issue) => issue.code === 'accommodation_unpriced'),
    false,
  );
});

test('informational currency and weather questions preserve confirmed consultation and the next edit keeps the saved dates', async () => {
  mockPlanner();
  const first = await runPlanningWorkflow({
    trip: newTrip(),
    message: confirmedReykjavikRequest.replace('USD 2500', 'AUD 2500'),
  });
  const original = structuredClone(first.trip);
  assert.equal(original.brief!.consultation!.currency, 'AUD');
  assert.equal(original.budget, 2500);
  let current = first.trip;
  for (const message of [
    'Are attraction costs listed in USD?',
    'Would the weather be warmer in November 2027?',
  ]) {
    const calls = mockPlanner({ intent: 'answer' });
    const answered = await runPlanningWorkflow({ trip: current, message });
    assert.deepEqual(calls, ['travel_intake', 'destination_research']);
    assert.deepEqual(answered.trip.itinerary, original.itinerary);
    assert.deepEqual(answered.trip.brief, original.brief);
    assert.equal(answered.trip.budget, original.budget);
    assert.equal(answered.trip.startDate, original.startDate);
    assert.equal(answered.trip.planning!.budget.targetCurrency, 'AUD');
    current = answered.trip;
  }
  mockPlanner();
  const edited = await runPlanningWorkflow({ trip: current, message: 'Make the days slower.' });
  assert.equal(edited.trip.startDate, original.startDate);
  assert.equal(edited.trip.brief!.consultation!.currency, 'AUD');
  assert.equal(edited.trip.brief!.consultation!.facts.dates!.valueState, 'specified');
});

test('global trip followups preserve destination identity, dates, saved preferences and a protected activity', async () => {
  mockPlanner();
  const first = await runPlanningWorkflow({
    trip: newTrip(),
    message: confirmedReykjavikRequest,
  });
  first.trip.itinerary[0].items[0].locked = true;
  first.trip.itinerary[0].items[0].title = 'Our private appointment';
  const locked = structuredClone(first.trip.itinerary[0].items[0]);
  const before = structuredClone(first.trip);
  const calls = mockPlanner({ days: 4 });
  const result = await runPlanningWorkflow({
    trip: first.trip,
    message: 'Make it 4 days and slower',
  });
  assert.equal(result.trip.destinationId, first.trip.destinationId);
  assert.equal(result.trip.startDate, first.trip.startDate);
  assert.equal(result.trip.itinerary.length, 4);
  assert.deepEqual(
    result.trip.itinerary[0].items.find((item) => item.id === locked.id),
    locked,
  );
  assert.deepEqual(result.trip.brief?.notes, first.trip.brief?.notes);
  assert.deepEqual(first.trip, before, 'Planning must not mutate its original snapshot');
  assert.deepEqual(calls, [
    'travel_intake',
    'destination_research',
    'place_verification',
    'itinerary_composition',
  ]);
  result.trip.itinerary[3].items[0].locked = true;
  const protectedVersion = structuredClone(result.trip);
  mockPlanner({ days: 2 });
  await assert.rejects(
    runPlanningWorkflow({ trip: result.trip, message: 'Make it 2 days' }),
    /protected stop/,
  );
  assert.deepEqual(result.trip, protectedVersion);
});

test('a sourced place closure is excluded before composition and cannot remain in the generated itinerary', async () => {
  const verificationTrace: { closedPlaceId?: string; compositionPlaceIds?: string[] } = {};
  const calls = mockPlanner({ closePlace: 'City museum', verificationTrace });
  const result = await runPlanningWorkflow({
    trip: newTrip(),
    message: confirmedReykjavikRequest,
  });
  assert.deepEqual(calls, [
    'travel_intake',
    'destination_research',
    'place_verification',
    'itinerary_composition',
  ]);
  assert.ok(
    verificationTrace.closedPlaceId,
    'The verifier must inspect the originally researched museum',
  );
  assert.ok(
    verificationTrace.compositionPlaceIds?.length,
    'The composer should receive the remaining researched places',
  );
  assert.equal(
    verificationTrace.compositionPlaceIds.includes(verificationTrace.closedPlaceId),
    false,
  );
  assert.equal(
    result.report.places.some((place) => place.id === verificationTrace.closedPlaceId),
    false,
  );
  assert.equal(
    result.trip.itinerary.some((day) =>
      day.items.some((item) => item.placeId === verificationTrace.closedPlaceId),
    ),
    false,
  );
  assert.equal(result.trip.itinerary.length, 3);
  assert.ok(result.trip.itinerary.every((day) => day.destinationId === result.trip.destinationId));
  assert.match(
    result.report.researchSummary || '',
    /Reykjavik has researched city and museum options/,
  );
  assert.match(result.report.researchSummary || '', /closed|closure/i);
});

test('intake and research failures leave a persisted global itinerary unchanged without a replacement plan', async () => {
  mockPlanner();
  const owner = request.agent(makeApp());
  const initial = await owner
    .post('/api/chat')
    .send({ message: confirmedReykjavikRequest })
    .expect(200);
  const trip = initial.body.trip as Trip;
  const saved = (await owner.get(`/api/trips/${trip.id}`).expect(200)).body.trip;
  for (const failure of [{ failResearch: true }, { failIntake: true }]) {
    const calls = mockPlanner(failure);
    const result = await owner
      .post('/api/chat')
      .send({ tripId: trip.id, message: 'Make it quieter' })
      .expect(503);
    assert.match(result.body.error, /saved trip is unchanged/i);
    assert.equal(result.body.trip, undefined);
    assert.ok(!calls.includes('itinerary_composition'));
    assert.deepEqual((await owner.get(`/api/trips/${trip.id}`).expect(200)).body.trip, saved);
  }
});

test('global discovery researches options without choosing a destination or generating itinerary days', async () => {
  const calls = mockPlanner({ intent: 'discover' });
  const result = await runPlanningWorkflow({
    trip: newTrip(),
    message: 'Suggest somewhere for a quiet cultural break',
  });
  assert.equal(result.trip.destinationId, '');
  assert.deepEqual(result.trip.itinerary, []);
  assert.ok(result.report.destinations.some((destination) => destination.name === 'Reykjavik'));
  assert.ok(result.trip.destinations?.some((destination) => destination.name === 'Reykjavik'));
  assert.ok(!calls.includes('itinerary_composition'));
});

test('discovering global alternatives on an existing trip keeps its schedule while returning the newly researched options', async () => {
  delete process.env.OPENAI_API_KEY;
  const existing = await runPlanningWorkflow({
    trip: newTrip(),
    message:
      '3 days in Kyoto starting 2027-04-12 for 2 adults. Total budget USD 2500. I enjoy food and culture. No flights needed. Find hotels for me.',
  });
  const saved = structuredClone(existing.trip);
  process.env.OPENAI_API_KEY = 'unit-global-planner-key';
  mockPlanner({ intent: 'discover' });
  const result = await runPlanningWorkflow({
    trip: existing.trip,
    message: 'Suggest somewhere else for a quiet cultural break',
  });
  assert.equal(result.trip.destinationId, 'kyoto');
  assert.deepEqual(result.trip.itinerary, saved.itinerary);
  assert.deepEqual(result.trip.brief, saved.brief);
  assert.equal(result.report.destinations[0].name, 'Reykjavik');
  assert.ok(result.report.places.some((place) => place.address.includes('Reykjavik')));
  assert.deepEqual(result.trip.planning?.budget, saved.planning?.budget);
  assert.deepEqual(existing.trip, saved);
});

test('global hotel searches require the owning trip and reject foreign IDs before any supplier request', async () => {
  mockPlanner();
  const app = makeApp();
  const owner = request.agent(app);
  const stranger = request.agent(app);
  const trip = (
    await owner.post('/api/chat').send({ message: confirmedReykjavikRequest }).expect(200)
  ).body.trip as Trip;
  process.env.LITEAPI_API_KEY = 'sand_global_fixture';
  let supplierCalls = 0;
  globalThis.fetch = async (url, init) => {
    supplierCalls++;
    assert.equal(String(url), 'https://api.liteapi.travel/v3.0/hotels/rates');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.latitude, findDestination(trip.destinationId, trip)!.coordinates[0]);
    return Response.json({ data: [] });
  };
  const query = {
    tripId: trip.id,
    destinationId: trip.destinationId,
    checkin: '2027-11-18',
    checkout: '2027-11-21',
    adults: 2,
    guestNationality: 'PK',
  };
  await stranger.post('/api/hotels/search').send(query).expect(404);
  await stranger
    .post('/api/hotels/search')
    .send({ ...query, tripId: undefined })
    .expect(400);
  await owner
    .post('/api/hotels/search')
    .send({ ...query, destination: trip.destinations![0] })
    .expect(400);
  await stranger
    .post('/api/chat')
    .send({
      message: 'Plan this route',
      brief: { destinationStops: [{ destinationId: trip.destinationId, days: 3 }] },
    })
    .expect(400);
  assert.equal(supplierCalls, 0);
  const result = await owner.post('/api/hotels/search').send(query).expect(200);
  assert.equal(supplierCalls, 1);
  assert.equal(result.body.mode, 'test');
});

test('editing global trip dates retains public research evidence but invalidates supplier prices and refreshes budget totals', async () => {
  process.env.LITEAPI_API_KEY = 'sand_global_fixture';
  mockPlanner({ includeHotels: true });
  const owner = request.agent(makeApp());
  const trip = (
    await owner
      .post('/api/chat')
      .send({ message: `${confirmedReykjavikRequest} Hotel guest nationality PK.` })
      .expect(200)
  ).body.trip as Trip;
  assert.equal(trip.planning!.stays.length, 1);
  assert.equal(trip.planning!.stays[0].price, 456);
  assert.equal(trip.planning!.sources.find((source) => source.kind === 'liteapi')?.status, 'test');
  assert.equal(
    trip.planning!.budget.accommodation,
    0,
    'Sandbox rates must stay out of live trip totals',
  );
  const changed = await owner
    .patch(`/api/trips/${trip.id}`)
    .send({ startDate: '2027-11-20', budget: 800 })
    .expect(200);
  const next = changed.body.trip as Trip;
  assert.equal(next.destinationId, trip.destinationId);
  assert.deepEqual(next.destinations, trip.destinations);
  assert.deepEqual(next.planning!.places, trip.planning!.places);
  assert.deepEqual(next.planning!.flights, []);
  assert.deepEqual(next.planning!.stays, []);
  assert.equal(next.planning!.budget.target, 800);
  assert.equal(next.planning!.budget.flights, null);
  assert.equal(next.planning!.budget.total, next.planning!.budget.activities);
  assert.ok(next.planning!.budget.unpriced.includes('Accommodation'));
  assert.ok(next.planning!.issues.some((issue) => issue.code === 'research_refresh'));
});

test('shared global trips expose only current route metadata and exclude unselected destinations, private briefing and research', async () => {
  mockPlanner();
  const app = makeApp();
  const owner = request.agent(app);
  const visitor = request.agent(app);
  const trip = (
    await owner
      .post('/api/chat')
      .send({
        message: `${confirmedReykjavikRequest} Hotel guest nationality PK.`,
      })
      .expect(200)
  ).body.trip as Trip;
  const selectedDestination = structuredClone(findDestination(trip.destinationId, trip)!);
  // Represent an earlier discovery result retained privately for future trip edits.
  const saved = (await owner.get(`/api/trips/${trip.id}`).expect(200)).body.trip as Trip;
  saved.destinations = [
    ...(saved.destinations || []),
    { ...selectedDestination, id: 'unselected-city', name: 'Unselected destination fixture' },
  ];
  app.locals.db
    .prepare('UPDATE trips SET data = ? WHERE id = ?')
    .run(JSON.stringify(saved), trip.id);
  assert.equal(
    (await owner.get(`/api/trips/${trip.id}`).expect(200)).body.trip.destinations.length,
    2,
  );
  await visitor.get(`/api/trips/${trip.id}`).expect(404);
  const shared = await owner.post(`/api/trips/${trip.id}/share`).send({}).expect(200);
  const publicTrip = (await visitor.get(`/api/shared/${shared.body.shareToken}`).expect(200)).body
    .trip as Trip;
  assert.equal(findDestination(publicTrip.destinationId, publicTrip)?.name, 'Reykjavik');
  assert.deepEqual(publicTrip.destinations, [selectedDestination]);
  assert.equal(findDestination('unselected-city', publicTrip), undefined);
  assert.equal(publicTrip.brief, undefined);
  assert.equal(publicTrip.planning, undefined);
  assert.deepEqual(publicTrip.messages, []);
  assert.equal(publicTrip.shareToken, null);
  const clone = (
    await visitor.post(`/api/shared/${shared.body.shareToken}/clone`).send({}).expect(201)
  ).body.trip as Trip;
  assert.notEqual(clone.id, trip.id);
  assert.equal(findDestination(clone.destinationId, clone)?.name, 'Reykjavik');
  assert.deepEqual(clone.destinations, [selectedDestination]);
  assert.equal(findDestination('unselected-city', clone), undefined);
  assert.equal(clone.brief, undefined);
  assert.equal(clone.planning, undefined);
  assert.deepEqual(clone.messages, []);
  assert.equal(
    (await owner.get(`/api/trips/${trip.id}`).expect(200)).body.trip.destinations.length,
    2,
    'Sharing must not remove private discovery history from the owner',
  );
  await owner.get(`/api/trips/${clone.id}`).expect(404);
});
