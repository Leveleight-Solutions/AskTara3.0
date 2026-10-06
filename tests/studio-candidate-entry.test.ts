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
  StudioError,
} from '../server/studio-store.ts';
import { installStudioRoutes } from '../server/studio-routes.ts';
import {
  researchStudioDestinations,
  checkStudioEntryRequirements,
  researchStudioCandidateEntryRequirements,
  pendingStudioCandidateEntry,
  studioDestinationResearchInputKey,
} from '../server/studio-travel-research.ts';
import {
  studioCandidateEntryInputKey,
  studioCandidateEntryFresh,
  studioCandidateEntryNeedsResearch,
  studioDestinationResearchFresh,
  STUDIO_CANDIDATE_ENTRY_FRESH_MS,
  type StudioDestinationCandidate,
  type StudioEntryRequirements,
} from '../shared/studio-travel-research.ts';
import { applyStudioPatch } from '../server/studio-domain.ts';
import { defaultStudioAgency, type StudioWorkspace } from '../shared/studio.ts';
import type { StudioClientProfile } from '../shared/studio-clients.ts';
import { studioPaths, studioSchemas } from '../server/openapi/studio.ts';
import { researchStudioTripBriefing } from '../server/studio-trip-briefing.ts';

const originalFetch = globalThis.fetch;
const envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let previous: Record<string, string | undefined>;
const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => {
  previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.OPENAI_API_KEY = 'unit-test-candidate-entry';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => assert.fail('Unexpected external request');
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  globalThis.fetch = originalFetch;
  for (const name of envNames)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});

