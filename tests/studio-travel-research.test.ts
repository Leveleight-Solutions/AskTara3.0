import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioTravelResearch } from '../src/components/StudioTravelResearch.tsx';
import {
  checkStudioEntryRequirements,
  researchStudioDestinations,
  verifyStudioAdvisory,
} from '../server/studio-travel-research.ts';
import { newStudioWorkspace, StudioError } from '../server/studio-store.ts';
import { normalizeStudioCountry, studioCountries } from '../shared/studio-travel-research.ts';

const originalFetch = globalThis.fetch;
const envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.OPENAI_API_KEY = 'unit-test-travel-research';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => assert.fail('Unexpected external request');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of envNames)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});
const today = () => new Date().toISOString();
const advisoryUrl = 'https://www.gov.uk/foreign-travel-advice/japan';
const conditionsUrl = 'https://www.jma.go.jp/jma/en/Activities/earthquake.html';
const officialVisaUrl = 'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html';
const indexUrl = 'https://www.passportindex.org/passport/pakistan/';
function workspace() {
  const value = newStudioWorkspace();
  Object.assign(value.brief, {
    passportNationality: 'PK',
    tripPurpose: 'tourism',
    preferredDestination: 'Tokyo',
    destinationCountry: 'JP',
  });
  value.brief.startDate = '2027-04-01';
  value.brief.endDate = '2027-04-10';
  value.brief.clientName = 'Private Client Name';
  value.brief.context = 'PRIVATE PROFILE CONTEXT';
  return value;
}
function candidate(overrides: Record<string, unknown> = {}) {
  return {
    destination: 'Tokyo',
    countryCode: 'JP',
    reason: 'An option for culture and food interests.',
    suggestedDays: 8,
    thingsToDo: ['Explore public gardens'],
    conditions: 'Check local earthquake notices.',
    seasonalGuidance: 'Spring is usually mild; this is not a forecast.',
    currentDisruption: false,
    conditionsVerified: true,
    advisoryUrl,
    sources: [{ url: conditionsUrl, publishedAt: today() }],
    ...overrides,
  };
}
function advice(alerts: string[] = [], country = 'Japan') {
  return {
    document_type: 'travel_advice',
    public_updated_at: today(),
    withdrawn_notice: {},
    details: {
      country: { name: country, slug: country.toLowerCase() },
      alert_status: alerts,
      summary: '<p>Read current local guidance before travel.</p>',
      reviewed_at: today(),
    },
  };
}
function response(data: unknown, urls: string[]) {
  return Response.json({
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: { sources: urls.map((url) => ({ url, title: 'Test evidence' })) },
      },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
    ],
  });
}
function mockDestinations(
  candidates = [candidate()],
  official: unknown = advice(),
  inspect?: (body: Record<string, any>) => void,
) {
  globalThis.fetch = async (input, init) => {
    if (String(input) === 'https://api.openai.com/v1/responses') {
      const body = JSON.parse(String(init?.body));
      inspect?.(body);
      return response({ candidates, notes: [] }, [
        advisoryUrl,
        conditionsUrl,
        ...candidates.map((item) => item.advisoryUrl),
      ]);
    }
    assert.match(
      String(input),
      /^https:\/\/www\.gov\.uk\/api\/content\/foreign-travel-advice\/[a-z-]+$/,
    );
    assert.equal(init?.redirect, 'error');
    return Response.json(official);
  };
}
function observation(
  kind = 'official_immigration',
  category = 'visa_required',
  sourceUrl = officialVisaUrl,
) {
  return {
    category,
    summary: 'Tourist visa required for the declared passport.',
    sourceUrl,
    kind,
    passportCountryCode: 'PK',
    destinationCountryCode: 'JP',
    publishedAt: today(),
    appliesToTrip: true,
  };
}
function entry(observations = [observation()]) {
  return {
    passportCountryCode: 'PK',
    destinationCountryCode: 'JP',
    summary: 'An application before departure is required.',
    conditions: ['Confirm permitted stay with the embassy.'],
    electronicAuthorisation: 'No separate authorisation established.',
    observations,
    notes: [],
  };
}
function mockEntry(
  data = entry(),
  urls = [officialVisaUrl, indexUrl],
  inspect?: (body: Record<string, any>) => void,
) {
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.openai.com/v1/responses');
    inspect?.(JSON.parse(String(init?.body)));
    return response(data, urls);
  };
}

