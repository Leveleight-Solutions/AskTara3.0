import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { newTrip } from '../server/planner.ts';
import {
  runPlanningWorkflow,
  buildLocalItinerary,
  preserveLockedStops,
  stripGooglePlaceContent,
  readGooglePlaceDetails,
  defaultBrief,
} from '../server/agents/index.ts';
import { curatedPlaces } from '../server/agents/places.ts';
import { modelIntake } from '../server/agents/models.ts';
import { destinations } from '../shared/catalog.ts';
import type { PlanningEvent, TravelBrief } from '../shared/planning.ts';
import { defaultConsultation } from '../shared/consultation.ts';

// A complete customer brief for tests whose subject is scheduling, not intake.
const confirmedKyotoRequest =
  '3 days in Kyoto starting 2027-04-12 for 2 adults. Total budget USD 2500. I enjoy food and culture. No flights needed. Find hotels for me.';

const keys = [
  'OPENAI_API_KEY',
  'DUFFEL_ACCESS_TOKEN',
  'LITEAPI_API_KEY',
  'LITEAPI_MODE',
  'GOOGLE_PLACES_API_KEY',
];
const initial = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
beforeEach(() => {
  for (const key of keys) delete process.env[key];
  globalThis.fetch = originalFetch;
});
after(() => {
  for (const [key, value] of Object.entries(initial))
    value === undefined ? delete process.env[key] : (process.env[key] = value);
  globalThis.fetch = originalFetch;
});
const jsonResponse = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const modelResponse = (data: unknown) =>
  jsonResponse({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
  });

function researchedResponse(input: { destinationRequests: { name: string; days: number }[] }) {
  const resolved = input.destinationRequests.map((request, index) => {
    const destination = destinations.find((entry) =>
      request.name.toLowerCase().includes(entry.name.toLowerCase()),
    )!;
    assert.ok(destination, 'Fixture destination exists');
    return { destination, request, index, url: `https://example.com/travel/${destination.id}` };
  });
  const value = {
    reply: 'Here are researched places for your selected route.',
    summary: 'Researched named places for the requested route.',
    questions: [],
    destinations: resolved.map(({ destination, request, index, url }) => ({
      requestIndex: index,
      requestedName: request.name,
      name: destination.name,
      country: destination.country,
      region: destination.region,
      description: `${destination.name} is a destination in ${destination.country}.`,
      bestTime: destination.bestTime,
      dailyBudget: destination.dailyBudget,
      coordinates: { latitude: destination.coordinates[0], longitude: destination.coordinates[1] },
      tags: [],
      vibe: destination.vibe,
      sourceUrls: [url],
    })),
    places: resolved.flatMap(({ destination, index, url }) =>
      destination.highlights.slice(0, 3).map((name) => ({
        destinationIndex: index,
        name,
        address: `${name}, ${destination.name}`,
        category: 'sight',
        description: 'A researched visitor landmark.',
        suitability: ['Confirm access directly.'],
        durationMinutes: 90,
        estimatedCost: 10,
        coordinates: null,
        sourceUrls: [url],
      })),
    ),
  };
  return jsonResponse({
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: {
          sources: resolved.map(({ url }) => ({ url, title: 'Official visitor information' })),
        },
      },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
    ],
  });
}

function verifiedResponse(input: { places: { id: string; evidenceUrls?: string[] }[] }) {
  const url = 'https://example.com/current-venue-notices';
  return jsonResponse({
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: { sources: [{ url, title: 'Current venue notices' }] },
      },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              places: input.places.map(({ id }) => ({
                id,
                status: 'no_closure_found',
                reason: 'No closure notice found in checked sources.',
                sourceUrls: [url],
                closureDate: null,
                reopeningDate: null,
              })),
            }),
          },
        ],
      },
    ],
  });
}

