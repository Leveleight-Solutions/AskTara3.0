import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { destinations } from '../shared/catalog.ts';
import type { StudioItem, StudioStop } from '../shared/studio.ts';
import { newStudioWorkspace, StudioError } from '../server/studio-store.ts';
import { studioHotelDestination, studioRecommendations } from '../server/studio-models.ts';

const originalFetch = globalThis.fetch;
const environmentKeys = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let previousEnvironment: Record<string, string | undefined>;
beforeEach(() => {
  previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  process.env.OPENAI_API_KEY = 'unit-test-only-key';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => {
    throw new Error('Unexpected external request in a unit test.');
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of environmentKeys)
    previousEnvironment[key] === undefined
      ? delete process.env[key]
      : (process.env[key] = previousEnvironment[key]);
});

const visitorUrl = 'https://visitor-guide.example/river-park';
const source = { url: visitorUrl, title: 'Official visitor information' };
// OpenAI Structured Outputs accepts this subset of JSON Schema string formats;
// Zod's URL format ("uri") must stay in our runtime evidence checks instead.
function assertSupportedResponseFormats(schema: unknown) {
  const formats = new Set([
    'date-time',
    'time',
    'date',
    'duration',
    'email',
    'hostname',
    'ipv4',
    'ipv6',
    'uuid',
  ]);
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    if ('format' in value)
      assert.ok(
        formats.has(String(value.format)),
        `Unsupported response schema format: ${String(value.format)}`,
      );
    for (const child of Object.values(value)) visit(child);
  }
  visit(schema);
}
function modelResponse(data: unknown, sources = [source], searchCompleted = true) {
  return Response.json({
    status: 'completed',
    output: [
      ...(searchCompleted
        ? [{ type: 'web_search_call', status: 'completed', action: { sources } }]
        : []),
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
    ],
  });
}
function stop(overrides: Partial<StudioStop> = {}): StudioStop {
  return {
    id: 'route-stop',
    name: 'Wānaka',
    country: 'New Zealand',
    nights: 4,
    arrivalDate: '2027-11-18',
    departureDate: '2027-11-22',
    onwardTransport: 'undecided',
    neighbourhood: 'Near the lake',
    notes: '',
    ...overrides,
  };
}
function workspace() {
  const value = newStudioWorkspace();
  value.structureAccepted = true;
  value.stops = [stop()];
  value.brief.context =
    'The client is recovering from a confidential procedure. They previously travelled with a different party.';
  value.brief.requirements = ['Vegetarian dining', 'Step-free access'];
  return value;
}
function recommendation(
  overrides: Partial<{
    stopId: string;
    name: string;
    description: string;
    sourceUrls: string[];
  }> = {},
) {
  return {
    stopId: 'route-stop',
    name: 'A lakeside park',
    description:
      'An optional lakeside walk. Check the current step-free access details with the operator.',
    sourceUrls: [visitorUrl],
    ...overrides,
  };
}
const privateError = (error: unknown) =>
  error instanceof StudioError &&
  error.status === 502 &&
  /private client context/.test(error.message);
const unresolvedError = (error: unknown) =>
  error instanceof StudioError &&
  error.status === 400 &&
  /Confirm the destination city and country/.test(error.message);

test('recommendations require an accepted route and selected route IDs before making a model request', async () => {
  const value = workspace();
  value.structureAccepted = false;
  await assert.rejects(
    studioRecommendations(value, ['route-stop'], 'activity', ''),
    (error: unknown) => error instanceof StudioError && error.status === 409,
  );
  value.structureAccepted = true;
  await assert.rejects(
    studioRecommendations(value, ['unknown-stop'], 'activity', ''),
    (error: unknown) => error instanceof StudioError && error.status === 400,
  );
  await assert.rejects(
    studioRecommendations(value, [], 'food', ''),
    (error: unknown) => error instanceof StudioError && error.status === 400,
  );
});

test('sourced recommendations use web research, remain unselected and do not mutate the saved workspace', async () => {
  const value = workspace(),
    original = structuredClone(value);
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'gpt-6-astra');
    assert.equal(body.text.format.name, 'studio_destination_recommendations');
    assertSupportedResponseFormats(body.text.format.schema);
    assert.deepEqual(body.tools, [{ type: 'web_search', external_web_access: true }]);
    assert.equal(body.tool_choice, 'required');
    return modelResponse({
      recommendations: [
        recommendation({ sourceUrls: [visitorUrl, `${visitorUrl}?utm_source=demo`] }),
      ],
    });
  };
  const results = await studioRecommendations(
    value,
    ['route-stop'],
    'food',
    'Vegetarian food near the lake',
  );
  assert.equal(calls, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].included, false);
  assert.equal(results[0].category, 'food');
  assert.equal(results[0].stopId, 'route-stop');
  assert.equal(results[0].sources.length, 1);
  assert.equal(results[0].sources[0].url, visitorUrl);
  assert.equal(results[0].sources[0].label, source.title);
  assert.ok(Number.isFinite(Date.parse(results[0].sources[0].checkedAt)));
  assert.deepEqual(value, original);
});

