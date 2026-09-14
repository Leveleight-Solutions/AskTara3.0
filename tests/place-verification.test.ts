import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { newTrip } from '../server/planner.ts';
import { defaultBrief } from '../server/agents/schedule.ts';
import { verifyResearchPlaces, type PlaceVerificationInput } from '../server/agents/verify.ts';

const originalFetch = globalThis.fetch;
let originalKey: string | undefined;
beforeEach(() => {
  originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'unit-only-key';
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  originalKey === undefined
    ? delete process.env.OPENAI_API_KEY
    : (process.env.OPENAI_API_KEY = originalKey);
});
const closureUrl = 'https://www.optimus-cafe.com/english.html';
const parkUrl = 'https://osaka-info.jp/en/spot/nakanoshima-park/';
function input(): PlaceVerificationInput {
  return {
    trip: { ...newTrip(), startDate: '2026-11-18', days: 3 },
    brief: defaultBrief(),
    places: [
      {
        id: 'optimus',
        name: 'OPTIMUS cafe',
        destinationId: 'osaka-japan',
        address: '2-1-14 Kitahama, Osaka',
        category: 'food',
        durationMinutes: 60,
        estimatedCost: 15,
        sourceId: 'old-menu',
        evidenceUrls: [closureUrl],
      },
      {
        id: 'park',
        name: 'Nakanoshima Park',
        destinationId: 'osaka-japan',
        address: 'Nakanoshima, Osaka',
        category: 'leisure',
        durationMinutes: 90,
        estimatedCost: 0,
        sourceId: 'old-park',
        evidenceUrls: [parkUrl],
      },
    ],
    sources: [],
  };
}
const closed = () => ({
  id: 'optimus',
  status: 'closed',
  reason:
    'Official notice announces permanent closure on March 25, 2026 because of building demolition. Old menus and hours remain below the notice.',
  sourceUrls: [closureUrl],
  closureDate: '2026-03-25',
  reopeningDate: null,
});
const park = () => ({
  id: 'park',
  status: 'no_closure_found',
  reason: 'No closure notice found in the checked park source.',
  sourceUrls: [parkUrl],
  closureDate: null,
  reopeningDate: null,
});
function response(places: unknown[]) {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'web_search_call',
          status: 'completed',
          action: {
            sources: [
              { url: closureUrl, title: 'OPTIMUS cafe — closure notice' },
              { url: parkUrl, title: 'Nakanoshima Park visitor information' },
            ],
          },
        },
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ places }) }] },
      ],
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}

test('a sourced dated OPTIMUS closure overrides stale menus before scheduling without mutating the trip', async () => {
  const request = input();
  const before = structuredClone(request);
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.text.format.name, 'place_verification');
    assert.equal(body.tool_choice, 'required');
    assert.equal(body.max_tool_calls, 4);
    assert.deepEqual(body.tools, [{ type: 'web_search', external_web_access: true }]);
    assert.match(body.instructions, /closure announcement overrides/);
    const payload = JSON.parse(body.input[0].content);
    assert.equal(payload.trip.startDate, '2026-11-18');
    assert.deepEqual(
      payload.places.map((place: { id: string }) => place.id),
      ['optimus', 'park'],
    );
    return response([closed(), park()]);
  };
  const result = await verifyResearchPlaces(request);
  assert.deepEqual(
    result.places.map((place) => place.id),
    ['park'],
  );
  assert.equal(result.issues[0].code, 'place_closed_excluded');
  assert.match(result.issues[0].message, /OPTIMUS cafe.*2026-03-25/);
  assert.ok(result.issues[0].message.includes(closureUrl));
  assert.ok(result.sources.some((source) => source.url === closureUrl && source.status === 'live'));
  assert.match(
    result.places[0].suitability!.at(-1)!,
    /Opening, access and dietary suitability remain unconfirmed/,
  );
  assert.deepEqual(request, before);
});

test('missing venue coverage stays uncertain and fresh sources extend existing evidence', async () => {
  globalThis.fetch = async () => response([park()]);
  const request = input();
  request.places[1].evidenceUrls = ['https://example.com/old-park'];
  const result = await verifyResearchPlaces(request);
  assert.equal(result.places.length, 2);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'place_status_uncertain' && issue.message.includes('OPTIMUS'),
    ),
  );
  assert.deepEqual(result.places[1].evidenceUrls, ['https://example.com/old-park', parkUrl]);
});

test('verification rejects unknown IDs, duplicates and citations not observed in the current web search', async () => {
  for (const fixture of [
    [{ ...closed(), id: 'invented-venue' }],
    [closed(), closed()],
    [{ ...closed(), sourceUrls: ['https://example.com/invented-closure'] }],
    [{ ...closed(), sourceUrls: [] }],
    [{ ...closed(), reason: 'See https://example.com/invented-closure' }],
  ]) {
    globalThis.fetch = async () => response(fixture);
    await assert.rejects(
      verifyResearchPlaces(input()),
      /unknown or repeated|unsearched source|without supporting/,
    );
  }
});

