import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  initializeStudioStorage,
  newStudioWorkspace,
  StudioStore,
} from '../server/studio-store.ts';
import { installStudioRoutes } from '../server/studio-routes.ts';
import { installStudioSupplierRoutes } from '../server/studio-suppliers.ts';
import { buildStudioAssistantActions } from '../shared/studio-assistant.ts';
import { buildStudioFlightQuote } from '../server/studio-flight-planning.ts';
import {
  normalizeFlightOffer,
  normalizeLiteFlightOffer,
  type searchFlights,
  type searchHotels,
} from '../server/integrations.ts';
import { studioDestinationResearchInputKey } from '../server/studio-travel-research.ts';
import type { StudioWorkspace } from '../shared/studio.ts';
import { destinations } from '../shared/catalog.ts';

const originalFetch = globalThis.fetch;
const envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let originalEnv: Record<string, string | undefined>;
const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => {
  originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) delete process.env[name];
  globalThis.fetch = async () => assert.fail('Unexpected external request');
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  globalThis.fetch = originalFetch;
  for (const name of envNames)
    originalEnv[name] === undefined
      ? delete process.env[name]
      : (process.env[name] = originalEnv[name]);
});

function setup(providers: { flights?: typeof searchFlights; hotels?: typeof searchHotels } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  initializeStudioStorage(db);
  const store = new StudioStore(db),
    app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.owner = req.get('x-owner') || 'alice';
    next();
  });
  const deps = {
    db,
    store,
    session: (res: Response) => ({
      id: res.locals.owner,
      owner_id: res.locals.owner,
      user_id: null,
    }),
    requireActiveSession: () => {},
  };
  const controls = installStudioRoutes(app, deps);
  installStudioSupplierRoutes(app, {
    ...deps,
    providers: {
      ...providers,
      hotelDestination: async (stop) => ({
        ...destinations[0],
        id: stop.id,
        name: stop.name,
        country: stop.country,
      }),
    },
  });
  app.use(
    (
      error: Error & { status?: number; code?: string },
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) =>
      res
        .status(error.status || (error instanceof z.ZodError ? 400 : 500))
        .json({ error: error.message, code: error.code }),
  );
  cleanups.push(async () => {
    await controls.shutdown();
    db.close();
  });
  return { app, store, db };
}
const create = async (
  app: ReturnType<typeof express>,
  body: Record<string, unknown> = {},
): Promise<StudioWorkspace> =>
  (await request(app).post('/api/studio/workspaces').send(body).expect(201)).body.workspace;