test('a claimed citation without an actual web-search result is rejected', async () => {
  globalThis.fetch = async () =>
    modelResponse({ recommendations: [recommendation()] }, [source], false);
  await assert.rejects(
    studioRecommendations(workspace(), ['route-stop'], 'activity', ''),
    /web search|web research|search/i,
  );
});

test('recommendations reject unverified source fields and links hidden in prose while allowing searched prose links', async () => {
  const unverified = 'https://unverified.example/booking';
  for (const rec of [
    recommendation({ sourceUrls: [unverified] }),
    recommendation({ description: `Read more at ${unverified}.` }),
    recommendation({ name: `A lakeside park ${unverified}` }),
  ]) {
    globalThis.fetch = async () => modelResponse({ recommendations: [rec] });
    await assert.rejects(
      studioRecommendations(workspace(), ['route-stop'], 'activity', ''),
      (error: unknown) =>
        error instanceof StudioError &&
        error.status === 502 &&
        /unverified source/.test(error.message),
    );
  }
  globalThis.fetch = async () =>
    modelResponse({
      recommendations: [
        recommendation({ description: `Check the official guide at ${visitorUrl}.` }),
      ],
    });
  assert.equal(
    (await studioRecommendations(workspace(), ['route-stop'], 'activity', ''))[0].sources[0].url,
    visitorUrl,
  );
});

test('bounded model URL strings still reject unsafe or malformed citations at runtime', async () => {
  for (const url of [
    'javascript:alert(1)',
    'file:///private/client-data',
    'not a URL',
    'https://user:password@vendor.example/guide',
  ]) {
    globalThis.fetch = async () =>
      modelResponse({ recommendations: [recommendation({ sourceUrls: [url] })] });
    await assert.rejects(
      studioRecommendations(workspace(), ['route-stop'], 'activity', ''),
      (error: unknown) =>
        error instanceof StudioError &&
        error.status === 502 &&
        /unverified source/.test(error.message),
    );
  }
});

test('recommendations reject copied private context, known booking references and contact identifiers', async () => {
  const value = workspace();
  const privateItem: StudioItem = {
    id: 'private-item',
    kind: 'hotel',
    title: 'Reviewed hotel',
    description: '',
    stopId: 'route-stop',
    startDate: '',
    endDate: '',
    status: 'suggested',
    source: 'manual',
    sourceUrl: '',
    supplier: '',
    privateReference: 'ZXCV99',
    price: null,
    currency: 'AUD',
    priceStatus: 'unpriced',
    quotedAt: '',
    included: false,
    needsReview: true,
    cost: null,
  };
  value.items = [privateItem];
  for (const description of [
    'The Client Is Recovering From A Confidential Procedure, so this is an appropriate option.',
    'This recommendation is related to booking ZXCV99.',
    'Send the plan to fictional-client@example.com.',
    'Medical history: a confidential condition.',
    'Passport number: EXAMPLE1234.',
    'Booking reference: ANYREF77.',
    'PNR: ABC123.',
  ]) {
    globalThis.fetch = async () =>
      modelResponse({ recommendations: [recommendation({ description })] });
    await assert.rejects(
      studioRecommendations(value, ['route-stop'], 'activity', ''),
      privateError,
      description,
    );
  }
  globalThis.fetch = async () =>
    modelResponse({
      recommendations: [recommendation({ name: 'Client fictional-client@example.com' })],
    });
  await assert.rejects(studioRecommendations(value, ['route-stop'], 'activity', ''), privateError);
});