test('workflow produces a sourced and reviewed itinerary, with real stage outcomes and no repeated place IDs', async () => {
  globalThis.fetch = async () => {
    throw new Error('No provider should be called without a key');
  };
  const events: PlanningEvent[] = [];
  const result = await runPlanningWorkflow({
    trip: newTrip(),
    message:
      '5 days in Kyoto for 3 people. Budget USD 2400 total. Food and culture, start 2027-04-12. No flights needed. Find hotels for me.',
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.trip.days, 5);
  assert.equal(result.trip.travelers, 3);
  assert.equal(result.trip.startDate, '2027-04-12');
  assert.equal(result.report.budget.target, 2400);
  assert.equal(result.mode, 'local');
  assert.match(result.warning!, /Local planner/);
  assert.equal(result.trip.itinerary.length, 5);
  assert.deepEqual(
    events.filter((event) => event.status === 'completed').map((event) => event.agent),
    ['intake', 'destinations', 'places', 'stays', 'itinerary', 'review'],
  );
  assert.equal(events.find((event) => event.agent === 'flights')?.status, 'skipped');
  const ids = result.trip.itinerary.flatMap((day) =>
    day.items.map((item) => item.placeId).filter(Boolean),
  );
  assert.equal(ids.length, new Set(ids).size);
  assert.ok(ids.length >= 4);
  assert.ok(result.report.sources.every((source) => source.status === 'curated'));
  assert.equal(
    result.report.budget.activities,
    result.trip.itinerary.reduce(
      (sum, day) => sum + day.items.reduce((cost, item) => cost + item.cost, 0),
      0,
    ) * 3,
  );
  assert.equal(result.report.budget.flights, null);
  assert.ok(result.report.budget.accommodation > 0);
  assert.equal(result.report.issues.filter((issue) => issue.code === 'schedule_overlap').length, 0);
});

test('multi-destination requests preserve route order and reserve realistic unconfirmed transfer days', async () => {
  const result = await runPlanningWorkflow({
    trip: newTrip(),
    message:
      '3 days in Paris and 2 days in Lisbon, starting 2027-04-12 for 2 travelers. Budget USD 3000 total. I enjoy food and culture. No flights needed. Find hotels for me.',
  });
  assert.equal(result.trip.days, 5);
  assert.deepEqual(result.trip.brief?.destinationStops, [
    { destinationId: 'paris', days: 3 },
    { destinationId: 'lisbon', days: 2 },
  ]);
  assert.deepEqual(
    result.trip.itinerary.map((day) => day.destinationId),
    ['paris', 'paris', 'paris', 'lisbon', 'lisbon'],
  );
  assert.match(result.trip.itinerary[3].items[0].title, /Travel to Lisbon/);
  assert.equal(result.trip.itinerary[3].items[0].durationMinutes, 420);
  assert.ok(result.report.issues.some((issue) => issue.code === 'transfer_unconfirmed'));
  assert.ok(result.report.budget.unpriced.includes('Travel between destinations'));
});

test('cheaper and slower followups actually change schedule density and estimated activity spend', async () => {
  const first = await runPlanningWorkflow({
    trip: newTrip(),
    message:
      '5 days in Kyoto, starting 2027-04-12 for 2 adults. Budget USD 3000 total. I enjoy food and culture. No flights needed. Find hotels for me.',
  });
  const slower = await runPlanningWorkflow({
    trip: first.trip,
    message: 'Make it slower and cheaper, budget USD 400 total.',
  });
  assert.equal(slower.trip.brief?.pace, 'relaxed');
  assert.ok(slower.trip.itinerary[0].items.length < first.trip.itinerary[0].items.length);
  assert.ok(slower.report.budget.activities < first.report.budget.activities);
  assert.ok(
    slower.report.issues.some((issue) => issue.code === 'over_budget'),
    'An infeasible accommodation budget must remain visible',
  );
});

test('protected stops preserve exact user content and time while generated blocks avoid them', async () => {
  const first = await runPlanningWorkflow({ trip: newTrip(), message: confirmedKyotoRequest });
  const protectedStop = first.trip.itinerary[0].items[1];
  Object.assign(protectedStop, {
    title: 'Our booked tea appointment',
    locked: true,
    time: '10:00',
    durationMinutes: 180,
    completed: true,
  });
  const next = await runPlanningWorkflow({
    trip: first.trip,
    message: 'Make it 4 days with more food',
  });
  assert.deepEqual(
    next.trip.itinerary[0].items.find((item) => item.id === protectedStop.id),
    protectedStop,
  );
  assert.equal(next.report.issues.filter((issue) => issue.code === 'schedule_overlap').length, 0);
  const late = next.trip.itinerary[3].items[0];
  late.locked = true;
  await assert.rejects(
    runPlanningWorkflow({ trip: next.trip, message: 'Make it 2 days' }),
    /protected stop/,
  );
  await assert.rejects(
    runPlanningWorkflow({ trip: first.trip, message: 'Change to Paris for 3 days' }),
    /earlier destination/,
  );
});

test('PATCH scheduling helper normalizes existing route allocations to a changed trip duration', () => {
  const trip = { ...newTrip(), destinationId: 'paris', days: 6 };
  const brief: TravelBrief = {
    pace: 'balanced',
    originAirport: '',
    arrivalAirport: '',
    guestNationality: '',
    includeFlights: false,
    includeHotels: false,
    notes: [],
    destinationStops: [
      { destinationId: 'paris', days: 3 },
      { destinationId: 'lisbon', days: 2 },
    ],
  };
  const days = buildLocalItinerary(trip, brief);
  assert.equal(days.length, 6);
  assert.deepEqual(
    days.map((day) => day.destinationId),
    ['paris', 'paris', 'paris', 'lisbon', 'lisbon', 'lisbon'],
  );
  const shorter = buildLocalItinerary({ ...trip, days: 1 }, brief);
  assert.equal(shorter.length, 1);
  assert.equal(shorter[0].destinationId, 'paris');
});

test('unknown destinations retain requirements and ask for clarification without manufacturing a plan', async () => {
  const result = await runPlanningWorkflow({
    trip: newTrip(),
    message: 'Atlantis for 4 days, $800 and 3 people',
  });
  assert.equal(result.trip.destinationId, '');
  assert.equal(result.trip.days, 4);
  assert.equal(result.trip.budget, 800);
  assert.deepEqual(result.trip.itinerary, []);
  assert.ok(result.report.questions.some((question) => question.field === 'destination'));
  assert.match(result.reply, /Atlantis/);
  assert.deepEqual(result.report.destinations, []);
});

test('without OpenAI unsupported destination changes preserve the saved plan and skip provider calls', async () => {
  const first = await runPlanningWorkflow({
    trip: newTrip(),
    message: `${confirmedKyotoRequest} Vegetarian food.`,
  });
  first.trip.itinerary[0].items[0].locked = true;
  first.trip.itinerary[0].items[0].title = 'Our confirmed appointment';
  const saved = structuredClone(first.trip);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('Unsupported destination must be clarified before research');
  };
  const events: PlanningEvent[] = [];
  const result = await runPlanningWorkflow({
    trip: first.trip,
    message: 'Change the destination to Reykjavik for 4 days, starting 2027-06-10',
    onEvent: (event) => events.push(event),
  });
  assert.equal(calls, 0);
  assert.deepEqual(first.trip, saved);
  assert.deepEqual(result.trip, saved);
  assert.match(result.reply, /Reykjavik/);
  assert.match(result.reply, /existing itinerary is still saved/);
  assert.deepEqual(result.report, saved.planning);
  assert.match(result.warning!, /Live research is needed/);
  assert.equal(events.find((event) => event.agent === 'itinerary')?.status, 'skipped');
});

