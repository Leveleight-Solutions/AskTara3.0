import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { newStudioWorkspace, StudioError } from '../server/studio-store.ts';
import {
  researchStudioTripBriefing,
  researchStudioWeatherOutlook,
  mergeStudioTripBriefing,
} from '../server/studio-trip-briefing.ts';
import { defaultStudioAgency, type StudioWorkspace } from '../shared/studio.ts';
import type { StudioEntryRequirements } from '../shared/studio-travel-research.ts';
import {
  studioEntryRequirementsInputKey,
  studioTripBriefingDestinations,
  studioTripBriefingFresh,
  studioTripBriefingInputKey,
  studioTripBriefingReady,
  studioBriefingDestinationDated,
  type StudioWeatherOutlook,
} from '../shared/studio-trip-briefing.ts';
import { applyStudioPatch } from '../server/studio-domain.ts';
import { studioPaths, studioSchemas } from '../server/openapi/studio.ts';

const originalFetch = globalThis.fetch;
const envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT', 'NODE_ENV'];
let previous: Record<string, string | undefined>;
const apps: ReturnType<typeof createApp>[] = [];
const servers: Server[] = [];
beforeEach(() => {
  previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.NODE_ENV = 'test';
  process.env.OPENAI_API_KEY = 'unit-test-briefing';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => assert.fail('Unexpected external request');
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const app of apps.splice(0)) {
    await app.locals.studioActions.shutdown();
    await app.locals.planningRuns.shutdown();
    app.locals.db.close();
  }
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const name of envNames)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});

const date = () => new Date().toISOString();
const weatherUrl = 'https://www.jma.go.jp/jma/en/Activities/climate.html';
const visaUrl = 'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html';
function workspace() {
  const value = newStudioWorkspace();
  Object.assign(value.brief, {
    passportNationality: 'PK',
    tripPurpose: 'tourism',
    preferredDestination: 'Tokyo',
    destinationCountry: 'JP',
    startDate: '2027-04-01',
    endDate: '2027-04-09',
    clientName: 'PRIVATE CLIENT NAME',
    context: 'PRIVATE PROFILE DATA',
    request: 'DOB: 1990-02-04. Passport number: ABC123456.',
  });
  return value;
}
function weather(): StudioWeatherOutlook {
  return {
    kind: 'seasonal_outlook',
    checkedAt: date(),
    summary: 'Usual spring patterns; pack layers.',
    days: [],
    sources: [
      {
        label: 'Japan Meteorological Agency',
        url: weatherUrl,
        kind: 'conditions',
        checkedAt: date(),
        publishedAt: '',
      },
    ],
  };
}
function entry(value: StudioWorkspace, stopId = ''): StudioEntryRequirements {
  const target = studioTripBriefingDestinations(value).find((stop) => stop.stopId === stopId)!;
  return {
    checkedAt: date(),
    inputKey: studioEntryRequirementsInputKey(value, stopId),
    stopId,
    passportCountry: 'Pakistan',
    passportCountryCode: 'PK',
    destination: target.destination,
    destinationCountry: target.country,
    destinationCountryCode: target.countryCode,
    category: 'visa_required',
    status: 'corroborated',
    summary: 'A visa application is required.',
    conditions: [],
    electronicAuthorisation: 'Not established.',
    sources: [
      {
        label: 'Immigration authority',
        url: visaUrl,
        kind: 'official_immigration',
        checkedAt: date(),
        publishedAt: '',
      },
    ],
    observations: [],
    notes: [],
  };
}
function aiResponse(data: unknown, urls: string[]) {
  return Response.json({
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: {
          sources: urls.map((url) => ({ url, title: 'Official test evidence' })),
        },
      },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
    ],
  });
}
type ProviderBody = { text: { format: { name: string } }; input: { content: string }[] };
function mockProvider(
  inspect?: (body: ProviderBody, signal?: AbortSignal | null) => void | Promise<void>,
) {
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body)) as ProviderBody;
    await inspect?.(body, init?.signal);
    const { trip, destinationCountryCode } = JSON.parse(body.input[0].content);
    if (body.text.format.name === 'studio_weather_outlook')
      return aiResponse(
        {
          destinationCountryCode,
          kind: 'seasonal_outlook',
          summary: 'April usually calls for light layers and rain protection.',
          sources: [{ url: weatherUrl, publishedAt: '' }],
        },
        [weatherUrl],
      );
    assert.equal(body.text.format.name, 'studio_entry_requirements');
    return aiResponse(
      {
        passportCountryCode: trip.passportCountryCode,
        destinationCountryCode: trip.destinationCountryCode,
        summary: 'Apply for a visa before departure.',
        conditions: [],
        electronicAuthorisation: 'Not established.',
        observations: [
          {
            category: 'visa_required',
            summary: 'An application is required.',
            sourceUrl: visaUrl,
            kind: 'official_immigration',
            passportCountryCode: trip.passportCountryCode,
            destinationCountryCode: trip.destinationCountryCode,
            publishedAt: date(),
            appliesToTrip: true,
          },
        ],
        notes: [],
      },
      [visaUrl],
    );
  };
  return () => calls;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup() {
  const app = createApp(':memory:');
  apps.push(app);
  const server = createServer(app);
  servers.push(server);
  const client = request.agent(server),
    stranger = request.agent(server);
  let value: StudioWorkspace = (await client.post('/api/studio/workspaces').send({}).expect(201))
    .body.workspace;
  value = (
    await client
      .patch(`/api/studio/workspaces/${value.id}`)
      .send({
        revision: value.revision,
        brief: {
          preferredDestination: 'Tokyo',
          destinationCountry: 'JP',
          passportNationality: 'PK',
          tripPurpose: 'tourism',
          startDate: '2027-04-01',
          endDate: '2027-04-09',
        },
      })
      .expect(200)
  ).body.workspace;
  return { app, client, stranger, value, path: `/api/studio/workspaces/${value.id}` };
}