const stamp = () => new Date().toISOString();
const official = 'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html';
const index = 'https://www.passportindex.org/passport/australia/';
function candidate(destination = 'Kyoto', countryCode = 'JP'): StudioDestinationCandidate {
  return {
    destination,
    country: countryCode === 'JP' ? 'Japan' : countryCode,
    countryCode,
    reason: 'A culture and gardens suggestion from stated interests.',
    suggestedDays: 7,
    thingsToDo: ['Visit public gardens'],
    conditions: 'Check local conditions before travelling.',
    seasonalGuidance: 'Usual spring patterns, not a forecast.',
    status: 'checked',
    advisory: 'Current advisory checked.',
    recommendable: true,
    sources: [],
  };
}
function workspace(candidates = [candidate()]): StudioWorkspace {
  const value = newStudioWorkspace();
  Object.assign(value.brief, {
    passportNationality: 'AU',
    clientName: 'PRIVATE CLIENT NAME',
    context: 'PRIVATE PROFILE CONTEXT',
    origin: 'PRIVATE ORIGIN',
    request: 'DOB: 1988-03-02. Passport number: ABC123456.',
    interests: ['gardens'],
  });
  value.destinationResearch = {
    inputKey: studioDestinationResearchInputKey(value),
    checkedAt: stamp(),
    historyUsed: false,
    candidates,
    notes: [],
  };
  return value;
}
function entry(value: StudioWorkspace): StudioEntryRequirements {
  return {
    inputKey: '',
    checkedAt: stamp(),
    stopId: '',
    passportCountry: 'Australia',
    passportCountryCode: 'AU',
    destination: value.brief.preferredDestination || '',
    destinationCountry: 'Japan',
    destinationCountryCode: 'JP',
    status: 'corroborated',
    category: 'visa_free',
    summary: 'A conditional short-stay exemption is published for ordinary passports.',
    conditions: ['Confirm permitted visitor purpose, duration and passport validity.'],
    electronicAuthorisation: 'Check any separately required electronic authorisation.',
    sources: [
      {
        label: 'Official immigration',
        url: official,
        checkedAt: stamp(),
        publishedAt: '',
        kind: 'official_immigration',
      },
    ],
    observations: [],
    notes: [],
  };
}
function response(data: unknown, urls = [official]) {
  return Response.json({
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: { sources: urls.map((url) => ({ url, title: 'Test official evidence' })) },
      },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
    ],
  });
}
function entryData(trip: Record<string, unknown>) {
  return {
    passportCountryCode: trip.passportCountryCode,
    destinationCountryCode: trip.destinationCountryCode,
    summary: 'Conditional short-stay guidance; confirm the permitted purpose and stay.',
    conditions: ['This guidance covers ordinary passports and permitted visitor activities only.'],
    electronicAuthorisation: 'No separate authorisation established; recheck before travel.',
    observations: [
      {
        category: 'visa_free',
        summary: 'Conditional passport-specific exemption.',
        sourceUrl: official,
        kind: 'official_immigration',
        passportCountryCode: trip.passportCountryCode,
        destinationCountryCode: trip.destinationCountryCode,
        publishedAt: '',
        appliesToTrip: true,
      },
    ],
    notes: [],
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function mockEntry(inspect?: (body: Record<string, any>) => void) {
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.openai.com/v1/responses');
    calls++;
    const body = JSON.parse(String(init?.body));
    inspect?.(body);
    return response(entryData(JSON.parse(body.input[0].content).trip));
  };
  return () => calls;
}
function gatedEntry() {
  const started = deferred(),
    released = deferred();
  let aborted = false,
    calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    started.resolve();
    await Promise.race([
      released.promise,
      new Promise<never>((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => {
          aborted = true;
          reject(signal?.reason);
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      }),
    ]);
    return response(entryData(JSON.parse(body.input[0].content).trip));
  };
  return {
    started: started.promise,
    release: released.resolve,
    calls: () => calls,
    aborted: () => aborted,
  };
}
function setup() {
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
  const controls = installStudioRoutes(app, {
    db,
    store,
    session: (res: Response) => ({
      id: res.locals.owner,
      owner_id: res.locals.owner,
      user_id: null,
    }),
    requireActiveSession: () => {},
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
  return { app, store };
}
async function seed(client?: StudioClientProfile) {
  const context = setup();
  let savedClient: StudioClientProfile | undefined;
  if (client)
    savedClient = (
      await request(context.app).post('/api/studio/client-profiles').send(client).expect(201)
    ).body.client;
  const created: StudioWorkspace = (
    await request(context.app)
      .post('/api/studio/workspaces')
      .send(savedClient ? { clientId: savedClient.id } : {})
      .expect(201)
  ).body.workspace;
  if (!savedClient) created.brief.passportNationality = 'AU';
  created.destinationResearch = {
    ...workspace().destinationResearch!,
    inputKey: studioDestinationResearchInputKey(created, [], savedClient),
  };
  const value = context.store.save('alice', created, created.revision);
  return { ...context, value, path: `/api/studio/workspaces/${value.id}`, client: savedClient };
}

test('a passport-aware suggestion immediately has explicit pending entry state without blocking destination research', async () => {
  const value = workspace();
  const advisory = 'https://www.gov.uk/foreign-travel-advice/japan';
  const conditions = 'https://www.jma.go.jp/jma/en/Activities/climate.html';
  let modelCalls = 0;
  globalThis.fetch = async (input) => {
    if (String(input) === 'https://api.openai.com/v1/responses') {
      modelCalls++;
      return response(
        {
          candidates: [
            {
              destination: 'Kyoto',
              countryCode: 'JP',
              reason: 'Gardens match stated interests.',
              suggestedDays: 7,
              thingsToDo: ['Explore gardens'],
              conditions: 'Consult the official current notice.',
              seasonalGuidance: 'Usual seasonal patterns.',
              currentDisruption: false,
              conditionsVerified: true,
              advisoryUrl: advisory,
              sources: [{ url: conditions, publishedAt: stamp() }],
            },
          ],
          notes: [],
        },
        [advisory, conditions],
      );
    }
    return Response.json({
      document_type: 'travel_advice',
      public_updated_at: stamp(),
      withdrawn_notice: {},
      details: {
        country: { name: 'Japan', slug: 'japan' },
        alert_status: [],
        summary: 'Current public advice.',
        reviewed_at: stamp(),
      },
    });
  };
  const research = await researchStudioDestinations(value);
  assert.equal(modelCalls, 1);
  assert.equal(research.candidates[0].entryRequirements?.status, 'pending');
  assert.equal(research.candidates[0].entryRequirements?.passportCountryCode, 'AU');
  assert.match(research.candidates[0].entryRequirements?.summary || '', /preliminary/);
});

test('Kyoto checks the declared Australian passport before purpose, dates or route are known and excludes private identity', async () => {
  const value = workspace();
  const before = structuredClone(value);
  mockEntry((body) => {
    const trip = JSON.parse(body.input[0].content).trip;
    assert.equal(trip.scope, 'destination_shortlist');
    assert.equal(trip.passportCountryCode, 'AU');
    assert.equal(trip.destination, 'Kyoto');
    assert.equal(trip.destinationCountryCode, 'JP');
    assert.equal(trip.purpose, 'undecided');
    assert.equal(trip.startDate, '');
    assert.equal(trip.suggestedStayConfirmed, false);
    assert.equal(trip.passportTypeConfirmed, false);
    assert.doesNotMatch(
      body.input[0].content,
      /PRIVATE|ABC123456|1988-03-02|clientName|context|photo|dateOfBirth|origin/,
    );
    assert.match(body.instructions, /never select tourism as a fact/);
    assert.match(body.instructions, /ordinary passport is an explicit planning assumption/);
  });
  const result = await researchStudioCandidateEntryRequirements(value);
  const checked = result.candidates[0].entryRequirements!;
  assert.equal(checked.status, 'preliminary');
  assert.equal(checked.category, 'visa_free');
  assert.equal(checked.passportCountryCode, 'AU');
  assert.equal(checked.sources[0].url, official);
  assert.ok(checked.missingFacts.includes('Travel purpose and permitted activities'));
  assert.ok(checked.missingFacts.includes('Passport type (ordinary passport assumed)'));
  assert.ok(checked.missingFacts.includes('Confirmed arrival and departure dates'));
  assert.match(checked.notes.join(' '), /different passports need separate checks/);
  assert.deepEqual(value, before);
  assert.deepEqual(value.entryRequirements, []);
  assert.equal(value.stops.length, 0);
});

test('duplicate city/country suggestions retain the strongest verified caution and all searched evidence', async () => {
  const value = workspace();
  const advisory = 'https://www.gov.uk/foreign-travel-advice/japan';
  const conditions = 'https://www.jma.go.jp/jma/en/Activities/climate.html';
  const warning = 'https://www.jma.go.jp/bosai/warning/';
  const raw = {
    destination: 'Kyoto',
    countryCode: 'JP',
    reason: 'Gardens match stated interests.',
    suggestedDays: 7,
    thingsToDo: ['Explore gardens'],
    conditions: 'Consult the current notice.',
    seasonalGuidance: 'Usual seasonal patterns.',
    currentDisruption: false,
    conditionsVerified: true,
    advisoryUrl: advisory,
    sources: [{ url: conditions, publishedAt: stamp() }],
  };
  globalThis.fetch = async (input) => {
    if (String(input) === 'https://api.openai.com/v1/responses')
      return response(
        {
          candidates: [
            raw,
            {
              ...raw,
              destination: ' KYOTO ',
              currentDisruption: true,
              conditions: 'An active notice needs agent review.',
              sources: [{ url: warning, publishedAt: stamp() }],
            },
          ],
          notes: [],
        },
        [advisory, conditions, warning],
      );
    return Response.json({
      document_type: 'travel_advice',
      public_updated_at: stamp(),
      withdrawn_notice: {},
      details: {
        country: { name: 'Japan', slug: 'japan' },
        alert_status: [],
        summary: 'Current public advice.',
        reviewed_at: stamp(),
      },
    });
  };
  value.destinationResearch = await researchStudioDestinations(value);
  assert.equal(value.destinationResearch.candidates.length, 1);
  const card = value.destinationResearch.candidates[0];
  assert.equal(card.destination, 'Kyoto');
  assert.equal(card.status, 'warning');
  assert.equal(card.recommendable, false);
  assert.match(card.conditions, /active notice/);
  assert.ok(card.sources.some((source) => source.url === conditions));
  assert.ok(card.sources.some((source) => source.url === warning));
  const calls = mockEntry();
  await researchStudioCandidateEntryRequirements(value);
  assert.equal(calls(), 1);
});

test('nationality, residence, profile identity and mixed passport text never substitute for a declared passport', async () => {
  for (const passportNationality of ['', 'Australian and Pakistani', 'AU PK', 'Sydney']) {
    const value = workspace();
    value.brief.passportNationality = passportNationality;
    Object.assign(value.brief, { nationality: 'AU', country: 'AU', origin: 'Sydney' });
    const result = await researchStudioCandidateEntryRequirements(value);
    assert.equal(result.candidates[0].entryRequirements?.status, 'missing_passport');
    assert.equal(result.candidates[0].entryRequirements?.category, 'unknown');
    assert.equal(studioCandidateEntryNeedsResearch(value, result.candidates[0]), false);
  }
});

test('candidate baseline retains known business, study, employment and arrival modes instead of assuming tourist entry', async () => {
  for (const purpose of ['business', 'study', 'employment', 'other'] as const) {
    const value = workspace();
    Object.assign(value.brief, {
      tripPurpose: purpose,
      outboundTransport: 'cruise',
      returnTransport: 'flight',
      startDate: '2027-04-01',
      endDate: '2027-04-10',
      request: 'I will attend meetings, with no employment or paid work.',
    });
    mockEntry((body) => {
      const trip = JSON.parse(body.input[0].content).trip;
      assert.equal(trip.purpose, purpose);
      assert.equal(trip.arrivalTransport, 'cruise');
      assert.equal(trip.departureTransport, 'flight');
      assert.deepEqual(trip.declaredActivities, {
        attendingMeetings: true,
        localEmployment: false,
        paidWork: false,
      });
    });
    const result = await researchStudioCandidateEntryRequirements(value);
    assert.equal(result.candidates[0].entryRequirements?.status, 'preliminary');
    assert.equal(value.tripBriefing, null);
  }
});

test('conflicting official and index categories remain unknown and retain both source statements', async () => {
  const value = workspace();
  globalThis.fetch = async (_input, init) => {
    const trip = JSON.parse(JSON.parse(String(init?.body)).input[0].content).trip;
    const data = entryData(trip);
    return response(
      {
        ...data,
        observations: [
          ...data.observations,
          { ...data.observations[0], category: 'visa_required', sourceUrl: index, kind: 'index' },
        ],
      },
      [official, index],
    );
  };
  const result = await researchStudioCandidateEntryRequirements(value);
  assert.equal(result.candidates[0].entryRequirements?.status, 'conflicting');
  assert.equal(result.candidates[0].entryRequirements?.category, 'unknown');
  assert.equal(result.candidates[0].entryRequirements?.sources.length, 2);
});

test('entry prose removes verified inline citations and known implementation flags without dropping permit or ETA conditions', async () => {
  const value = workspace();
  Object.assign(value.brief, {
    preferredDestination: 'Kyoto',
    destinationCountry: 'JP',
    tripPurpose: 'tourism',
  });
  const extra = 'https://www.mofa.go.jp/j_info/visit/visa/visaonline.html';
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.match(body.instructions, /Never mention internal field names/);
    const data = entryData(JSON.parse(body.input[0].content).trip);
    return response(
      {
        ...data,
        summary: `Permitted visitor activities still exclude paid local work. ([Policy](${official}))`,
        conditions: [
          `Obtain a work permit before paid local work. ([Policy](${official}))`,
          'This destination_shortlist check has appliesToTrip=true; the stay remains subject to its published limits.',
        ],
        electronicAuthorisation: `An ETA must be approved before departure if the applicable policy requires it. ([Authorisation policy](${extra}))`,
        notes: [
          'appliesToTrip=false leaves this policy condition unresolved.',
          `Check the publication date: ${extra}`,
        ],
      },
      [official, extra],
    );
  };
  const checked = await checkStudioEntryRequirements(value);
  assert.equal(checked.status, 'corroborated');
  assert.equal(checked.summary, 'Permitted visitor activities still exclude paid local work.');
  assert.equal(checked.conditions[0], 'Obtain a work permit before paid local work.');
  assert.match(checked.conditions[1], /destination suggestion.*a source match/);
  assert.match(checked.electronicAuthorisation, /An ETA must be approved before departure/);
  assert.match(checked.notes[0], /an unresolved source match.*policy condition unresolved/);
  const prose = [
    checked.summary,
    ...checked.conditions,
    checked.electronicAuthorisation,
    ...checked.notes,
  ].join(' ');
  assert.doesNotMatch(prose, /appliesToTrip|destination_shortlist|https?:|\]\(/);
  assert.ok(checked.sources.some((source) => source.url === official));
  assert.ok(checked.sources.some((source) => source.url === extra));
});

test('entry prose rejects unsearched, executable or unsupported inline citation sources before returning any guidance', async () => {
  const value = workspace();
  Object.assign(value.brief, {
    preferredDestination: 'Kyoto',
    destinationCountry: 'JP',
    tripPurpose: 'tourism',
  });
  for (const [citation, urls, pattern] of [
    ['https://invented.example/visa', [official], /inline citation.*not found/],
    ['javascript:alert(1)', [official], /inline citation.*not found/],
    [
      'https://www.henleyglobal.com/passport-index',
      [official, 'https://www.henleyglobal.com/passport-index'],
      /unsupported automated data source/,
    ],
  ] as [string, string[], RegExp][]) {
    globalThis.fetch = async (_input, init) => {
      const trip = JSON.parse(JSON.parse(String(init?.body)).input[0].content).trip;
      return response(
        { ...entryData(trip), notes: [`Review this policy. ([Source](${citation}))`] },
        urls,
      );
    };
    await assert.rejects(checkStudioEntryRequirements(value), pattern);
    const unavailable = await researchStudioCandidateEntryRequirements(value);
    assert.equal(unavailable.candidates[0].entryRequirements?.status, 'unavailable');
    assert.equal(unavailable.candidates[0].entryRequirements?.sources.length, 0);
  }
});

test('explicit negative entry cautions retain their verified sources instead of being rejected as guarantees', async () => {
  const value = workspace();
  Object.assign(value.brief, {
    preferredDestination: 'Kyoto',
    destinationCountry: 'JP',
    tripPurpose: 'tourism',
  });
  for (const summary of [
    'No guaranteed entry.',
    'No entry is guaranteed.',
    'There is no guaranteed entry to the destination.',
    'Guaranteed entry is not available.',
    'Do not assume guaranteed entry.',
  ]) {
    globalThis.fetch = async (_input, init) => {
      const trip = JSON.parse(JSON.parse(String(init?.body)).input[0].content).trip;
      return response({ ...entryData(trip), summary });
    };
    const result = await checkStudioEntryRequirements(value);
    assert.equal(result.summary, summary);
    assert.equal(result.sources[0].url, official);
    assert.equal(result.category, 'visa_free');
  }
});

test('a negative disclaimer cannot hide a positive guarantee in its clause, another clause or another field', async () => {
  const value = workspace();
  Object.assign(value.brief, {
    preferredDestination: 'Kyoto',
    destinationCountry: 'JP',
    tripPurpose: 'tourism',
  });
  for (const patch of [
    { summary: 'No guaranteed entry. Guaranteed entry is assured.' },
    { summary: 'No guaranteed entry, but guaranteed entry is assured.' },
    { summary: 'No guaranteed entry; however it is completely safe.' },
    { summary: 'This is not a safe destination, and it is totally safe.' },
    { summary: 'It is not only guaranteed entry; admission is assured.' },
    { summary: 'Guaranteed entry is not only available but assured.' },
    { summary: 'Guaranteed entry is not merely possible; it is certain.' },
    { summary: 'Guaranteed entry is not impossible.' },
    { summary: 'There is not no guaranteed entry.' },
    { summary: 'No guaranteed entry is not available.' },
    { summary: 'No guaranteed entry cannot be assured.' },
    { summary: 'No guaranteed entry is not available to tourists.' },
    { summary: 'No guaranteed entry cannot be assured for ordinary passports.' },
    { summary: 'Guaranteed entry is not available except to premium clients.' },
    { summary: 'Guaranteed entry is not available only to students; everyone else has it.' },
    { summary: 'No guaranteed entry, but admission is certain.' },
    { summary: 'No guaranteed entry. Your entry is guaranteed.' },
    { summary: 'No guaranteed entry.', conditions: ['You have guaranteed entry.'] },
    { summary: 'Entry is not guaranteed.', notes: ['Completely safe.'] },
  ]) {
    globalThis.fetch = async (_input, init) => {
      const trip = JSON.parse(JSON.parse(String(init?.body)).input[0].content).trip;
      return response({ ...entryData(trip), ...patch });
    };
    await assert.rejects(
      checkStudioEntryRequirements(value),
      /unsupported safety or entry guarantee/,
    );
  }
});

test('destination research keeps its original safety guard and cannot recommend a directly unsuitable candidate', async () => {
  const value = workspace();
  const advisory = 'https://www.gov.uk/foreign-travel-advice/japan';
  const conditions = 'https://www.jma.go.jp/jma/en/Activities/climate.html';
  for (const reason of [
    'This is not a safe destination.',
    'This is a completely safe destination.',
    'No guaranteed entry.',
  ]) {
    globalThis.fetch = async (input) => {
      assert.equal(String(input), 'https://api.openai.com/v1/responses');
      return response(
        {
          candidates: [
            {
              destination: 'Kyoto',
              countryCode: 'JP',
              reason,
              suggestedDays: 7,
              thingsToDo: ['Explore gardens'],
              conditions: 'Consult current notices.',
              seasonalGuidance: 'Usual patterns.',
              currentDisruption: false,
              conditionsVerified: true,
              advisoryUrl: advisory,
              sources: [{ url: conditions, publishedAt: stamp() }],
            },
          ],
          notes: [],
        },
        [advisory, conditions],
      );
    };
    await assert.rejects(
      researchStudioDestinations(value),
      /unsupported safety or entry guarantee/,
    );
  }
});

test('verified inline citations are cleaned before exact entry cautions without admitting contradictory cautions', async () => {
  const value = workspace();
  Object.assign(value.brief, {
    preferredDestination: 'Kyoto',
    destinationCountry: 'JP',
    tripPurpose: 'tourism',
  });
  const summaries = [
    `Guaranteed entry is not available ([MOFA](${official})).`,
    `No guaranteed entry is not available ([MOFA](${official})).`,
    `No guaranteed entry cannot be assured ([MOFA](${official})).`,
  ];
  for (const [index, summary] of summaries.entries()) {
    globalThis.fetch = async (_input, init) => {
      const trip = JSON.parse(JSON.parse(String(init?.body)).input[0].content).trip;
      return response({ ...entryData(trip), summary });
    };
    if (!index) {
      const result = await checkStudioEntryRequirements(value);
      assert.equal(result.summary, 'Guaranteed entry is not available.');
      assert.equal(result.sources[0].url, official);
    } else
      await assert.rejects(
        checkStudioEntryRequirements(value),
        /unsupported safety or entry guarantee/,
      );
  }
});

test('briefing citation failures log only a fixed reason while keeping weather and an explicit review outcome', async () => {
  const value = workspace();
  Object.assign(value.brief, {
    preferredDestination: 'Kyoto',
    destinationCountry: 'JP',
    tripPurpose: 'tourism',
    startDate: '2027-04-01',
    endDate: '2027-04-04',
  });
  const originalWarn = console.warn;
  const diagnostics: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    diagnostics.push(args);
  };
  try {
    const result = await researchStudioTripBriefing(value, undefined, {
      researchEntry: async () => {
        throw new StudioError(
          502,
          'Research included a source that was not found in the current search. Please retry.',
        );
      },
      researchWeather: async () => ({
        kind: 'seasonal_outlook',
        checkedAt: stamp(),
        summary: 'Usual seasonal patterns.',
        sources: [],
        days: [],
      }),
    });
    assert.equal(result.briefing.stops[0].entryRequirements, null);
    assert.match(result.briefing.stops[0].entryError, /could not be checked/);
    assert.equal(result.briefing.stops[0].weather.kind, 'seasonal_outlook');
    assert.deepEqual(diagnostics, [
      ['Studio trip briefing component failed', { kind: 'entry', reason: 'research_citation' }],
    ]);
    diagnostics.length = 0;
    await researchStudioTripBriefing(value, undefined, {
      researchEntry: async () => {
        throw new Error('PRIVATE PROVIDER BODY, NAME AND PASSPORT');
      },
      researchWeather: async () => ({
        kind: 'unavailable',
        checkedAt: stamp(),
        summary: 'Unavailable.',
        sources: [],
        days: [],
      }),
    });
    assert.deepEqual(diagnostics, [
      ['Studio trip briefing component failed', { kind: 'entry', reason: 'internal' }],
    ]);
    assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE|AU|Kyoto|passport|body/i);
  } finally {
    console.warn = originalWarn;
  }
});