test('intake restores an explicit known destination when model route metadata contradicts it', async () => {
  process.env.OPENAI_API_KEY = 'unit-key';
  const trip = { ...newTrip(), destinationId: 'london', days: 5 };
  const brief: TravelBrief = {
    ...defaultBrief(),
    destinationStops: [{ destinationId: 'london', days: 5 }],
  };
  for (const proposed of [[], [{ name: 'Bali', days: 4 }]]) {
    globalThis.fetch = async (_url, init) => {
      const input = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
      assert.ok(input.knownDestinations.some((entry: { name: string }) => entry.name === 'London'));
      return modelResponse({
        ...input.current,
        intent: 'plan',
        reply: 'Ready to research.',
        destinationRequests: proposed,
        destinationStops: [{ destinationId: 'bali', days: 4 }],
        days: 4,
      });
    };
    const result = await modelIntake(trip, 'Plan 4 days in London', brief);
    assert.deepEqual(result.destinationRequests, [{ name: 'London', days: 4 }]);
    assert.deepEqual(result.destinationStops, [{ destinationId: 'london', days: 4 }]);
  }
});

test('intake accepts a global city change without mutating the existing saved trip', async () => {
  process.env.OPENAI_API_KEY = 'unit-key';
  const trip = {
    ...newTrip(),
    destinationId: 'kyoto',
    startDate: '2027-04-12',
    days: 3,
    brief: { ...defaultBrief(), destinationStops: [{ destinationId: 'kyoto', days: 3 }] },
  };
  trip.itinerary = buildLocalItinerary(trip, trip.brief);
  trip.itinerary[0].items[0].locked = true;
  const saved = structuredClone(trip);
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
    assert.deepEqual(input.current.destinationRequests, [{ name: 'Kyoto', days: 3 }]);
    return modelResponse({
      ...input.current,
      intent: 'plan',
      reply: 'Research Reykjavik.',
      destinationRequests: [{ name: 'Reykjavik, Iceland', days: 4 }],
      destinationStops: [{ destinationId: 'kyoto', days: 4 }],
      days: 4,
    });
  };
  const result = await modelIntake(
    trip,
    'Change the destination to Reykjavik for 4 days',
    trip.brief,
  );
  assert.deepEqual(result.destinationRequests, [{ name: 'Reykjavik, Iceland', days: 4 }]);
  assert.deepEqual(result.destinationStops, []);
  assert.equal(result.unsupportedDestination, undefined);
  assert.deepEqual(trip, saved);
});