const path = (workspace: StudioWorkspace, suffix = '') =>
  `/api/studio/workspaces/${workspace.id}${suffix}`;
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const profile = () => ({
  name: 'PRIVATE CLIENT NAME',
  country: 'Australia',
  nationality: 'New Zealand',
  dateOfBirth: '1988-03-02',
  context: 'PRIVATE CONTEXT. Passport number: ABC123456',
  passportNationality: 'Pakistan',
  photoDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  interests: ['Gardens'],
  foodPreferences: ['Vegetarian'],
  history: [
    {
      destination: 'Kyoto',
      country: 'Japan',
      visitedAt: '2025-04',
      feedback: 'liked',
      experience: 'visited',
      notes: 'Liked quiet gardens',
    },
  ],
});
function ready(workspace: StudioWorkspace) {
  workspace.structureAccepted = true;
  Object.assign(workspace.brief, {
    adults: 2,
    children: 0,
    childAges: [],
    startDate: future(101),
    endDate: future(106),
    hotelStandard: 'Four stars',
    hotelLocation: 'Central',
    cabin: 'Business',
  });
  workspace.stops = [
    {
      id: 'london',
      name: 'London',
      country: 'United Kingdom',
      nights: 5,
      arrivalDate: future(101),
      departureDate: future(106),
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
  return workspace;
}
function itinerary(workspace: StudioWorkspace) {
  ready(workspace);
  workspace.recommendations = [
    {
      id: 'sourced-food',
      stopId: 'london',
      category: 'food',
      name: 'Garden café',
      description: 'Review its current menu.',
      included: false,
      sources: [
        {
          label: 'Official venue',
          url: 'https://www.kew.org/visit-kew-gardens/food-drink',
          checkedAt: new Date().toISOString(),
        },
      ],
    },
  ];
  workspace.itinerary = {
    generatedAt: new Date().toISOString(),
    notes: ['Keep the original note'],
    days: [
      {
        day: 1,
        date: future(101),
        stopIds: ['london'],
        title: 'Reviewed cruise port day',
        summary: 'Keep cruise linkage',
        cruiseId: 'reviewed-cruise',
        cruiseDayId: 'port-row-1',
        activities: [],
      },
      {
        day: 2,
        date: future(102),
        stopIds: ['paris'],
        title: 'Another saved day',
        summary: 'Keep this day',
        activities: [],
      },
    ],
  };
  return workspace;
}
const flightInput = () => ({
  origin: 'SYD',
  destination: 'LHR',
  departureDate: future(100),
  returnDate: future(110),
  adults: 2,
  cabinClass: 'business' as const,
});
function duffel() {
  return {
    id: 'PRIVATE_OFFER_TOKEN',
    owner: {
      name: 'Sourced airline',
      iata_code: 'AB',
      logo_symbol_url: 'https://assets.duffel.com/airlines/actual-supplier.svg',
    },
    total_amount: '2468.12',
    total_currency: 'USD',
    expires_at: new Date(Date.now() + 600000).toISOString(),
    slices: [
      {
        id: 'PRIVATE_SLICE',
        duration: 'PT19H',
        segments: [
          {
            id: 'PRIVATE_SEGMENT_1',
            origin: { iata_code: 'SYD', iata_country_code: 'AU' },
            destination: { iata_code: 'DOH', iata_country_code: 'QA' },
            departing_at: `${future(100)}T09:00:00+11:00`,
            arriving_at: `${future(100)}T17:00:00+03:00`,
            marketing_carrier: { name: 'Sourced airline', iata_code: 'AB' },
            passengers: [{ passenger_id: 'PRIVATE_PASSENGER_ID', cabin_class: 'business' }],
          },
          {
            id: 'PRIVATE_SEGMENT_2',
            origin: { iata_code: 'DOH' },
            destination: { iata_code: 'LHR', iata_country_code: 'GB' },
            departing_at: `${future(100)}T19:30:00+03:00`,
            arriving_at: `${future(101)}T01:00:00+00:00`,
            stops: [{ airport: { iata_code: 'AMS', iata_country_code: 'NL' }, duration: 'PT45M' }],
          },
        ],
      },
    ],
  };
}
const advisoryUrl = 'https://www.gov.uk/foreign-travel-advice/japan';
const conditionsUrl = 'https://www.jma.go.jp/jma/en/Activities/earthquake.html';
function researchResponse() {
  return Response.json({
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: {
          sources: [advisoryUrl, conditionsUrl].map((url) => ({
            url,
            title: 'Official test evidence',
          })),
        },
      },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              candidates: [
                {
                  destination: 'Tokyo',
                  countryCode: 'JP',
                  reason: 'An option for stated garden interests.',
                  suggestedDays: 7,
                  thingsToDo: ['Visit public gardens'],
                  conditions: 'Review current local notices.',
                  seasonalGuidance: 'Usual spring patterns, not a forecast.',
                  currentDisruption: false,
                  conditionsVerified: true,
                  advisoryUrl,
                  sources: [{ url: conditionsUrl, publishedAt: new Date().toISOString() }],
                },
              ],
              notes: [],
            }),
          },
        ],
      },
    ],
  });
}
function gatedResearch() {
  process.env.OPENAI_API_KEY = 'unit-test-chat-inspiration';
  let started!: () => void, release!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let modelBody = '',
    cancelled = false;
  globalThis.fetch = async (input, init) => {
    if (String(input) === 'https://api.openai.com/v1/responses') {
      modelBody = String(init?.body);
      started();
      await Promise.race([
        gate,
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              cancelled = true;
              reject(init.signal?.reason);
            },
            { once: true },
          );
        }),
      ]);
      return researchResponse();
    }
    assert.match(
      String(input),
      /^https:\/\/www\.gov\.uk\/api\/content\/foreign-travel-advice\/japan$/,
    );
    return Response.json({
      document_type: 'travel_advice',
      public_updated_at: new Date().toISOString(),
      withdrawn_notice: {},
      details: {
        country: { name: 'Japan', slug: 'japan' },
        alert_status: [],
        summary: '<p>Review local travel advice.</p>',
        reviewed_at: new Date().toISOString(),
      },
    });
  };
  return { began, release: () => release(), body: () => modelBody, cancelled: () => cancelled };
}