test('commercial evidence cannot corroborate entry and invented URLs or wrong passport results fail only the affected candidate', async () => {
  for (const failure of ['commercial', 'invented', 'wrong_passport']) {
    const value = workspace();
    globalThis.fetch = async (_input, init) => {
      const trip = JSON.parse(JSON.parse(String(init?.body)).input[0].content).trip;
      const data = entryData(trip);
      if (failure === 'commercial')
        return response(
          {
            ...data,
            observations: [
              { ...data.observations[0], sourceUrl: 'https://commercial.example/visa' },
            ],
          },
          ['https://commercial.example/visa'],
        );
      if (failure === 'invented') return response(data, []);
      return response({ ...data, passportCountryCode: 'GB' });
    };
    const result = await researchStudioCandidateEntryRequirements(value);
    const checked = result.candidates[0].entryRequirements!;
    assert.equal(checked.status, failure === 'commercial' ? 'unverified' : 'unavailable');
    assert.equal(checked.category, 'unknown');
  }
});

test('fresh terminal entry outcomes reuse the snapshot, while absent legacy records are checked automatically', async () => {
  const value = workspace();
  const calls = mockEntry();
  value.destinationResearch = await researchStudioCandidateEntryRequirements(value);
  assert.equal(calls(), 1);
  const first = structuredClone(value.destinationResearch);
  const reused = await researchStudioCandidateEntryRequirements(value);
  assert.equal(calls(), 1);
  assert.deepEqual(reused, first);
  for (const status of ['unverified', 'unavailable', 'conflicting'] as const) {
    value.destinationResearch.candidates[0].entryRequirements!.status = status;
    await researchStudioCandidateEntryRequirements(value);
    assert.equal(calls(), 1);
  }
  delete value.destinationResearch.candidates[0].entryRequirements;
  await researchStudioCandidateEntryRequirements(value);
  assert.equal(calls(), 2);
});