test('country normalization covers ISO countries and territories globally without accepting cities as nationalities', () => {
  assert.equal(studioCountries.length, 250);
  for (const [input, code] of [
    ['São Tomé & Príncipe', 'ST'],
    ['Timor-Leste', 'TL'],
    ['Côte d’Ivoire', 'CI'],
    ['UK', 'GB'],
    ['Pakistan', 'PK'],
    ['Turkey', 'TR'],
    ['Russian Federation', 'RU'],
    ['Kosovo', 'XK'],
  ])
    assert.equal(normalizeStudioCountry(input)?.code, code);
  assert.equal(normalizeStudioCountry('Moscow'), undefined);
  assert.equal(normalizeStudioCountry('Pakistani passport 1234567'), undefined);
});

test('destination research checks official advice independently, uses returning history and excludes client identities/photos', async () => {
  const value = workspace();
  const before = structuredClone(value);
  const history = [
    {
      destination: 'Kyoto',
      country: 'Japan',
      visitedAt: '2024-03-01',
      interests: ['gardens'],
      photoDataUrl: 'data:image/png;base64,PRIVATE_PHOTO',
      dateOfBirth: '1990-02-04',
      feedback: 'disliked' as const,
      experience: 'planned' as const,
      notes: 'Too many crowded stops',
      name: 'PRIVATE_NAME',
    },
  ];
  mockDestinations([candidate()], advice(), (body) => {
    assert.equal(body.tools[0].type, 'web_search');
    assert.equal(body.tool_choice, 'required');
    assert.equal(body.store, false);
    const payload = JSON.parse(body.input[0].content);
    assert.equal(payload.travelHistory[0].destination, 'Kyoto');
    assert.equal(payload.travelHistory[0].feedback, 'disliked');
    assert.equal(payload.travelHistory[0].experience, 'planned');
    assert.equal(payload.travelHistory[0].notes, 'Too many crowded stops');
    assert.equal(payload.trip.preferredDestination, 'Tokyo');
    assert.doesNotMatch(
      body.input[0].content,
      /PRIVATE_|Private Client|photoDataUrl|dateOfBirth|1990-02-04|clientName|passportNumber/,
    );
  });
  const result = await researchStudioDestinations(value, history);
  assert.equal(result.historyUsed, true);
  assert.equal(result.candidates[0].recommendable, true);
  assert.equal(result.candidates[0].status, 'checked');
  assert.equal(result.candidates[0].sources[0].kind, 'advisory');
  assert.equal(result.candidates[0].sources[0].url, advisoryUrl);
  assert.deepEqual(value, before);
});

test('Russia is blocked by official alerts even when AI candidate claims no disruption', async () => {
  mockDestinations(
    [
      candidate({
        destination: 'Moscow',
        countryCode: 'RU',
        advisoryUrl: 'https://www.gov.uk/foreign-travel-advice/russia',
      }),
    ],
    advice(['avoid_all_travel_to_whole_country'], 'Russia'),
  );
  const result = await researchStudioDestinations(workspace());
  assert.equal(result.candidates[0].recommendable, false);
  assert.equal(result.candidates[0].status, 'blocked');
  assert.match(result.candidates[0].advisory, /against all travel/);
});

test('direct advisory verification accepts an empty active notice and rejects a real withdrawal', async () => {
  const base = advice(['avoid_all_travel_to_whole_country'], 'Russia');
  const { summary: _legacy, ...details } = base.details;
  const actualShape = {
    ...base,
    details: {
      ...details,
      parts: [
        {
          title: 'Warnings and insurance',
          slug: 'warnings-and-insurance',
          body: '<h2>FCDO advises against all travel to Russia</h2>',
        },
      ],
    },
  };
  globalThis.fetch = async (input) => {
    assert.equal(String(input), 'https://www.gov.uk/api/content/foreign-travel-advice/russia');
    return Response.json(actualShape);
  };
  const active = await verifyStudioAdvisory(
    'https://www.gov.uk/foreign-travel-advice/russia',
    'RU',
  );
  assert.equal(active.status, 'blocked');
  assert.match(active.summary, /against all travel/);
  assert.equal(active.source?.kind, 'advisory');

  globalThis.fetch = async () =>
    Response.json({ ...actualShape, withdrawn_notice: { explanation: 'Archived advice' } });
  const withdrawn = await verifyStudioAdvisory(
    'https://www.gov.uk/foreign-travel-advice/russia',
    'RU',
  );
  assert.equal(withdrawn.status, 'unknown');
  assert.equal(withdrawn.source, undefined);
});