test('selected-client creation atomically copies only explicit profile context and preferences, never prior trip party/dates or demographics', async () => {
  const { app, store } = setup();
  const saved = (await request(app).post('/api/studio/client-profiles').send(profile()).expect(201))
    .body.client;
  const previous = await create(app, { clientId: saved.id });
  Object.assign(previous.brief, {
    adults: 8,
    children: 3,
    childAges: [4, 8, 10],
    startDate: '2025-03-01',
    endDate: '2025-03-10',
    budget: 10000,
  });
  store.save('alice', previous, previous.revision);
  const result = await request(app)
    .post('/api/studio/workspaces')
    .send({ clientId: saved.id })
    .expect(201);
  const fresh = result.body.workspace as StudioWorkspace;
  assert.equal(fresh.brief.clientName, saved.name);
  assert.equal(fresh.brief.clientId, saved.id);
  assert.equal(fresh.brief.context, saved.context);
  assert.equal(fresh.brief.passportNationality, 'PK');
  assert.deepEqual(fresh.brief.interests, ['Gardens']);
  assert.deepEqual(fresh.brief.foodPreferences, ['Vegetarian']);
  assert.deepEqual(
    [fresh.brief.adults, fresh.brief.children, fresh.brief.budget],
    [null, null, null],
  );
  assert.deepEqual(
    [fresh.brief.startDate, fresh.brief.endDate, fresh.brief.departureDate],
    ['', '', undefined],
  );
  assert.deepEqual(fresh.brief.childAges, []);
  assert.deepEqual(fresh.stops, []);
  assert.doesNotMatch(JSON.stringify(fresh), /1988-03-02|data:image|dateOfBirth|photoDataUrl/);
  assert.equal(result.body.assistantActions[0].kind, 'destinations');
  const explicit = await create(app, {
    clientId: saved.id,
    title: 'New confirmed party',
    brief: { adults: 1, children: 0, interests: ['Art'] },
  });
  assert.equal(explicit.title, 'New confirmed party');
  assert.equal(explicit.brief.adults, 1);
  assert.deepEqual(explicit.brief.interests, ['Art']);
});

test('wrong-owner or contradictory client creation creates no orphan workspace', async () => {
  const { app, store } = setup();
  const saved = (await request(app).post('/api/studio/client-profiles').send(profile()).expect(201))
    .body.client;
  await request(app)
    .post('/api/studio/workspaces')
    .set('x-owner', 'bob')
    .send({ clientId: saved.id })
    .expect(404);
  assert.equal(store.list('bob').length, 0);
  await request(app)
    .post('/api/studio/workspaces')
    .send({ clientId: saved.id, brief: { clientId: randomUUID() } })
    .expect(400);
  assert.equal(store.list('alice').length, 0);
});