test('entry freshness rejects expired, malformed and future-dated evidence, and invalidates all declared travel inputs', async () => {
  const value = workspace();
  value.destinationResearch = await researchStudioCandidateEntryRequirements(value, undefined, {
    researchEntry: async (current) => entry(current),
  });
  const card = value.destinationResearch.candidates[0];
  const checked = card.entryRequirements!;
  const now = Date.parse(checked.checkedAt);
  assert.equal(studioCandidateEntryFresh(value, card, now), true);
  assert.equal(
    studioCandidateEntryFresh(value, card, now + STUDIO_CANDIDATE_ENTRY_FRESH_MS),
    false,
  );
  assert.equal(studioCandidateEntryFresh(value, card, now - 1), false);
  checked.checkedAt = 'not-a-date';
  assert.equal(studioCandidateEntryFresh(value, card, now), false);
  checked.checkedAt = new Date(now).toISOString();
  for (const brief of [
    { passportNationality: 'PK' },
    { tripPurpose: 'business' as const },
    { startDate: '2027-04-01' },
    { endDate: '2027-04-05' },
    { datesFlexible: true },
    { departureDate: '2027-03-31' },
    { outboundTransport: 'cruise' as const },
    { returnTransport: 'flight' as const },
    { request: 'I will do paid work.' },
  ]) {
    const changed = structuredClone(value);
    Object.assign(changed.brief, brief);
    assert.equal(
      studioCandidateEntryFresh(changed, changed.destinationResearch!.candidates[0], now),
      false,
    );
  }
  const renamed = structuredClone(value);
  renamed.brief.clientName = 'New private name';
  renamed.brief.context = 'New private context';
  assert.equal(studioCandidateEntryInputKey(renamed, card), checked.inputKey);
});