test('intake route requests preserve order over contradictory compatibility IDs', async () => {
  process.env.OPENAI_API_KEY = 'unit-key';
  const trip = { ...newTrip(), destinationId: 'paris', days: 5 };
  const brief: TravelBrief = {
    ...defaultBrief(),
    destinationStops: [
      { destinationId: 'paris', days: 3 },
      { destinationId: 'lisbon', days: 2 },
    ],
  };
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
    return modelResponse({
      ...input.current,
      intent: 'plan',
      reply: 'Keep the route.',
      destinationStops: [
        { destinationId: 'lisbon', days: 2 },
        { destinationId: 'paris', days: 3 },
      ],
    });
  };
  for (const message of ['3 days in Paris and 2 days in Lisbon', 'Make it quieter']) {
    const result = await modelIntake(trip, message, brief);
    assert.deepEqual(result.destinationStops, brief.destinationStops);
  }
});

test('discovery does not turn a compatibility destination ID into a selected route', async () => {
  process.env.OPENAI_API_KEY = 'unit-key';
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
    return modelResponse({
      ...input.current,
      intent: 'discover',
      reply: 'Explore a few beach options.',
      destinationRequests: [],
      destinationStops: [{ destinationId: 'bali', days: input.current.days }],
    });
  };
  const result = await modelIntake(newTrip(), 'Find a relaxing beach escape', defaultBrief());
  assert.equal(result.intent, 'discover');
  assert.deepEqual(result.destinationStops, []);
  assert.deepEqual(result.destinationRequests, []);
});

test('London requirements remain aligned end to end even when intake proposes another destination', async () => {
  process.env.OPENAI_API_KEY = 'unit-key';
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const input = JSON.parse(body.input[0].content);
    if (body.text.format.name === 'travel_intake')
      return modelResponse({
        ...input.current,
        intent: 'plan',
        reply: 'Research the requested city.',
        destinationRequests: [{ name: 'Bali', days: 4 }],
        days: 4,
        startDate: '2026-11-18',
        travelers: 2,
        destinationStops: [{ destinationId: 'bali', days: 4 }],
        notes: ['Vegetarian food, step-free routes, and quiet evenings.'],
      });
    if (body.text.format.name === 'destination_research') return researchedResponse(input);
    if (body.text.format.name === 'place_verification') return verifiedResponse(input);
    assert.deepEqual(input.brief.destinationStops, [{ destinationId: 'london', days: 4 }]);
    return modelResponse({
      summary: 'Four flexible days in London with your recorded requirements.',
      days: Array.from({ length: 4 }, (_, index) => ({
        day: index + 1,
        title: `London day ${index + 1}`,
        placeIds: [],
        note: '',
      })),
    });
  };
  const result = await runPlanningWorkflow({
    trip: newTrip(),
    message:
      'Plan 4 days in London for 2 adults, starting November 18, 2026. Budget USD 2500 total. Vegetarian food, step-free routes, and quiet evenings. No flights needed. Find hotels for me.',
  });
  assert.equal(result.mode, 'live');
  assert.equal(result.trip.destinationId, 'london');
  assert.equal(result.trip.startDate, '2026-11-18');
  assert.equal(result.trip.days, 4);
  assert.equal(result.trip.travelers, 2);
  assert.equal(result.trip.itinerary.length, 4);
  assert.ok(result.trip.itinerary.every((day) => day.destinationId === 'london'));
  assert.deepEqual(
    result.report.destinations.map((destination) => destination.id),
    ['london'],
  );
  assert.match(result.trip.brief!.notes.join(' '), /vegetarian/i);
  assert.match(result.trip.brief!.notes.join(' '), /step-free/i);
  assert.match(result.trip.brief!.notes.join(' '), /quiet/i);
  assert.ok(result.report.budget.unpriced.includes('Accommodation in London'));
  assert.ok(result.report.issues.some((issue) => issue.code === 'requirements_unverified'));
});