test('grounded chat actions offer destination research without history and keep optional passport out of itinerary authorisation', () => {
  const workspace = newStudioWorkspace();
  workspace.brief.interests = ['Gardens'];
  assert.equal(buildStudioAssistantActions(workspace)[0].kind, 'destinations');
  ready(workspace);
  workspace.brief.passportNationality = '';
  workspace.brief.tripPurpose = 'undecided';
  const actions = buildStudioAssistantActions(workspace);
  for (const kind of [
    'generate_itinerary',
    'hotels',
    'flights',
    'food',
    'activities',
    'cruises',
    'preview',
  ])
    assert.ok(
      actions.some((item) => item.kind === kind),
      kind,
    );
  assert.equal(new Set(actions.map((item) => item.id)).size, actions.length);
  workspace.stops.push({ ...workspace.stops[0], id: 'paris', name: 'Paris', country: 'France' });
  const multiple = buildStudioAssistantActions(workspace);
  for (const question of ['passportNationality', 'tripPurpose', 'budget'])
    assert.ok(
      multiple.some((item) => item.questionId === question),
      question,
    );
  assert.equal(multiple.filter((item) => item.kind === 'hotels').length, 1);
  workspace.structureAccepted = false;
  assert.ok(buildStudioAssistantActions(workspace).some((item) => item.kind === 'approve_route'));
  assert.ok(
    !buildStudioAssistantActions(workspace).some((item) => item.kind === 'generate_itinerary'),
  );
  workspace.structureAccepted = true;
  workspace.stops[0].nights = null;
  assert.ok(
    buildStudioAssistantActions(workspace).some(
      (item) => item.questionId === 'nights' && item.stopId === 'london',
    ),
  );
  assert.ok(
    !buildStudioAssistantActions(workspace).some((item) => item.kind === 'generate_itinerary'),
  );
});

test('existing manual plans offer regeneration only as a secondary action', () => {
  const workspace = itinerary(newStudioWorkspace());
  workspace.itineraryManual = true;
  const actions = buildStudioAssistantActions(workspace);
  assert.notEqual(actions[0].kind, 'generate_itinerary');
  assert.equal(actions.at(-1)?.kind, 'generate_itinerary');
  assert.equal(actions.at(-1)?.label, 'Update daily itinerary');
});

test('profile preference/history edits clear only owned linked inspiration and preserve trip facts, manual days and selections', async () => {
  const { app, store } = setup();
  const saved = (await request(app).post('/api/studio/client-profiles').send(profile()).expect(201))
    .body.client;
  const workspace = itinerary(await create(app, { clientId: saved.id }));
  workspace.itineraryManual = true;
  workspace.destinationResearch = {
    checkedAt: new Date().toISOString(),
    inputKey: 'old-cached-key',
    candidates: [],
    notes: [],
    historyUsed: true,
  };
  store.save('alice', workspace, workspace.revision);
  const foreign = structuredClone(workspace);
  foreign.id = randomUUID();
  store.create('bob', foreign);
  const itineraryBefore = structuredClone(workspace.itinerary),
    briefBefore = structuredClone(workspace.brief);
  await request(app)
    .patch(`/api/studio/client-profiles/${saved.id}`)
    .send({ ...profile(), dateOfBirth: '1988-03-03' })
    .expect(200);
  assert.equal(store.require('alice', workspace.id).revision, workspace.revision);
  assert.ok(store.require('alice', workspace.id).destinationResearch);
  await request(app)
    .patch(`/api/studio/client-profiles/${saved.id}`)
    .send({
      ...profile(),
      interests: ['Art'],
      history: [{ ...profile().history[0], feedback: 'disliked' }],
    })
    .expect(200);
  const current = store.require('alice', workspace.id);
  assert.equal(current.destinationResearch, null);
  assert.equal(current.revision, workspace.revision + 1);
  assert.deepEqual(current.brief, briefBefore);
  assert.deepEqual(current.itinerary, itineraryBefore);
  assert.equal(current.itineraryManual, true);
  assert.deepEqual(current.items, workspace.items);
  assert.ok(store.require('bob', foreign.id).destinationResearch);
});