test('passport and purpose-only edits retain the shortlist but remove its stale entry checks', () => {
  for (const brief of [
    { passportNationality: 'PK' },
    { tripPurpose: 'business' as const },
    { outboundTransport: 'cruise' as const },
    { request: 'I will do paid work.' },
  ]) {
    const value = workspace();
    value.destinationResearch!.candidates[0].entryRequirements = pendingStudioCandidateEntry(
      value,
      candidate(),
    );
    const originalInputKey = value.destinationResearch!.inputKey;
    applyStudioPatch(value, { revision: value.revision, brief }, defaultStudioAgency());
    assert.ok(value.destinationResearch);
    assert.equal(value.destinationResearch.inputKey, originalInputKey);
    assert.equal(value.destinationResearch.candidates[0].entryRequirements, undefined);
  }
  const value = workspace();
  applyStudioPatch(
    value,
    { revision: value.revision, brief: { startDate: '2027-04-01' } },
    defaultStudioAgency(),
  );
  assert.equal(value.destinationResearch, null);
});

test('full selected-route briefing never substitutes a conditional shortlist visa snapshot', async () => {
  const value = workspace();
  value.destinationResearch = await researchStudioCandidateEntryRequirements(value, undefined, {
    researchEntry: async (current) => entry(current),
  });
  Object.assign(value.brief, {
    preferredDestination: 'Kyoto',
    destinationCountry: 'JP',
    tripPurpose: 'business',
    startDate: '2027-04-01',
    endDate: '2027-04-05',
    outboundTransport: 'flight',
    returnTransport: 'flight',
  });
  let fullChecks = 0;
  const result = await researchStudioTripBriefing(value, undefined, {
    researchEntry: async (current) => {
      fullChecks++;
      return {
        ...entry(current),
        category: 'visa_required',
        summary: 'Full business-route check.',
      };
    },
    researchWeather: async () => ({
      kind: 'unavailable',
      checkedAt: stamp(),
      summary: 'Weather source unavailable.',
      days: [],
      sources: [],
    }),
  });
  assert.equal(fullChecks, 1);
  assert.equal(result.briefing.stops[0].entryRequirements?.category, 'visa_required');
  assert.equal(value.destinationResearch!.candidates[0].entryRequirements?.category, 'visa_free');
  assert.equal(value.entryRequirements!.length, 0);
});