test('missing supplier requirements become explicit questions and providers are not called with invented data', async () => {
  process.env.DUFFEL_ACCESS_TOKEN = 'test-token';
  process.env.LITEAPI_API_KEY = 'test-token';
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('Must not call suppliers');
  };
  const result = await runPlanningWorkflow({
    trip: newTrip(),
    message:
      '3 days in Bali for 2 adults. Budget USD 2500 total. I enjoy food and culture. My dates are flexible. Find flights for me. Find hotels for me.',
    brief: { includeFlights: true, includeHotels: true },
  });
  assert.equal(calls, 0);
  assert.ok(result.report.questions.some((question) => question.field === 'origin'));
  assert.ok(
    result.report.questions.length <= 3,
    'Missing supplier details are requested in a bounded consultation',
  );
  assert.equal(result.trip.startDate, '', 'Flexible dates must not become invented flight dates');
  assert.equal(result.trip.brief?.originAirport, '');
  assert.equal(result.trip.brief?.guestNationality, '');
  assert.equal(result.report.budget.flights, null);
});

test('OpenAI specialists make four distinct structured calls including venue verification and composition is grounded to supplied places', async () => {
  process.env.OPENAI_API_KEY = 'unit-key';
  const names: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    names.push(body.text.format.name);
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.ok(init?.signal);
    const input = JSON.parse(body.input[0].content);
    if (body.text.format.name === 'travel_intake')
      return modelResponse({
        ...input.current,
        intent: 'plan',
        reply: 'Research Kyoto.',
        destinationRequests: [{ name: 'Kyoto', days: 3 }],
        destinationStops: [{ destinationId: 'kyoto', days: 3 }],
        days: 3,
        pace: 'relaxed',
      });
    if (body.text.format.name === 'destination_research') return researchedResponse(input);
    if (body.text.format.name === 'place_verification') return verifiedResponse(input);
    assert.equal(body.text.format.name, 'itinerary_composition');
    return modelResponse({
      summary: 'A calm Kyoto trip',
      days: [
        { day: 1, title: 'A garden morning', placeIds: [input.places[0].id], note: '' },
        {
          day: 2,
          title: 'A day to explore freely',
          placeIds: [],
          note: 'Leave room for your own discoveries.',
        },
        { day: 3, title: 'Another Kyoto highlight', placeIds: [input.places[1].id], note: '' },
      ],
    });
  };
  const result = await runPlanningWorkflow({ trip: newTrip(), message: confirmedKyotoRequest });
  assert.deepEqual(names, [
    'travel_intake',
    'destination_research',
    'place_verification',
    'itinerary_composition',
  ]);
  assert.equal(result.mode, 'live');
  assert.equal(result.trip.brief?.pace, 'relaxed');
  assert.equal(
    result.trip.itinerary[1].items.some((item) => item.placeId),
    false,
    'An intentionally flexible model day must not gain unrequested places',
  );
  assert.equal(
    result.trip.itinerary[0].items.find((item) => item.placeId)?.placeId,
    result.report.places[0].id,
  );
});

test('family requirements do not silently become adult-only supplier quotes', async () => {
  process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_key';
  process.env.LITEAPI_API_KEY = 'sandbox_key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('Do not misprice children as adults');
  };
  const result = await runPlanningWorkflow({
    trip: newTrip(),
    message:
      '3 days in Kyoto for 2 adults and 1 child (7-year-old), starting 2027-04-12. Budget USD 2500 total. I enjoy food and culture. Find one-way flights departing 2027-04-11. Find hotels for me.',
    brief: {
      includeFlights: true,
      includeHotels: true,
      originAirport: 'LHR',
      arrivalAirport: 'KIX',
      guestNationality: 'PK',
      consultation: {
        ...defaultConsultation(),
        flightJourney: {
          type: 'one_way',
          departureDate: '2027-04-11',
          returnDate: '',
          cabinClass: 'economy',
          source: 'form',
          evidence: 'One-way flight date selected explicitly in the flight form',
        },
      },
    },
  });
  assert.equal(result.trip.travelers, 3);
  assert.equal(calls, 0);
  assert.ok(result.report.questions.some((question) => question.field === 'travelers'));
  assert.equal(result.report.flights.length, 0);
});