test('inspiration merges only researched candidates after a concurrent chat/title edit and redacts identity/context from model input', async () => {
  const { app } = setup();
  const saved = (await request(app).post('/api/studio/client-profiles').send(profile()).expect(201))
    .body.client;
  const workspace = await create(app, { clientId: saved.id });
  const model = gatedResearch();
  const pending = request(app)
    .post(path(workspace, '/destinations/research'))
    .send({ revision: workspace.revision, requestId: randomUUID() })
    .then((response) => response);
  await model.began;
  const edited = (
    await request(app)
      .patch(path(workspace))
      .send({ revision: workspace.revision, title: 'Edited while researching' })
      .expect(200)
  ).body.workspace;
  model.release();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(response.body.workspace.title, edited.title);
  assert.equal(response.body.workspace.revision, edited.revision + 1);
  assert.equal(response.body.research.candidates[0].recommendable, true);
  assert.equal(response.body.workspace.stops.length, 0);
  assert.match(model.body(), /Gardens|Vegetarian|quiet gardens/);
  assert.doesNotMatch(
    model.body(),
    /PRIVATE CLIENT NAME|PRIVATE CONTEXT|1988-03-02|data:image|ABC123456|dateOfBirth|photoDataUrl/,
  );
});

test('changed trip preferences reject old inspiration without overwriting the user edit', async () => {
  const { app } = setup();
  const workspace = await create(app, { brief: { interests: ['Gardens'] } });
  const model = gatedResearch();
  const pending = request(app)
    .post(path(workspace, '/destinations/research'))
    .send({ revision: workspace.revision, requestId: randomUUID() })
    .then((response) => response);
  await model.began;
  const edited = (
    await request(app)
      .patch(path(workspace))
      .send({ revision: workspace.revision, brief: { interests: ['Art'] } })
      .expect(200)
  ).body.workspace;
  model.release();
  const response = await pending;
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'STUDIO_RESEARCH_STALE');
  const current = (await request(app).get(path(workspace)).expect(200)).body.workspace;
  assert.equal(current.revision, edited.revision);
  assert.equal(current.destinationResearch, null);
  assert.deepEqual(current.brief.interests, ['Art']);
});

test('editing linked profile preferences or feedback invalidates in-flight inspiration even when workspace revision is unchanged', async () => {
  const { app } = setup();
  const saved = (await request(app).post('/api/studio/client-profiles').send(profile()).expect(201))
    .body.client;
  const workspace = await create(app, { clientId: saved.id });
  const model = gatedResearch();
  const pending = request(app)
    .post(path(workspace, '/destinations/research'))
    .send({ revision: workspace.revision, requestId: randomUUID() })
    .then((response) => response);
  await model.began;
  await request(app)
    .patch(`/api/studio/client-profiles/${saved.id}`)
    .send({ ...profile(), interests: ['Art'] })
    .expect(200);
  model.release();
  const response = await pending;
  assert.equal(response.status, 409);
  assert.equal(response.body.code, 'STUDIO_RESEARCH_STALE');
  assert.equal(
    (await request(app).get(path(workspace)).expect(200)).body.workspace.destinationResearch,
    null,
  );
  const unchanged = studioDestinationResearchInputKey(workspace, []);
  const modified = structuredClone(workspace);
  modified.brief.context += 'Changed';
  assert.notEqual(studioDestinationResearchInputKey(modified, []), unchanged);
});

test('disconnecting the background inspiration aborts its provider and leaves saved workspace unchanged', async () => {
  const { app, store } = setup();
  const workspace = await create(app, { brief: { interests: ['Gardens'] } });
  const server = app.listen(0);
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const model = gatedResearch();
  const pending = request(server)
    .post(path(workspace, '/destinations/research'))
    .send({ revision: workspace.revision, requestId: randomUUID() });
  const completion = pending.then(
    () => undefined,
    () => undefined,
  );
  await model.began;
  pending.abort();
  await completion;
  for (let attempt = 0; attempt < 20 && !model.cancelled(); attempt++)
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  assert.equal(model.cancelled(), true);
  assert.equal(store.require('alice', workspace.id).revision, workspace.revision);
  assert.equal(store.require('alice', workspace.id).destinationResearch, null);
});