test('current FCDO multipart responses work without the legacy summary property', async () => {
  const { summary: _legacy, ...details } = advice().details;
  const actualShape = {
    ...advice(),
    details: {
      ...details,
      parts: [
        {
          title: 'Warnings and insurance',
          slug: 'warnings-and-insurance',
          body: '<p>Read the current advice and prepare for local conditions.</p>',
        },
        {
          title: 'Entry requirements',
          slug: 'entry-requirements',
          body: '<p>Check entry requirements.</p>',
        },
      ],
    },
  };
  mockDestinations([candidate()], actualShape);
  const result = await researchStudioDestinations(workspace());
  assert.equal(result.candidates[0].status, 'checked');
  assert.equal(result.candidates[0].recommendable, true);
  assert.equal(result.candidates[0].sources[0].kind, 'advisory');
});

test('Russia multipart alert blocks travel even when summary and body are absent', async () => {
  const { summary: _legacy, ...details } = advice(
    ['avoid_all_travel_to_whole_country'],
    'Russia',
  ).details;
  const moscow = candidate({
    destination: 'Moscow',
    countryCode: 'RU',
    advisoryUrl: 'https://www.gov.uk/foreign-travel-advice/russia',
  });
  for (const parts of [
    [],
    [
      {
        title: 'Warnings and insurance',
        slug: 'warnings-and-insurance',
        body: '<h2>FCDO advises against all travel to Russia</h2>',
      },
    ],
  ]) {
    mockDestinations([moscow], { ...advice(), details: { ...details, parts } });
    const result = await researchStudioDestinations(workspace());
    assert.equal(result.candidates[0].status, 'blocked');
    assert.equal(result.candidates[0].recommendable, false);
    assert.match(result.candidates[0].advisory, /against all travel/);
  }
});

test('an empty alert list still requires an overview body before favourable advice', async () => {
  const { summary: _legacy, ...details } = advice().details;
  mockDestinations([candidate()], { ...advice(), details: { ...details, parts: [] } });
  const result = await researchStudioDestinations(workspace());
  assert.equal(result.candidates[0].status, 'unknown');
  assert.equal(result.candidates[0].recommendable, false);
});

test('essential travel and regional alerts remain warnings, with no favourable automated recommendation', async () => {
  for (const [alert, status] of [
    ['avoid_all_but_essential_travel_to_whole_country', 'blocked'],
    ['avoid_all_travel_to_parts', 'warning'],
    ['new_unknown_alert_value', 'warning'],
  ]) {
    mockDestinations([candidate()], advice([alert]));
    const result = await researchStudioDestinations(workspace());
    assert.equal(result.candidates[0].status, status);
    assert.equal(result.candidates[0].recommendable, false);
  }
});

test('missing official advice, wrong country and malformed schemas fail closed without blocking the research response', async () => {
  for (const official of [
    {},
    advice([], 'Russia'),
    { ...advice(), withdrawn_notice: { explanation: 'Archived' } },
  ]) {
    mockDestinations([candidate()], official);
    const result = await researchStudioDestinations(workspace());
    assert.equal(result.candidates[0].status, 'unknown');
    assert.equal(result.candidates[0].recommendable, false);
  }
});

test('old local conditions, absent source dates and significant current disruptions cannot produce a favourable recommendation', async () => {
  for (const changes of [
    { sources: [{ url: conditionsUrl, publishedAt: '2020-01-01' }] },
    { sources: [{ url: conditionsUrl, publishedAt: '' }] },
    { currentDisruption: true },
    { conditionsVerified: false },
  ]) {
    mockDestinations([candidate(changes)]);
    const result = await researchStudioDestinations(workspace());
    assert.equal(result.candidates[0].recommendable, false);
  }
});