test('briefing readiness starts with known geography while dated scope still requires confirmed real dates', () => {
  const value = workspace();
  value.brief.passportNationality = '';
  value.brief.tripPurpose = 'undecided';
  assert.equal(studioTripBriefingReady(value), true);
  value.brief.startDate = '2027-02-30';
  assert.equal(studioTripBriefingReady(value), true);
  assert.equal(
    studioBriefingDestinationDated(value, studioTripBriefingDestinations(value)[0]),
    false,
  );
  value.brief.startDate = '2027-04-01';
  value.clarification = {
    kind: 'stay_dates',
    stopId: 'tokyo',
    arrivalDate: '2027-04-01',
    departureDate: '2027-04-09',
    statedNights: 7,
    proposedNights: 8,
  };
  assert.equal(studioTripBriefingReady(value), true);
  assert.equal(
    studioBriefingDestinationDated(value, studioTripBriefingDestinations(value)[0]),
    false,
  );
  value.clarification = null;
  value.stops = [
    {
      id: 'tokyo',
      name: 'Tokyo',
      country: 'JP',
      nights: null,
      arrivalDate: '',
      departureDate: '',
      onwardTransport: 'flight',
      neighbourhood: '',
      notes: '',
    },
  ];
  assert.equal(studioTripBriefingReady(value), true);
  assert.equal(
    studioBriefingDestinationDated(value, studioTripBriefingDestinations(value)[0]),
    false,
  );
});

test('safe keys exclude identity data and track passport, purpose, route, date and explicit activities', () => {
  const value = workspace();
  const before = studioTripBriefingInputKey(value);
  assert.doesNotMatch(before, /PRIVATE|DOB|1990-02-04|ABC123456|clientName|dateOfBirth|photo/);
  value.brief.clientName = 'OTHER CLIENT';
  value.brief.budget = 9000;
  assert.equal(studioTripBriefingInputKey(value), before);
  value.brief.passportNationality = 'JP';
  assert.notEqual(studioTripBriefingInputKey(value), before);
  value.brief.passportNationality = 'PK';
  value.brief.request += ' I will do paid work.';
  assert.notEqual(studioTripBriefingInputKey(value), before);
});