test('adding a researched idea copies authoritative sources, preserves cruise rows and other days, and stale retries are idempotent', async () => {
  const { app, store } = setup();
  const workspace = itinerary(await create(app));
  store.save('alice', workspace, workspace.revision);
  const otherDay = structuredClone(workspace.itinerary!.days[1]);
  const body = { revision: workspace.revision, day: 1, period: 'afternoon' };
  const endpoint = path(workspace, '/recommendations/sourced-food/add-to-day');
  await request(app)
    .post(endpoint)
    .send({ ...body, sources: [{ url: 'https://invented.example/' }] })
    .expect(400);
  const result = await request(app).post(endpoint).send(body).expect(200);
  const saved = result.body.workspace as StudioWorkspace;
  assert.equal(result.body.inserted, true);
  assert.equal(saved.itineraryManual, true);
  assert.equal(saved.recommendations[0].included, true);
  assert.equal(saved.itinerary!.days[0].cruiseId, 'reviewed-cruise');
  assert.equal(saved.itinerary!.days[0].cruiseDayId, 'port-row-1');
  assert.deepEqual(saved.itinerary!.days[1], otherDay);
  assert.deepEqual(
    saved.itinerary!.days[0].activities[0].sources,
    workspace.recommendations[0].sources,
  );
  const retry = await request(app).post(endpoint).send(body).expect(200);
  assert.equal(retry.body.inserted, false);
  assert.equal(retry.body.workspace.revision, saved.revision);
  assert.equal(retry.body.workspace.itinerary.days[0].activities.length, 1);
});

test('recommendation insertion validates ownership, destination, source, revision and per-day capacity', async () => {
  const { app, store } = setup();
  const workspace = itinerary(await create(app));
  store.save('alice', workspace, workspace.revision);
  const endpoint = path(workspace, '/recommendations/sourced-food/add-to-day');
  const body = () => ({ revision: workspace.revision, day: 1, period: 'morning' });
  await request(app).post(endpoint).set('x-owner', 'bob').send(body()).expect(404);
  await request(app)
    .post(endpoint)
    .send({ ...body(), day: 2 })
    .expect(400);
  await request(app)
    .post(endpoint)
    .send({ ...body(), day: 3 })
    .expect(404);
  await request(app)
    .post(endpoint)
    .send({ ...body(), revision: 1 })
    .expect(409);
  workspace.recommendations[0].sources = [];
  store.save('alice', workspace, workspace.revision);
  await request(app).post(endpoint).send(body()).expect(409);
  workspace.recommendations[0].sources = [
    { label: 'Official venue', url: 'https://www.kew.org/', checkedAt: new Date().toISOString() },
  ];
  workspace.itinerary!.days[0].activities = Array.from({ length: 20 }, (_, index) => ({
    title: `Existing ${index}`,
    description: '',
    period: 'flexible',
    sources: [],
  }));
  store.save('alice', workspace, workspace.revision);
  await request(app).post(endpoint).send(body()).expect(400);
  assert.equal(store.require('alice', workspace.id).itinerary!.days[0].activities.length, 20);
});

test('flight planning uses explicit offsets/countries/technical-stop duration and avoids eligibility or booking-reference disclosure', () => {
  const workspace = ready(newStudioWorkspace());
  const offer = normalizeFlightOffer(duffel(), flightInput())!;
  const quoteId = randomUUID();
  const flight = buildStudioFlightQuote(
    offer,
    quoteId,
    workspace,
    'test',
    new Date().toISOString(),
  );
  assert.equal(flight.quoteId, quoteId);
  assert.equal(flight.id, quoteId);
  assert.equal(flight.passengerCount, 2);
  assert.equal(flight.price, 2468.12);
  assert.equal(flight.priceScope, 'all_passengers_complete_journey');
  assert.equal(flight.connections[0].durationMinutes, 150);
  assert.equal(flight.connections[0].transitCountryCode, 'QA');
  assert.equal(flight.connections[1].kind, 'technical_stop');
  assert.equal(flight.connections[1].durationMinutes, 45);
  assert.equal(flight.airlineLogoUrl, 'https://assets.duffel.com/airlines/actual-supplier.svg');
  assert.doesNotMatch(
    JSON.stringify(flight),
    /PRIVATE_OFFER|PRIVATE_SLICE|PRIVATE_SEGMENT|PRIVATE_PASSENGER|bookingOfferId/,
  );
  assert.ok(
    flight.advisories.some((item) => /does not establish transit eligibility/.test(item.summary)),
  );
  assert.ok(
    flight.advisories.some(
      (item) => item.kind === 'hotel_timing' && /have not been supplied/.test(item.summary),
    ),
  );
  offer.journeys![0].segments[0].arrival = `${future(100)}T17:00:00`;
  offer.journeys![0].segments[1].departure = `${future(101)}T01:00:00`;
  delete offer.journeys![0].segments[0].destination.countryCode;
  const unknown = buildStudioFlightQuote(
    offer,
    quoteId,
    workspace,
    'test',
    new Date().toISOString(),
  ).connections[0];
  assert.equal(unknown.durationMinutes, null);
  assert.equal(unknown.transitCountryCode, undefined);
  assert.equal(unknown.overnight, true);
});