test('labelled phone details are kept out of recommendations without rejecting ordinary dates or venue addresses', async () => {
  for (const description of [
    'Phone: +61 400 123 456',
    'Mobile: 0400 123 456',
    'Tel: +64 21 123 4567',
    'Contact: +61 2 1234 5678',
  ]) {
    globalThis.fetch = async () =>
      modelResponse({ recommendations: [recommendation({ description })] });
    await assert.rejects(
      studioRecommendations(workspace(), ['route-stop'], 'activity', ''),
      privateError,
      description,
    );
  }
  globalThis.fetch = async () =>
    modelResponse({
      recommendations: [
        recommendation({
          description:
            'The visitor centre is at 123 Lake Road. Confirm arrangements for 18 November 2027.',
        }),
      ],
    });
  assert.equal(
    (await studioRecommendations(workspace(), ['route-stop'], 'activity', '')).length,
    1,
  );
});

test('recommendations reject unsupported guarantees, unrelated destinations and more than four options per stop', async () => {
  for (const [recommendations, pattern] of [
    [
      [
        recommendation({
          description: 'This venue is fully accessible and guaranteed allergy-safe.',
        }),
      ],
      /unsupported suitability/,
    ],
    [[recommendation({ stopId: 'other-city' })], /unrelated destination/],
    [
      Array.from({ length: 5 }, (_, index) => recommendation({ name: `Option ${index + 1}` })),
      /too many options/,
    ],
  ] as const) {
    globalThis.fetch = async () => modelResponse({ recommendations });
    await assert.rejects(
      studioRecommendations(workspace(), ['route-stop'], 'activity', ''),
      pattern,
    );
  }
});

test('known hotel destinations reuse trusted catalogue coordinates without an OpenAI request', async () => {
  const known = destinations.find((destination) => destination.name === 'Paris')!;
  const resolved = await studioHotelDestination(stop({ name: 'Paris', country: 'France' }));
  assert.equal(resolved.id, known.id);
  assert.deepEqual(resolved.coordinates, known.coordinates);
});

test('global hotel location resolution retains the requested city and requires an actual supporting source', async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.text.format.name, 'studio_hotel_location');
    assertSupportedResponseFormats(body.text.format.schema);
    assert.equal(body.tool_choice, 'required');
    return modelResponse({
      name: 'Wanaka',
      country: 'New Zealand',
      resolved: true,
      latitude: -44.7,
      longitude: 169.1,
      sourceUrls: [visitorUrl],
    });
  };
  const resolved = await studioHotelDestination(stop());
  assert.equal(calls, 1);
  assert.equal(resolved.name, 'Wānaka');
  assert.equal(resolved.id, 'route-stop');
  assert.equal(resolved.country, 'New Zealand');
  assert.deepEqual(resolved.coordinates, [-44.7, 169.1]);
});

test('unresolved or ambiguous hotel locations ask for confirmation, including an unspecified country', async () => {
  for (const country of ['United States', '']) {
    globalThis.fetch = async () =>
      modelResponse({
        name: 'Springfield',
        country,
        resolved: false,
        latitude: 0,
        longitude: 0,
        sourceUrls: [],
      });
    await assert.rejects(
      studioHotelDestination(stop({ name: 'Springfield', country })),
      unresolvedError,
    );
  }
});

test('hotel location resolution without verifiable web evidence never returns fallback coordinates', async () => {
  globalThis.fetch = async () =>
    modelResponse(
      {
        name: 'Springfield',
        country: '',
        resolved: false,
        latitude: 0,
        longitude: 0,
        sourceUrls: [],
      },
      [],
    );
  await assert.rejects(
    studioHotelDestination(stop({ name: 'Springfield', country: '' })),
    /no verifiable search sources/,
  );
});

test('hotel location resolution rejects silent city or country substitutions, empty countries and unverified coordinates', async () => {
  for (const data of [
    {
      name: 'Another City',
      country: 'New Zealand',
      resolved: true,
      latitude: -44.7,
      longitude: 169.1,
      sourceUrls: [visitorUrl],
    },
    {
      name: 'Wānaka',
      country: 'Australia',
      resolved: true,
      latitude: -44.7,
      longitude: 169.1,
      sourceUrls: [visitorUrl],
    },
    {
      name: 'Wānaka',
      country: '',
      resolved: true,
      latitude: -44.7,
      longitude: 169.1,
      sourceUrls: [visitorUrl],
    },
    {
      name: 'Wānaka',
      country: 'New Zealand',
      resolved: true,
      latitude: -44.7,
      longitude: 169.1,
      sourceUrls: ['https://invented.example/location'],
    },
    {
      name: 'Wānaka',
      country: 'New Zealand',
      resolved: true,
      latitude: -44.7,
      longitude: 169.1,
      sourceUrls: [],
    },
  ]) {
    globalThis.fetch = async () => modelResponse(data);
    await assert.rejects(studioHotelDestination(stop()), unresolvedError);
  }
});