test('undeclared passport and purpose leave entry pending while automatic weather remains useful', async () => {
  const value = workspace();
  value.brief.passportNationality = '';
  value.brief.tripPurpose = 'undecided';
  const calls = mockProvider((body) => {
    assert.equal(body.text.format.name, 'studio_weather_outlook');
    assert.doesNotMatch(body.input[0].content, /PRIVATE|1990-02-04|ABC123456|passportCountry/);
  });
  const result = await researchStudioTripBriefing(value);
  assert.equal(calls(), 1);
  assert.equal(result.briefing.status, 'partial');
  assert.equal(result.briefing.stops[0].entryRequirements, null);
  assert.match(result.briefing.stops[0].entryError, /passport nationality/);
  assert.equal(result.briefing.stops[0].weather.kind, 'seasonal_outlook');
  assert.deepEqual(result.briefing.stops[0].weather.days, []);
  assert.match(result.briefing.stops[0].weather.summary, /rather than a forecast/);
});

test('every chosen destination gets its own entry and weather outcome with independent failures', async () => {
  const value = workspace();
  value.stops = [
    {
      id: 'tokyo',
      name: 'Tokyo',
      country: 'JP',
      nights: 4,
      arrivalDate: '2027-04-01',
      departureDate: '2027-04-05',
      onwardTransport: 'flight',
      neighbourhood: '',
      notes: '',
    },
    {
      id: 'paris',
      name: 'Paris',
      country: 'FR',
      nights: 4,
      arrivalDate: '2027-04-05',
      departureDate: '2027-04-09',
      onwardTransport: 'flight',
      neighbourhood: '',
      notes: '',
    },
  ];
  const destinations: string[] = [];
  const result = await researchStudioTripBriefing(value, undefined, {
    researchEntry: async (current, _signal, stopId) => {
      if (stopId === 'paris') throw new Error('Unavailable source');
      return entry(current, stopId);
    },
    researchWeather: async (stop) => {
      destinations.push(stop.destination);
      return weather();
    },
  });
  assert.deepEqual(destinations.sort(), ['Paris', 'Tokyo']);
  assert.equal(result.briefing.stops.length, 2);
  assert.equal(result.briefing.stops[0].entryRequirements?.destinationCountryCode, 'JP');
  assert.equal(result.briefing.stops[1].entryRequirements, null);
  assert.match(result.briefing.stops[1].entryError, /could not be checked/);
  assert.equal(result.briefing.stops[1].weather.kind, 'seasonal_outlook');
  assert.equal(result.briefing.status, 'partial');
  assert.equal(value.tripBriefing, null);
});

test('fresh matching visa research is reused and changed purpose/date invalidates persisted briefing', async () => {
  const value = workspace();
  value.entryRequirements = [entry(value)];
  const result = await researchStudioTripBriefing(value, undefined, {
    researchEntry: async () => assert.fail('Duplicate visa request'),
    researchWeather: async () => weather(),
  });
  value.tripBriefing = result.briefing;
  assert.equal(studioTripBriefingFresh(value), true);
  const reused = await researchStudioTripBriefing(value);
  assert.equal(reused.reused, true);
  applyStudioPatch(
    value,
    { revision: value.revision, brief: { tripPurpose: 'business' } },
    defaultStudioAgency(),
  );
  assert.equal(value.tripBriefing, null);
  assert.deepEqual(value.entryRequirements, []);
});