test('LiteAPI explicit connection minutes and actual logos survive ambiguous local times without guessing a country or logo', () => {
  const input = flightInput();
  const offer = normalizeLiteFlightOffer(
    {
      cheapestOffer: {
        offerId: 'PRIVATE_LITE_TOKEN',
        pricing: { display: { total: 888, currency: 'USD' } },
      },
      segments: [
        {
          originCode: 'SYD',
          destinationCode: 'DOH',
          departureTime: `${future(100)}T09:00:00`,
          arrivalTime: `${future(100)}T17:00:00`,
          direction: 'OUTBOUND',
          carrier: {
            marketingCode: 'AB',
            marketingName: 'Sourced airline',
            marketingLogo: 'https://sandbox.nuitee.flights/static/images/airlines/AB.png',
          },
        },
        {
          originCode: 'DIA',
          destinationCode: 'LHR',
          departureTime: `${future(101)}T01:00:00`,
          arrivalTime: `${future(101)}T07:00:00`,
          direction: 'OUTBOUND',
        },
      ],
      connections: [
        {
          arrivalAirportCode: 'DOH',
          departureAirportCode: 'DIA',
          arrivalTime: `${future(100)}T17:00:00`,
          departureTime: `${future(101)}T01:00:00`,
          direction: 'OUTBOUND',
          duration: { minutes: 480 },
          changeAirport: true,
          overnight: true,
        },
      ],
    },
    { ...input, returnDate: undefined },
  )!;
  const flight = buildStudioFlightQuote(
    offer,
    randomUUID(),
    ready(newStudioWorkspace()),
    'test',
    new Date().toISOString(),
  );
  assert.equal(flight.connections[0].durationMinutes, 480);
  assert.equal(flight.connections[0].airportChange, true);
  assert.equal(flight.connections[0].overnight, true);
  assert.equal(flight.connections[0].transitCountryCode, undefined);
  assert.equal(
    flight.airlineLogoUrl,
    'https://sandbox.nuitee.flights/static/images/airlines/AB.png',
  );
  const minimal = normalizeFlightOffer(
    { ...duffel(), owner: { name: 'Sourced airline', iata_code: 'AB' } },
    input,
  )!;
  assert.equal(minimal.airlineLogoUrl, undefined);
  const unsafe = normalizeFlightOffer(
    {
      ...duffel(),
      owner: {
        name: 'Sourced airline',
        logo_symbol_url: 'https://user:secret@assets.duffel.com/logo.svg',
      },
    },
    input,
  )!;
  assert.equal(unsafe.airlineLogoUrl, undefined);
});