test('invented evidence and unsupported safety guarantees are rejected', async () => {
  mockDestinations([
    candidate({ sources: [{ url: 'https://invented.example/claim', publishedAt: today() }] }),
  ]);
  await assert.rejects(researchStudioDestinations(workspace()), /not found in the current search/);
  mockDestinations([candidate({ reason: 'A completely safe destination.' })]);
  await assert.rejects(researchStudioDestinations(workspace()), /unsupported safety/);
});

test('provider-added inline citations are verified and removed before enforcing compact activity text', async () => {
  const short = 'Explore the public gardens and museum collections.';
  const cited = `${short} ([Official destination conditions and current visitor information](${conditionsUrl}?utm_source=openai))`;
  assert.ok(cited.length > 140);
  mockDestinations([
    candidate({
      thingsToDo: [cited],
      reason: `Consider the gardens. ([Official evidence](${conditionsUrl}))`,
    }),
  ]);
  const result = await researchStudioDestinations(workspace());
  assert.deepEqual(result.candidates[0].thingsToDo, [short]);
  assert.equal(result.candidates[0].reason, 'Consider the gardens.');
  assert.ok(result.candidates[0].sources.some((source) => source.url === conditionsUrl));
});

test('long citation-bearing prose does not bypass source provenance or plain-text length limits', async () => {
  mockDestinations([
    candidate({
      thingsToDo: ['Explore the gardens. ([Unverified](https://unverified.example/claim))'],
    }),
  ]);
  await assert.rejects(researchStudioDestinations(workspace()), /inline citation.*not found/);
  mockDestinations([candidate({ thingsToDo: ['A'.repeat(141)] })]);
  await assert.rejects(researchStudioDestinations(workspace()), /overly long descriptive text/);
});

test('official advice fetch is confined to a trusted canonical origin with no redirected requests', async () => {
  const candidates = [
    candidate({ advisoryUrl: 'https://www.gov.uk.evil.example/foreign-travel-advice/japan' }),
  ];
  mockDestinations(candidates);
  const result = await researchStudioDestinations(workspace());
  assert.equal(result.candidates[0].status, 'unknown');
});

test('visa checks refuse missing nationality or unselected destination before touching a provider', async () => {
  const value = workspace();
  Object.assign(value.brief, { passportNationality: '' });
  await assert.rejects(
    checkStudioEntryRequirements(value),
    (error: unknown) => error instanceof StudioError && error.status === 400,
  );
  Object.assign(value.brief, {
    passportNationality: 'PK',
    preferredDestination: '',
    destinationCountry: '',
  });
  await assert.rejects(checkStudioEntryRequirements(value), /Choose a destination/);
});

test('visa checks use only declared nationality and selected destination and corroborate official evidence', async () => {
  const value = workspace();
  value.brief.origin = 'London';
  mockEntry(
    entry([observation(), observation('index', 'visa_required', indexUrl)]),
    undefined,
    (body) => {
      const payload = JSON.parse(body.input[0].content);
      assert.equal(payload.trip.passportCountryCode, 'PK');
      assert.equal(payload.trip.destinationCountryCode, 'JP');
      assert.equal(payload.trip.destination, 'Tokyo');
      assert.doesNotMatch(
        body.input[0].content,
        /London|PRIVATE_|Private Client|photo|passportNumber/,
      );
    },
  );
  const result = await checkStudioEntryRequirements(value);
  assert.equal(result.status, 'corroborated');
  assert.equal(result.category, 'visa_required');
  assert.equal(result.sources.length, 2);
  assert.equal(result.passportCountry, 'Pakistan');
});

test('index and official disagreement remains explicitly unknown and retains both statements', async () => {
  mockEntry(entry([observation(), observation('index', 'visa_on_arrival', indexUrl)]));
  const result = await checkStudioEntryRequirements(workspace());
  assert.equal(result.status, 'conflicting');
  assert.equal(result.category, 'unknown');
  assert.equal(result.observations.length, 2);
});

test('index alone, wrongly labelled commercial source and unknown trip applicability remain unverified', async () => {
  for (const observations of [
    [observation('index', 'visa_free', indexUrl)],
    [observation('official_immigration', 'visa_free', 'https://visa-service.example/application')],
    [{ ...observation(), appliesToTrip: false }],
  ]) {
    mockEntry(
      entry(observations),
      observations.map((item) => item.sourceUrl),
    );
    const result = await checkStudioEntryRequirements(workspace());
    assert.equal(result.status, 'unverified');
    assert.equal(result.category, 'unknown');
  }
});