test('weather rejects invented citation URLs, secondary blogs and a predicted future day', async () => {
  const destination = studioTripBriefingDestinations(workspace())[0];
  for (const [summary, source, searched] of [
    ['April usually calls for layers.', weatherUrl, [visaUrl]],
    [
      'April usually calls for layers.',
      'https://travel-blog.example/climate',
      ['https://travel-blog.example/climate'],
    ],
    ['It will be sunny on April 2.', weatherUrl, [weatherUrl]],
  ] as [string, string, string[]][]) {
    globalThis.fetch = async () =>
      aiResponse(
        {
          destinationCountryCode: 'JP',
          kind: 'seasonal_outlook',
          summary,
          sources: [{ url: source, publishedAt: '' }],
        },
        searched,
      );
    await assert.rejects(
      researchStudioWeatherOutlook(destination),
      (error: unknown) => error instanceof StudioError && error.status === 502,
    );
  }
});

test('seasonal weather allows explicit forecast negation and ordinary packing advice', async () => {
  const destination = studioTripBriefingDestinations(workspace())[0];
  for (const summary of [
    'This is not a forecast. April usually calls for layers.',
    'Usual seasonal patterns, not a daily forecast for the selected dates.',
    'Exact weather cannot be guaranteed. A waterproof jacket will be useful.',
  ]) {
    globalThis.fetch = async () =>
      aiResponse(
        {
          destinationCountryCode: 'JP',
          kind: 'seasonal_outlook',
          summary,
          sources: [{ url: weatherUrl, publishedAt: '' }],
        },
        [weatherUrl],
      );
    const result = await researchStudioWeatherOutlook(destination);
    assert.equal(result.kind, 'seasonal_outlook');
    assert.equal(result.sources[0].url, weatherUrl);
    assert.match(result.summary, /usual seasonal patterns/i);
  }
});

test('negated forecast context cannot hide a separate guaranteed or predicted weather claim', async () => {
  const destination = studioTripBriefingDestinations(workspace())[0];
  for (const summary of [
    'Forecasted rain on April 2 calls for a waterproof jacket.',
    'This is not a forecast, but it will be sunny on April 2.',
    'Not a daily forecast. Guaranteed dry weather throughout the trip.',
    'A waterproof jacket will be useful, and there will be rain throughout the trip.',
  ]) {
    globalThis.fetch = async () =>
      aiResponse(
        {
          destinationCountryCode: 'JP',
          kind: 'seasonal_outlook',
          summary,
          sources: [{ url: weatherUrl, publishedAt: '' }],
        },
        [weatherUrl],
      );
    await assert.rejects(
      researchStudioWeatherOutlook(destination),
      (error: unknown) => error instanceof StudioError && error.status === 502,
    );
  }
});

test('bounded deadline marks checks unavailable and cancellation prevents any result', async () => {
  const value = workspace();
  const waitForAbort = async (_value: unknown, signal?: AbortSignal) => {
    assert.ok(signal);
    await new Promise<void>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    return weather();
  };
  const result = await researchStudioTripBriefing(value, undefined, {
    deadlineMs: 20,
    researchEntry: async (_current, signal) => {
      await waitForAbort(null, signal);
      return entry(value);
    },
    researchWeather: waitForAbort,
  });
  assert.equal(result.briefing.status, 'partial');
  assert.match(result.briefing.stops[0].entryError, /time limit/);
  assert.equal(result.briefing.stops[0].weather.kind, 'unavailable');
  const controller = new AbortController();
  controller.abort(new Error('User cancelled'));
  await assert.rejects(researchStudioTripBriefing(value, controller.signal), /User cancelled/);
});