test('flight search exposes scoped supplier details; selection persists them and manual PATCH cannot forge or strip media', async () => {
  const { app, store } = setup({
    flights: async (input) => ({
      offers: [normalizeFlightOffer(duffel(), input)!],
      mode: 'test',
      warning: 'Test fare',
      roundTrip: true,
      source: 'duffel',
    }),
  });
  const workspace = ready(await create(app));
  store.save('alice', workspace, workspace.revision);
  const result = await request(app)
    .post(path(workspace, '/flights/search'))
    .send({ revision: workspace.revision, ...flightInput() })
    .expect(200);
  assert.equal(result.body.flights.length, 1);
  const quote = result.body.quotes[0];
  assert.equal(result.body.flights[0].quoteId, quote.id);
  assert.equal(quote.presentation.kind, 'flight');
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_OFFER|PRIVATE_SLICE|PRIVATE_PASSENGER/);
  const selected = (
    await request(app)
      .post(path(workspace, `/quotes/${quote.id}`))
      .send({ revision: workspace.revision })
      .expect(200)
  ).body.workspace;
  const reloaded = (await request(app).get(path(workspace)).expect(200)).body.workspace;
  assert.deepEqual(reloaded.items[0].presentation, quote.presentation);
  assert.equal(reloaded.items[0].imageUrl, quote.imageUrl);
  await request(app)
    .patch(path(workspace))
    .send({
      revision: selected.revision,
      items: [{ ...selected.items[0], imageUrl: 'https://invented.example/logo.png' }],
    })
    .expect(400);
  await request(app)
    .patch(path(workspace))
    .send({
      revision: selected.revision,
      items: [
        {
          ...selected.items[0],
          presentation: { kind: 'flight', flight: { ...quote.presentation.flight, price: 1 } },
        },
      ],
    })
    .expect(400);
  const { imageUrl: _imageUrl, presentation: _presentation, ...legacyItem } = selected.items[0];
  const patched = (
    await request(app)
      .patch(path(workspace))
      .send({ revision: selected.revision, items: [{ ...legacyItem, included: false }] })
      .expect(200)
  ).body.workspace;
  assert.deepEqual(patched.items[0].presentation, quote.presentation);
  assert.equal(patched.items[0].imageUrl, quote.imageUrl);
  await request(app).get(path(workspace)).set('x-owner', 'bob').expect(404);
});

test('selected hotel room photos and quote terms persist on the canvas item without exposing provider tokens', async () => {
  const { app, store } = setup({
    hotels: async (input) => ({
      offers: [
        {
          id: 'PRIVATE_HOTEL_ID',
          hotelId: 'PRIVATE_HOTEL_ID',
          offerId: 'PRIVATE_ROOM_TOKEN',
          name: 'Sourced hotel',
          image: 'https://hotel.example/hotel.jpg',
          address: 'Central London',
          room: 'Quoted room',
          board: 'Breakfast',
          price: 900,
          currency: 'USD',
          checkin: input.checkin,
          checkout: input.checkout,
          details: {
            photos: [{ url: 'https://hotel.example/hotel.jpg', caption: 'Hotel' }],
            roomPhotos: [
              { url: 'https://hotel.example/actual-room.jpg', caption: 'Actual quoted room' },
            ],
            description: 'Supplier description',
            roomDescription: 'Quoted room details',
            amenities: [],
            roomAmenities: [],
            group: '',
            stars: 4,
            distanceKm: 1.2,
            cancellation: 'Confirm deadline',
            taxes: 'Confirm taxes',
            detailsStatus: 'available',
          },
        },
      ],
      mode: 'test',
      warning: 'Test rate',
    }),
  });
  const workspace = ready(await create(app));
  store.save('alice', workspace, workspace.revision);
  const searched = await request(app)
    .post(path(workspace, '/hotels/search'))
    .send({ revision: workspace.revision, stopId: 'london', guestNationality: 'PK' })
    .expect(200);
  const quote = searched.body.quotes[0];
  assert.equal(quote.imageUrl, 'https://hotel.example/actual-room.jpg');
  assert.equal(quote.presentation.kind, 'hotel');
  assert.doesNotMatch(JSON.stringify(quote), /PRIVATE_HOTEL_ID|PRIVATE_ROOM_TOKEN/);
  await request(app)
    .post(path(workspace, `/quotes/${quote.id}`))
    .send({ revision: workspace.revision })
    .expect(200);
  const reloaded = (await request(app).get(path(workspace)).expect(200)).body.workspace;
  assert.deepEqual(
    reloaded.items[0].presentation.hotel.roomPhotos,
    searched.body.hotels[0].roomPhotos,
  );
  assert.equal(reloaded.items[0].presentation.hotel.cancellation, 'Confirm deadline');
});