test('extending a saved holiday rechecks flight dates instead of searching the old return journey', async () => {
  const first = await runPlanningWorkflow({
    trip: newTrip(),
    message: confirmedKyotoRequest
      .replace(
        'No flights needed.',
        'Find return flights from LHR to KIX departing 2027-04-11 and returning 2027-04-16.',
      )
      .replace('Find hotels for me.', 'No hotels needed.'),
    brief: {
      originAirport: 'LHR',
      arrivalAirport: 'KIX',
      consultation: {
        ...defaultConsultation(),
        flightJourney: {
          type: 'return',
          departureDate: '2027-04-11',
          returnDate: '2027-04-16',
          cabinClass: 'economy',
          source: 'form',
          evidence: 'Return flights explicitly selected for April 11–16, 2027.',
        },
      },
    },
  });
  assert.equal(first.trip.brief!.consultation!.flightJourney!.returnDate, '2027-04-16');
  process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_fixture';
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error('The former return journey must not be searched after a duration change');
  };
  const result = await runPlanningWorkflow({
    trip: first.trip,
    message: '7 days in Kyoto, please.',
  });
  assert.equal(result.trip.days, 7);
  assert.equal(result.trip.startDate, '2027-04-12');
  assert.equal(result.trip.brief!.consultation!.services.flights.status, 'requested');
  assert.equal(result.trip.brief!.consultation!.flightJourney, undefined);
  assert.ok(result.report.questions.some((question) => question.field === 'flight_dates'));
  assert.equal(requests, 0);
  assert.deepEqual(result.report.flights, []);
});

test('unsupported model place IDs are rejected and the researched local schedule completes the trip', async () => {
  process.env.OPENAI_API_KEY = 'unit-key';
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const input = JSON.parse(body.input[0].content);
    if (body.text.format.name === 'travel_intake')
      return modelResponse({
        ...input.current,
        intent: 'plan',
        reply: 'Research Kyoto.',
        days: 3,
        destinationRequests: [{ name: 'Kyoto', days: 3 }],
      });
    if (body.text.format.name === 'destination_research') return researchedResponse(input);
    if (body.text.format.name === 'place_verification') return verifiedResponse(input);
    return modelResponse({
      summary: 'A bad result',
      days: Array.from({ length: 3 }, (_, index) => ({
        day: index + 1,
        title: 'Invented venue',
        placeIds: ['unresearched-place'],
        note: '',
      })),
    });
  };
  const result = await runPlanningWorkflow({ trip: newTrip(), message: confirmedKyotoRequest });
  assert.equal(result.trip.itinerary.length, 3);
  assert.ok(result.report.issues.some((issue) => issue.code === 'composition_fallback'));
  assert.ok(
    result.trip.itinerary.every((day) =>
      day.items.every((item) => item.placeId !== 'unresearched-place'),
    ),
  );
  assert.match(result.warning!, /partially unavailable/);
});

test('cancellation before work and during model research stops the workflow without a fallback plan', async () => {
  const before = new AbortController();
  before.abort();
  await assert.rejects(
    runPlanningWorkflow({ trip: newTrip(), message: 'Kyoto', signal: before.signal }),
    { name: 'AbortError' },
  );
  process.env.OPENAI_API_KEY = 'unit-key';
  const during = new AbortController();
  globalThis.fetch = async (_url, init) => {
    assert.ok(init?.signal);
    return await new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
      during.abort();
    });
  };
  const events: PlanningEvent[] = [];
  await assert.rejects(
    runPlanningWorkflow({
      trip: newTrip(),
      message: '3 days in Kyoto',
      signal: during.signal,
      onEvent: (event) => events.push(event),
    }),
    { name: 'AbortError' },
  );
  assert.equal(
    events.some((event) => event.agent === 'itinerary'),
    false,
  );
});