test('automatic briefing API is owner scoped, persists all research, reuses fresh inputs and replays request IDs', async () => {
  const { client, stranger, value, path } = await setup();
  const calls = mockProvider();
  await stranger
    .post(`${path}/trip-briefing`)
    .send({ revision: value.revision, requestId: randomUUID() })
    .expect(404);
  assert.equal(calls(), 0);
  const body = { revision: value.revision, requestId: randomUUID() };
  const first = (await client.post(`${path}/trip-briefing`).send(body).expect(200)).body;
  assert.equal(calls(), 2);
  assert.equal(first.briefing.status, 'complete');
  assert.equal(first.workspace.entryRequirements[0].passportCountryCode, 'PK');
  assert.deepEqual(first.workspace.tripBriefing, first.briefing);
  const cached = (
    await client
      .post(`${path}/trip-briefing`)
      .send({ revision: first.workspace.revision, requestId: randomUUID() })
      .expect(200)
  ).body;
  assert.equal(cached.reused, true);
  assert.equal(cached.workspace.revision, first.workspace.revision);
  assert.equal(calls(), 2);
  const replay = (await client.post(`${path}/trip-briefing`).send(body).expect(200)).body;
  assert.equal(replay.replayed, true);
  assert.equal(calls(), 2);
  const stored = (await client.get(path).expect(200)).body.workspace;
  assert.deepEqual(stored.tripBriefing, first.briefing);
});

test('background briefing merges only research and preserves concurrent agent edits', async () => {
  const { client, value, path } = await setup();
  const started = deferred(),
    release = deferred();
  mockProvider(async (body) => {
    if (body.text.format.name === 'studio_weather_outlook') {
      started.resolve();
      await release.promise;
    }
  });
  const pending = client
    .post(`${path}/trip-briefing`)
    .send({ revision: value.revision, requestId: randomUUID() })
    .then((response) => response);
  await started.promise;
  const edited = (
    await client
      .patch(path)
      .send({
        revision: value.revision,
        title: 'Agent renamed this trip',
        brief: { budget: 12000, context: 'Keep this private note' },
      })
      .expect(200)
  ).body.workspace;
  release.resolve();
  const result = await pending;
  assert.equal(result.status, 200);
  assert.equal(result.body.workspace.title, 'Agent renamed this trip');
  assert.equal(result.body.workspace.brief.budget, 12000);
  assert.equal(result.body.workspace.brief.context, 'Keep this private note');
  assert.equal(result.body.workspace.revision, edited.revision + 1);
  assert.equal(result.body.workspace.tripBriefing.status, 'complete');
});

test('changed travel inputs cancel old research and stale request replay cannot return an old briefing', async () => {
  const { client, value, path } = await setup();
  const started = deferred();
  mockProvider(async (body, signal) => {
    if (body.text.format.name !== 'studio_weather_outlook') return;
    started.resolve();
    await new Promise<void>((_resolve, reject) =>
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
    );
  });
  const pending = client
    .post(`${path}/trip-briefing`)
    .send({ revision: value.revision, requestId: randomUUID() })
    .then((response) => response);
  await started.promise;
  const edited = (
    await client
      .patch(path)
      .send({ revision: value.revision, brief: { startDate: '2027-04-02' } })
      .expect(200)
  ).body.workspace;
  const cancelled = await pending;
  assert.equal(cancelled.status, 409);
  assert.equal(cancelled.body.code, 'STUDIO_BRIEFING_STALE');
  assert.equal((await client.get(path).expect(200)).body.workspace.revision, edited.revision);
  assert.equal((await client.get(path).expect(200)).body.workspace.tripBriefing, null);
  mockProvider();
  const body = { revision: edited.revision, requestId: randomUUID() };
  const completed = (await client.post(`${path}/trip-briefing`).send(body).expect(200)).body
    .workspace;
  await client
    .patch(path)
    .send({ revision: completed.revision, brief: { passportNationality: 'JP' } })
    .expect(200);
  const staleReplay = await client.post(`${path}/trip-briefing`).send(body).expect(409);
  assert.equal(staleReplay.body.code, 'STUDIO_BRIEFING_STALE');
});