test('visa research refuses wrong-nationality output and unsearched official citations', async () => {
  mockEntry({ ...entry(), passportCountryCode: 'GB' });
  await assert.rejects(checkStudioEntryRequirements(workspace()), /changed the selected passport/);
  mockEntry(entry(), [indexUrl]);
  await assert.rejects(
    checkStudioEntryRequirements(workspace()),
    /not found in the current search/,
  );
});

test('a multi-destination entry check targets the chosen stop only and preserves exact checked identity', async () => {
  const value = workspace();
  value.stops = [
    {
      id: 'kyoto',
      name: 'Kyoto',
      country: 'JP',
      nights: 3,
      arrivalDate: '2027-04-07',
      departureDate: '2027-04-10',
      onwardTransport: 'train',
      neighbourhood: '',
      notes: '',
    },
  ];
  mockEntry(entry(), undefined, (body) => {
    const trip = JSON.parse(body.input[0].content).trip;
    assert.equal(trip.destination, 'Kyoto');
    assert.equal(trip.startDate, '2027-04-07');
  });
  const result = await checkStudioEntryRequirements(value, undefined, 'kyoto');
  assert.equal(result.stopId, 'kyoto');
  assert.equal(result.destination, 'Kyoto');
  await assert.rejects(
    checkStudioEntryRequirements(value, undefined, 'missing'),
    /existing route stop/,
  );
});

test('cancellation propagates instead of downgrading it to an advisory warning', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(researchStudioDestinations(workspace(), [], controller.signal), /abort/i);
  await assert.rejects(checkStudioEntryRequirements(workspace(), controller.signal), /abort/i);
});

test('entry panel shows the default first route stop result instead of the most recently checked different country', async () => {
  const value = workspace();
  value.stops = [
    {
      id: 'tokyo',
      name: 'Tokyo',
      country: 'JP',
      nights: 3,
      arrivalDate: value.brief.startDate,
      departureDate: '2027-04-04',
      onwardTransport: 'flight',
      neighbourhood: '',
      notes: '',
    },
    {
      id: 'seoul',
      name: 'Seoul',
      country: 'KR',
      nights: 6,
      arrivalDate: '2027-04-04',
      departureDate: value.brief.endDate,
      onwardTransport: 'flight',
      neighbourhood: '',
      notes: '',
    },
  ];
  mockEntry();
  const first = await checkStudioEntryRequirements(value, undefined, 'tokyo');
  first.summary = 'FIRST_STOP_REQUIREMENTS';
  const other = {
    ...first,
    stopId: 'seoul',
    destination: 'Seoul',
    destinationCountry: 'South Korea',
    destinationCountryCode: 'KR',
    summary: 'SECOND_STOP_REQUIREMENTS',
  };
  const html = renderToStaticMarkup(
    createElement(StudioTravelResearch, {
      workspace: value,
      entryResults: [first, other],
      onResearch() {},
      onCheckEntry() {},
      onChooseDestination() {},
    }),
  );
  assert.match(html, /FIRST_STOP_REQUIREMENTS/);
  assert.doesNotMatch(html, /SECOND_STOP_REQUIREMENTS/);
});

test('warned destinations cannot be selected from the panel before an explicit acknowledgement', async () => {
  mockDestinations(
    [
      candidate({
        destination: 'Moscow',
        countryCode: 'RU',
        advisoryUrl: 'https://www.gov.uk/foreign-travel-advice/russia',
      }),
    ],
    advice(['avoid_all_travel_to_whole_country'], 'Russia'),
  );
  const value = workspace();
  const research = await researchStudioDestinations(value);
  const html = renderToStaticMarkup(
    createElement(StudioTravelResearch, {
      workspace: value,
      research,
      onResearch() {},
      onCheckEntry() {},
      onChooseDestination() {},
    }),
  );
  assert.match(html, /Travel warning/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /<button[^>]*disabled[^>]*>Choose with warning<\/button>/);
  assert.doesNotMatch(html, /Let’s go/);
});