test('live tools use supplied dates and identity fields; simulated fares never enter the live budget', async () => {
  process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_key';
  process.env.LITEAPI_API_KEY = 'sandbox_key';
  const calls: { url: string; body: Record<string, any> }[] = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), body });
    if (String(url).includes('duffel'))
      return jsonResponse({
        data: {
          offers: [
            {
              id: 'offer-test',
              owner: { name: 'Test Air' },
              total_amount: '100',
              total_currency: 'USD',
              slices: [
                {
                  duration: 'PT8H',
                  segments: [
                    {
                      departing_at: '2027-04-11T10:00:00',
                      arriving_at: '2027-04-11T18:00:00',
                      origin: { iata_code: 'LHR' },
                      destination: { iata_code: 'KIX' },
                    },
                  ],
                },
                {
                  duration: 'PT8H',
                  segments: [
                    {
                      departing_at: '2027-04-16T10:00:00',
                      arriving_at: '2027-04-16T18:00:00',
                      origin: { iata_code: 'KIX' },
                      destination: { iata_code: 'LHR' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
    return jsonResponse({
      sandbox: true,
      data: [
        {
          hotelId: 'hotel-test',
          roomTypes: [
            {
              offerId: 'stay-test',
              rates: [{ name: 'Room', retailRate: { total: [{ amount: 300, currency: 'USD' }] } }],
            },
          ],
        },
      ],
      hotels: [{ id: 'hotel-test', name: 'Test Hotel' }],
    });
  };
  const result = await runPlanningWorkflow({
    trip: newTrip(),
    message:
      '3 days in Kyoto starting 2027-04-12 for 2 adults. Budget USD 2500 total. I enjoy food and culture. Find return flights from LHR to KIX, departing 2027-04-11 and returning 2027-04-16. Find hotels for me.',
    brief: {
      includeFlights: true,
      includeHotels: true,
      originAirport: 'LHR',
      arrivalAirport: 'KIX',
      guestNationality: 'PK',
      consultation: {
        ...defaultConsultation(),
        flightJourney: {
          type: 'return',
          departureDate: '2027-04-11',
          returnDate: '2027-04-16',
          cabinClass: 'economy',
          source: 'form',
          evidence: 'Return flight dates selected explicitly in the flight form',
        },
      },
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls.find((call) => call.url.includes('liteapi'))?.body.guestNationality, 'PK');
  assert.equal(
    calls.find((call) => call.url.includes('duffel'))?.body.data.slices[0].departure_date,
    '2027-04-11',
  );
  assert.equal(
    result.trip.startDate,
    '2027-04-12',
    'Holiday start and explicitly selected flight date remain separate',
  );
  assert.equal(
    calls.find((call) => call.url.includes('duffel'))?.body.data.slices[1].departure_date,
    '2027-04-16',
  );
  assert.equal(result.report.flights.length, 1);
  assert.equal(result.report.stays[0].name, 'Test Hotel');
  assert.equal(result.report.budget.flights, null);
  assert.notEqual(result.report.budget.accommodation, 300);
  assert.ok(
    result.report.sources
      .filter((source) => source.kind === 'duffel' || source.kind === 'liteapi')
      .every((source) => source.status === 'test'),
  );
});

test('declining hotels retains Google place research, closure checks and transient supplier handling', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'unit-key';
  globalThis.fetch = async (_url, init) => {
    assert.match(
      String((init?.headers as Record<string, string>)['X-Goog-FieldMask']),
      /regularOpeningHours/,
    );
    return jsonResponse({
      places: [
        {
          id: 'place_a',
          displayName: { text: 'Fresh Google Place' },
          formattedAddress: 'Provider address only',
          location: { latitude: 35.01, longitude: 135.77 },
          types: ['tourist_attraction'],
          googleMapsUri: 'https://maps.google.com/place_a',
          regularOpeningHours: { weekdayDescriptions: ['Monday: Closed'] },
          businessStatus: 'OPERATIONAL',
        },
        {
          id: 'far_away',
          displayName: { text: 'Wrong city result' },
          location: { latitude: 0, longitude: 0 },
        },
      ],
    });
  };
  const result = await runPlanningWorkflow({
    trip: newTrip(),
    message: confirmedKyotoRequest.replace('Find hotels for me.', 'No hotels needed.'),
    brief: { pace: 'active' },
  });
  assert.equal(result.trip.brief!.consultation!.services.hotels.status, 'not_needed');
  assert.equal(result.report.budget.accommodation, 0);
  assert.deepEqual(result.report.stays, []);
  assert.equal(
    result.report.budget.unpriced.some((item) => /accommodation/i.test(item)),
    false,
  );
  assert.ok(result.report.places.some((place) => !place.id.startsWith('google-')));
  assert.ok(result.report.places.some((place) => place.id === 'google-place_a'));
  assert.equal(
    result.report.places.some((place) => place.id === 'google-far_away'),
    false,
  );
  assert.ok(result.report.issues.some((issue) => issue.code === 'place_closed'));
  const persistent = stripGooglePlaceContent(result.trip);
  const serialized = JSON.stringify(persistent);
  assert.equal(serialized.includes('Fresh Google Place'), false);
  assert.equal(serialized.includes('Provider address only'), false);
  assert.equal(serialized.includes('Monday: Closed'), false);
  assert.equal(
    persistent.planning?.places.find((place) => place.id === 'google-place_a')?.coordinates,
    undefined,
  );
  assert.ok(serialized.includes('google-place_a'));
  assert.equal(
    persistent.itinerary[0].items.find((item) => item.placeId === 'google-place_a')?.time,
    result.trip.itinerary[0].items.find((item) => item.placeId === 'google-place_a')?.time,
  );
});

test('saved place lookup validates IDs and fetches current details without trusting arbitrary URLs', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'unit-key';
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.equal(String(url), 'https://places.googleapis.com/v1/places/place_a?languageCode=en');
    return jsonResponse({
      id: 'place_a',
      displayName: { text: 'Current name' },
      formattedAddress: 'Fresh address',
      googleMapsUri: 'javascript:alert(1)',
      attributions: [
        { provider: 'Local data provider', providerUri: 'https://example.com/provider' },
        { provider: 'Bad link', providerUri: 'javascript:alert(1)' },
      ],
    });
  };
  await assert.rejects(readGooglePlaceDetails('google-../../secrets', 'kyoto'), /Invalid place ID/);
  assert.equal(calls, 0);
  const place = await readGooglePlaceDetails('google-place_a', 'kyoto');
  assert.equal(place.name, 'Current name');
  assert.match(place.mapsUrl!, /^https:\/\/www.google.com\/maps/);
  assert.equal(place.attributions?.[0].provider, 'Local data provider');
  assert.equal(place.attributions?.[1].providerUri, undefined);
});

test('locked schedule conflicts are reported rather than mutating the traveler’s appointments', async () => {
  const first = await runPlanningWorkflow({ trip: newTrip(), message: confirmedKyotoRequest });
  const morning = first.trip.itinerary[0].items.slice(0, 2);
  for (const item of morning) {
    item.locked = true;
    item.time = '10:00';
  }
  const next = await runPlanningWorkflow({ trip: first.trip, message: 'More food please' });
  assert.ok(next.report.issues.some((issue) => issue.code === 'schedule_overlap'));
  for (const item of morning)
    assert.deepEqual(
      next.trip.itinerary[0].items.find((entry) => entry.id === item.id),
      item,
    );
});

test('intake retains city-country disambiguation and repairs a contradictory global city', async () => {
  process.env.OPENAI_API_KEY = 'unit-key';
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
    return modelResponse({
      ...input.current,
      intent: 'plan',
      reply: 'Research the requested location.',
      days: 3,
      destinationRequests: [
        { name: input.request.includes('Paris') ? 'Paris, Texas, USA' : 'Tokyo, Japan', days: 3 },
      ],
    });
  };
  const paris = await modelIntake(newTrip(), 'Plan 3 days in Paris, Texas, USA', defaultBrief());
  assert.deepEqual(paris.destinationRequests, [{ name: 'Paris, Texas, USA', days: 3 }]);
  assert.deepEqual(paris.destinationStops, []);
  const osaka = await modelIntake(
    newTrip(),
    'Plan 3 days in Osaka, Japan with vegetarian food',
    defaultBrief(),
  );
  assert.deepEqual(osaka.destinationRequests, [{ name: 'Osaka, Japan', days: 3 }]);
  assert.deepEqual(osaka.destinationStops, []);
});