test('same-owner simultaneous automatic calls share one research job despite distinct request IDs', async () => {
  const { app, client, value, path } = await setup();
  const started = deferred(),
    release = deferred();
  const calls = mockProvider(async (body) => {
    if (body.text.format.name === 'studio_weather_outlook') {
      started.resolve();
      await release.promise;
    }
  });
  const first = client
    .post(`${path}/trip-briefing`)
    .send({ revision: value.revision, requestId: randomUUID() })
    .then((response) => response);
  await started.promise;
  const second = client
    .post(`${path}/trip-briefing`)
    .send({ revision: value.revision, requestId: randomUUID() })
    .then((response) => response);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      app.locals.db
        .prepare("SELECT COUNT(*) AS count FROM studio_requests WHERE status='pending'")
        .get().count === 2
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(
    app.locals.db
      .prepare("SELECT COUNT(*) AS count FROM studio_requests WHERE status='pending'")
      .get().count,
    2,
  );
  release.resolve();
  const results = await Promise.all([first, second]);
  assert.deepEqual(
    results.map((result) => result.status),
    [200, 200],
  );
  assert.equal(calls(), 2);
  assert.equal(results[0].body.workspace.revision, results[1].body.workspace.revision);
});

test('briefing rejects missing geography and documents its complete public contract', async () => {
  const { client, value, path } = await setup();
  const changed = (
    await client
      .patch(path)
      .send({
        revision: value.revision,
        brief: { preferredDestination: '', destinationCountry: '' },
      })
      .expect(200)
  ).body.workspace;
  await client
    .post(`${path}/trip-briefing`)
    .send({ revision: changed.revision, requestId: randomUUID() })
    .expect(400);
  assert.ok(studioPaths['/api/studio/workspaces/{id}/trip-briefing']);
  assert.ok(studioSchemas.StudioTripBriefing.properties?.stops);
  assert.ok(studioSchemas.StudioWorkspace.properties?.tripBriefing);
});

test('closing the final briefing response aborts its provider research and never saves partial stale work', async () => {
  const { app, client, value, path } = await setup();
  const started = deferred(),
    providerCancelled = deferred();
  mockProvider(async (body, signal) => {
    if (body.text.format.name !== 'studio_weather_outlook') return;
    started.resolve();
    await new Promise<void>((_resolve, reject) => {
      signal!.addEventListener(
        'abort',
        () => {
          providerCancelled.resolve();
          reject(signal!.reason);
        },
        { once: true },
      );
    });
  });
  const requestId = randomUUID();
  const operation = client
    .post(`${path}/trip-briefing`)
    .send({ revision: value.revision, requestId });
  const response = operation.then(
    () => assert.fail('Cancelled response unexpectedly completed'),
    (error: Error) => assert.match(error.message, /abort/i),
  );
  await started.promise;
  operation.abort();
  await response;
  await providerCancelled.promise;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      app.locals.db.prepare('SELECT status FROM studio_requests WHERE request_id=?').get(requestId)
        .status === 'failed'
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(
    app.locals.db.prepare('SELECT status FROM studio_requests WHERE request_id=?').get(requestId)
      .status,
    'failed',
  );
  const saved = (await client.get(path).expect(200)).body.workspace;
  assert.equal(saved.revision, value.revision);
  assert.equal(saved.tripBriefing, null);
  assert.deepEqual(saved.entryRequirements, []);
});