test('verification drops unsupported extra references while requiring support for operational conclusions', async () => {
  const extra = 'https://example.com/unsearched-extra';
  globalThis.fetch = async () =>
    response([
      { ...closed(), sourceUrls: [extra, closureUrl] },
      { ...park(), sourceUrls: [parkUrl, extra] },
    ]);
  const result = await verifyResearchPlaces(input());
  assert.deepEqual(
    result.places.map((place) => place.id),
    ['park'],
  );
  assert.equal(result.issues[0].code, 'place_closed_excluded');
  assert.equal(JSON.stringify(result).includes(extra), false);
  assert.ok(result.sources.some((source) => source.url === closureUrl));
  globalThis.fetch = async () => response([{ ...closed(), sourceUrls: [extra] }, park()]);
  await assert.rejects(verifyResearchPlaces(input()), /without supporting search evidence/);
  globalThis.fetch = async () =>
    response([{ ...closed(), status: 'no_closure_found', sourceUrls: [extra] }, park()]);
  const missingEvidence = await verifyResearchPlaces(input());
  assert.equal(missingEvidence.places.length, 2);
  assert.equal(missingEvidence.issues[0].code, 'place_status_uncertain');
  assert.match(missingEvidence.issues[0].message, /did not return supporting evidence/);
  assert.doesNotMatch(
    missingEvidence.issues[0].message,
    /permanent closure|No closure notice was found/,
  );
  globalThis.fetch = async () =>
    response([{ ...closed(), status: 'uncertain', sourceUrls: [extra] }, park()]);
  const uncertain = await verifyResearchPlaces(input());
  assert.equal(uncertain.places.length, 2);
  assert.equal(JSON.stringify(uncertain).includes(extra), false);
  assert.equal(uncertain.issues[0].code, 'place_status_uncertain');
});

test('closure windows outside the trip and published reopening dates do not erase candidates', async () => {
  for (const fixture of [
    { ...closed(), closureDate: '2026-12-01' },
    { ...closed(), reopeningDate: '2026-11-18' },
  ]) {
    globalThis.fetch = async () => response([fixture, park()]);
    const result = await verifyResearchPlaces(input());
    assert.equal(result.places.length, 2);
    assert.equal(result.issues[0].code, 'place_status_uncertain');
    assert.match(result.issues[0].message, /do not overlap/);
  }
  globalThis.fetch = async () => response([{ ...closed(), reopeningDate: '2026-11-19' }, park()]);
  assert.equal((await verifyResearchPlaces(input())).places.length, 1);
});

test('a closed protected stop is flagged with its location in the schedule and never silently changed', async () => {
  const request = input();
  request.trip.itinerary = [
    {
      day: 2,
      title: 'Riverside Osaka',
      destinationId: 'osaka-japan',
      items: [
        {
          id: 'locked-cafe-stop',
          placeId: 'optimus',
          title: 'Lunch at OPTIMUS cafe',
          time: '12:00',
          description: '',
          location: 'Kitahama',
          category: 'food',
          cost: 15,
          completed: false,
          locked: true,
        },
      ],
    },
  ];
  const original = structuredClone(request.trip);
  globalThis.fetch = async () => response([closed(), park()]);
  const result = await verifyResearchPlaces(request);
  assert.equal(
    result.places.some((place) => place.id === 'optimus'),
    false,
  );
  assert.equal(result.issues[0].code, 'protected_closed_place');
  assert.equal(result.issues[0].day, 2);
  assert.equal(result.issues[0].itemId, 'locked-cafe-stop');
  assert.match(result.issues[0].message, /protected stop remains.*review and unlock/i);
  assert.deepEqual(request.trip, original);
});

test('invalid closure dates and incomplete web searches fail validation; empty inputs make no paid call', async () => {
  for (const fixture of [
    { ...closed(), closureDate: '2026-02-30' },
    { ...closed(), reopeningDate: '2026-03-01' },
  ]) {
    globalThis.fetch = async () => response([fixture]);
    await assert.rejects(verifyResearchPlaces(input()), /invalid closure/);
  }
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify({ places: [closed()] }) }],
          },
        ],
      }),
    );
  await assert.rejects(verifyResearchPlaces(input()), /no verifiable search sources/);
  globalThis.fetch = async () => {
    throw new Error('Should not call');
  };
  assert.deepEqual(await verifyResearchPlaces({ ...input(), places: [] }), {
    places: [],
    sources: [],
    issues: [],
  });
});