test('checks are bounded to two concurrent providers and one failed card does not discard successful candidates', async () => {
  const value = workspace([candidate('Kyoto'), candidate('Tokyo'), candidate('Osaka')]);
  let active = 0,
    peak = 0,
    calls = 0;
  const result = await researchStudioCandidateEntryRequirements(value, undefined, {
    researchEntry: async (current) => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      active--;
      if (current.brief.preferredDestination === 'Tokyo') throw new Error('PRIVATE PROVIDER ERROR');
      return entry(current);
    },
  });
  assert.equal(peak, 2);
  assert.equal(calls, 3);
  assert.deepEqual(
    result.candidates.map((card) => card.entryRequirements?.status),
    ['preliminary', 'unavailable', 'preliminary'],
  );
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE PROVIDER ERROR/);
});

test('deadline failure stays unavailable, while explicit cancellation rejects the complete unsaved result', async () => {
  const value = workspace();
  const waitForAbort = async (current: StudioWorkspace, signal?: AbortSignal) => {
    await new Promise<void>((_resolve, reject) => {
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    return entry(current);
  };
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const result = await researchStudioCandidateEntryRequirements(value, undefined, {
      timeoutMs: 10,
      researchEntry: waitForAbort,
    });
    assert.equal(result.candidates[0].entryRequirements?.status, 'unavailable');
    const controller = new AbortController();
    const pending = researchStudioCandidateEntryRequirements(value, controller.signal, {
      researchEntry: waitForAbort,
    });
    controller.abort(new Error('User cancelled'));
    await assert.rejects(pending, /User cancelled/);
    assert.equal(value.destinationResearch!.candidates[0].entryRequirements, undefined);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('expired or future-dated shortlists are refused before provider work', async () => {
  for (const checkedAt of [
    'not-a-date',
    new Date(Date.now() - STUDIO_CANDIDATE_ENTRY_FRESH_MS).toISOString(),
    new Date(Date.now() + 5000).toISOString(),
  ]) {
    const value = workspace();
    value.destinationResearch!.checkedAt = checkedAt;
    assert.equal(studioDestinationResearchFresh(value.destinationResearch), false);
    await assert.rejects(
      researchStudioCandidateEntryRequirements(value),
      /Refresh destination suggestions/,
    );
  }
});

test('candidate entry API is owner-scoped, persists results and safely replays/reuses fresh checks', async () => {
  const { app, value, path } = await seed();
  const calls = mockEntry();
  const body = { revision: value.revision, requestId: randomUUID() };
  await request(app)
    .post(`${path}/destinations/entry-requirements`)
    .set('x-owner', 'bob')
    .send(body)
    .expect(404);
  assert.equal(calls(), 0);
  const first = (
    await request(app).post(`${path}/destinations/entry-requirements`).send(body).expect(200)
  ).body;
  assert.equal(calls(), 1);
  assert.equal(first.research.candidates[0].entryRequirements.status, 'preliminary');
  assert.equal(first.workspace.revision, value.revision + 1);
  assert.deepEqual(first.workspace.stops, []);
  assert.deepEqual(first.workspace.entryRequirements, []);
  const reused = (
    await request(app)
      .post(`${path}/destinations/entry-requirements`)
      .send({ revision: first.workspace.revision, requestId: randomUUID() })
      .expect(200)
  ).body;
  assert.equal(reused.workspace.revision, first.workspace.revision);
  assert.equal(calls(), 1);
  const replay = (
    await request(app).post(`${path}/destinations/entry-requirements`).send(body).expect(200)
  ).body;
  assert.equal(replay.replayed, true);
  assert.equal(calls(), 1);
  await request(app)
    .post(`${path}/destinations/entry-requirements`)
    .send({ ...body, revision: first.workspace.revision })
    .expect(409);
});

test('candidate entry API merges only research after unrelated concurrent title edits', async () => {
  const { app, value, path } = await seed();
  const model = gatedEntry();
  const pending = request(app)
    .post(`${path}/destinations/entry-requirements`)
    .send({ revision: value.revision, requestId: randomUUID() })
    .then((result) => result);
  await model.started;
  const edited = (
    await request(app)
      .patch(path)
      .send({ revision: value.revision, title: 'Changed during research' })
      .expect(200)
  ).body.workspace;
  model.release();
  const result = await pending;
  assert.equal(result.status, 200);
  assert.equal(result.body.workspace.title, edited.title);
  assert.equal(result.body.workspace.revision, edited.revision + 1);
  assert.equal(result.body.workspace.brief.passportNationality, 'AU');
});

test('changing the declared passport cancels old guidance and preserves the new passport and existing shortlist', async () => {
  const { app, store, value, path } = await seed();
  const model = gatedEntry();
  const pending = request(app)
    .post(`${path}/destinations/entry-requirements`)
    .send({ revision: value.revision, requestId: randomUUID() })
    .then((result) => result);
  await model.started;
  const edited = (
    await request(app)
      .patch(path)
      .send({ revision: value.revision, brief: { passportNationality: 'PK' } })
      .expect(200)
  ).body.workspace;
  model.release();
  const result = await pending;
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'STUDIO_RESEARCH_STALE');
  const current = store.require('alice', value.id);
  assert.equal(current.revision, edited.revision);
  assert.equal(current.brief.passportNationality, 'PK');
  assert.ok(current.destinationResearch);
  assert.equal(current.destinationResearch.candidates[0].entryRequirements, undefined);
  const replayBody = { revision: current.revision, requestId: randomUUID() };
  mockEntry();
  await request(app).post(`${path}/destinations/entry-requirements`).send(replayBody).expect(200);
});

test('editing the linked profile passport rejects in-flight guidance without replacing the explicit trip passport', async () => {
  const { app, store, value, path, client } = await seed({
    name: 'PRIVATE NAME',
    country: 'AU',
    nationality: 'AU',
    passportNationality: 'AU',
  } as StudioClientProfile);
  const model = gatedEntry();
  const pending = request(app)
    .post(`${path}/destinations/entry-requirements`)
    .send({ revision: value.revision, requestId: randomUUID() })
    .then((result) => result);
  await model.started;
  await request(app)
    .patch(`/api/studio/client-profiles/${client!.id}`)
    .send({ name: 'PRIVATE NAME', country: 'AU', nationality: 'AU', passportNationality: 'PK' })
    .expect(200);
  model.release();
  const result = await pending;
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'STUDIO_RESEARCH_STALE');
  assert.equal(store.require('alice', value.id).brief.passportNationality, 'AU');
});

test('owner/workspace/input-identical requests share one provider job even when request IDs differ', async () => {
  const { app, value, path } = await seed();
  const model = gatedEntry();
  const run = () =>
    request(app)
      .post(`${path}/destinations/entry-requirements`)
      .send({ revision: value.revision, requestId: randomUUID() })
      .then((result) => result);
  const first = run();
  await model.started;
  const second = run();
  await new Promise<void>((resolve) => setTimeout(resolve, 15));
  assert.equal(model.calls(), 1);
  model.release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(
    results.map((result) => result.status),
    [200, 200],
  );
  assert.equal(results[0].body.workspace.revision, results[1].body.workspace.revision);
});

test('disconnecting the final entry-check caller aborts the provider and leaves saved data unchanged', async () => {
  const { app, store, value, path } = await seed();
  const server = app.listen(0);
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const model = gatedEntry();
  const pending = request(server)
    .post(`${path}/destinations/entry-requirements`)
    .send({ revision: value.revision, requestId: randomUUID() });
  const completion = pending.then(
    () => undefined,
    () => undefined,
  );
  await model.started;
  pending.abort();
  await completion;
  for (let attempt = 0; attempt < 20 && !model.aborted(); attempt++)
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  assert.equal(model.aborted(), true);
  assert.equal(store.require('alice', value.id).revision, value.revision);
  assert.equal(
    store.require('alice', value.id).destinationResearch!.candidates[0].entryRequirements,
    undefined,
  );
});

test('selected route changes reject candidate advice rather than treating it as full-route visa coverage', async () => {
  const { app, store, value, path } = await seed();
  const model = gatedEntry();
  const pending = request(app)
    .post(`${path}/destinations/entry-requirements`)
    .send({ revision: value.revision, requestId: randomUUID() })
    .then((result) => result);
  await model.started;
  const edited = (
    await request(app)
      .patch(path)
      .send({
        revision: value.revision,
        stops: [
          {
            id: 'tokyo',
            name: 'Tokyo',
            country: 'JP',
            nights: 3,
            arrivalDate: '',
            departureDate: '',
            onwardTransport: 'undecided',
            neighbourhood: '',
            notes: '',
          },
        ],
      })
      .expect(200)
  ).body.workspace;
  model.release();
  const result = await pending;
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'STUDIO_RESEARCH_STALE');
  assert.equal(store.require('alice', value.id).revision, edited.revision);
  assert.equal(store.require('alice', value.id).destinationResearch, null);
});

test('API documentation exposes conditional, missing-fact, source and freshness semantics', () => {
  assert.ok(studioPaths['/api/studio/workspaces/{id}/destinations/entry-requirements']);
  const schema = studioSchemas.StudioCandidateEntryRequirements as {
    properties: Record<string, unknown>;
  };
  for (const field of [
    'scope',
    'passportCountryCode',
    'status',
    'category',
    'sources',
    'missingFacts',
    'inputKey',
  ])
    assert.ok(schema.properties[field]);
});

test('conversation and research limits are independent and scoped to owners sharing an office IP', async () => {
  const { app, value, path } = await seed();
  const calls = mockEntry();
  let current = value;
  // Research requests from Alice cannot consume her conversation budget or Bob's.
  for (let index = 0; index < 15; index++)
    current = (
      await request(app)
        .post(`${path}/destinations/entry-requirements`)
        .send({ revision: current.revision, requestId: randomUUID() })
        .expect(200)
    ).body.workspace;
  await request(app)
    .post(`${path}/destinations/entry-requirements`)
    .send({ revision: current.revision, requestId: randomUUID() })
    .expect(429);
  assert.equal(calls(), 1);
  delete process.env.OPENAI_API_KEY;
  for (let index = 0; index < 20; index++)
    current = (
      await request(app)
        .post(`${path}/review`)
        .send({ revision: current.revision, requestId: randomUUID(), message: 'hi' })
        .expect(200)
    ).body.workspace;
  await request(app)
    .post(`${path}/review`)
    .send({ revision: current.revision, requestId: randomUUID(), message: 'hi' })
    .expect(429);
  const bob: StudioWorkspace = (
    await request(app).post('/api/studio/workspaces').set('x-owner', 'bob').send({}).expect(201)
  ).body.workspace;
  await request(app)
    .post(`/api/studio/workspaces/${bob.id}/review`)
    .set('x-owner', 'bob')
    .send({ revision: bob.revision, requestId: randomUUID(), message: 'hi' })
    .expect(200);
  // Alice's exhausted research bucket does not block Bob's owned research endpoint.
  await request(app)
    .post(`/api/studio/workspaces/${bob.id}/destinations/entry-requirements`)
    .set('x-owner', 'bob')
    .send({ revision: bob.revision + 1, requestId: randomUUID() })
    .expect(409);
});