test('one cancelled subscriber leaves shared same-owner research available to its remaining caller', async () => {
  const { app, client, value, path } = await setup();
  const started = deferred(),
    release = deferred();
  let providerSignal: AbortSignal | null | undefined;
  const calls = mockProvider(async (body, signal) => {
    if (body.text.format.name !== 'studio_weather_outlook') return;
    providerSignal = signal;
    started.resolve();
    await release.promise;
  });
  const firstRequestId = randomUUID();
  const firstOperation = client
    .post(`${path}/trip-briefing`)
    .send({ revision: value.revision, requestId: firstRequestId });
  const first = firstOperation.then(
    () => assert.fail('Cancelled response unexpectedly completed'),
    (error: Error) => assert.match(error.message, /abort/i),
  );
  await started.promise;
  const second = client
    .post(`${path}/trip-briefing`)
    .send({ revision: value.revision, requestId: randomUUID() })
    .then((response) => response);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      app.locals.db
        .prepare("SELECT COUNT(*) AS count FROM studio_requests WHERE status='pending'")
        .get().count === 2
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(
    app.locals.db
      .prepare("SELECT COUNT(*) AS count FROM studio_requests WHERE status='pending'")
      .get().count,
    2,
  );
  firstOperation.abort();
  await first;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      app.locals.db
        .prepare('SELECT status FROM studio_requests WHERE request_id=?')
        .get(firstRequestId).status === 'failed'
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(providerSignal?.aborted, false);
  release.resolve();
  const result = await second;
  assert.equal(result.status, 200);
  assert.equal(result.body.workspace.tripBriefing.status, 'complete');
  assert.equal(calls(), 2);
});

test('a failed automatic entry component preserves a fresh standalone check completed during weather research', async () => {
  const { client, value, path } = await setup();
  const started = deferred(),
    release = deferred();
  let entryCalls = 0;
  mockProvider(async (body) => {
    if (body.text.format.name === 'studio_entry_requirements' && ++entryCalls === 1)
      throw new Error('Synthetic temporary entry-provider failure');
    if (body.text.format.name === 'studio_weather_outlook') {
      started.resolve();
      await release.promise;
    }
  });
  const pending = client
    .post(`${path}/trip-briefing`)
    .send({
      revision: value.revision,
      requestId: randomUUID(),
    })
    .then((response) => response);
  await started.promise;
  const standalone = (
    await client
      .post(`${path}/entry-requirements`)
      .send({
        revision: value.revision,
        requestId: randomUUID(),
      })
      .expect(200)
  ).body;
  assert.equal(standalone.entryRequirements.status, 'corroborated');
  release.resolve();
  const automatic = await pending;
  assert.equal(automatic.status, 200);
  assert.equal(automatic.body.briefing.stops[0].entryRequirements, null);
  assert.match(automatic.body.briefing.stops[0].entryError, /could not be checked/);
  assert.deepEqual(
    automatic.body.workspace.entryRequirements,
    standalone.workspace.entryRequirements,
  );
  assert.equal(automatic.body.workspace.revision, standalone.workspace.revision + 1);
});

test('missing entry components retain only fresh matching checks and new conflicting evidence takes precedence', async () => {
  const value = workspace();
  const { briefing } = await researchStudioTripBriefing(value, undefined, {
    researchEntry: async () => {
      throw new Error('Unavailable source');
    },
    researchWeather: async () => weather(),
  });
  for (const change of [
    (previous: StudioEntryRequirements) => {
      previous.checkedAt = new Date(Date.now() - 7 * 3600000).toISOString();
    },
    (previous: StudioEntryRequirements) => {
      previous.checkedAt = new Date(Date.now() + 3600000).toISOString();
    },
    (previous: StudioEntryRequirements) => {
      previous.inputKey = 'different passport or purpose';
    },
    (previous: StudioEntryRequirements) => {
      previous.stopId = 'another stop';
    },
  ]) {
    const current = structuredClone(value);
    const previous = entry(current);
    change(previous);
    current.entryRequirements = [previous];
    mergeStudioTripBriefing(current, briefing);
    assert.deepEqual(current.entryRequirements, []);
  }
  for (const status of ['conflicting', 'unverified'] as const) {
    const current = structuredClone(value);
    current.entryRequirements = [entry(current)];
    const next = structuredClone(briefing);
    next.stops[0].entryRequirements = {
      ...entry(current),
      status,
      category: 'unknown',
      summary: 'New source evidence needs review.',
    };
    mergeStudioTripBriefing(current, next);
    assert.equal(current.entryRequirements[0].status, status);
    assert.equal(current.entryRequirements[0].category, 'unknown');
  }
});
