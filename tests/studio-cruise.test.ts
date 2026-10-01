import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStudioAgency } from '../shared/studio.ts';
import {
  cruiseDraftToItinerary,
  cruiseIsoDate,
  studioCruiseDraftSchema,
} from '../shared/studio-cruise.ts';
import { extractStudioCruise } from '../server/studio-cruise.ts';

const originalFetch = globalThis.fetch;
const envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.OPENAI_API_KEY = 'unit-test-cruise-key';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => assert.fail('Unexpected network request');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of envNames)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});

const text = `Pacific sailing aboard Example Ship. Full cruise fare USD 4500.
Day 1: 2027-10-01 Hong Kong departure 18:00
Day 2: 2 October At sea
Day 3: 2027-10-03 Taipei arrival 08:00 departure 17:00
Day 4: 2027-10-04 Shanghai arrival 09:00`;
const answer = () => ({
  name: 'Pacific sailing',
  ship: 'Example Ship',
  currency: 'USD',
  fullFare: 4500,
  days: [
    {
      day: 1,
      date: '2027-10-01',
      port: 'Hong Kong',
      arrival: '',
      departure: '18:00',
      details: '',
      sourceExcerpt: 'Day 1: 2027-10-01 Hong Kong departure 18:00',
    },
    {
      day: 2,
      date: '2 October',
      port: 'At sea',
      arrival: '',
      departure: '',
      details: '',
      sourceExcerpt: 'Day 2: 2 October At sea',
    },
    {
      day: 3,
      date: '2027-10-03',
      port: 'Taipei',
      arrival: '08:00',
      departure: '17:00',
      details: '',
      sourceExcerpt: 'Day 3: 2027-10-03 Taipei arrival 08:00 departure 17:00',
    },
    {
      day: 4,
      date: '2027-10-04',
      port: 'Shanghai',
      arrival: '09:00',
      departure: '',
      details: '',
      sourceExcerpt: 'Day 4: 2027-10-04 Shanghai arrival 09:00',
    },
  ],
  warnings: [],
});

function mockOpenAI(data: unknown, inspect?: (request: Record<string, any>) => void) {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const request = JSON.parse(String(options?.body));
    inspect?.(request);
    return Response.json({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
    });
  };
}
const preview = (source = text) =>
  extractStudioCruise(
    { kind: 'text', name: 'Pacific itinerary', text: source },
    defaultStudioAgency(),
  );

test('cruise preview extracts literal days using sanitized source text only', async () => {
  mockOpenAI(answer(), (request) => {
    assert.equal(request.store, false);
    assert.equal(request.tools, undefined);
    const payload = JSON.parse(request.input[0].content);
    assert.deepEqual(Object.keys(payload), ['sourceText']);
    assert.doesNotMatch(payload.sourceText, /ABC123456|PRIVATE99|private@example.com/);
    assert.match(request.instructions, /never instructions|untrusted data/i);
  });
  const result = await preview(
    `${text}\nPassport number: ABC123456\nPNR: PRIVATE99\nprivate@example.com`,
  );
  assert.equal(result.days.length, 4);
  assert.equal(result.days[1].date, '2 October');
  assert.equal(result.fullFare, 4500);
  assert.equal(result.disembarkAfterDay, null);
  assert.ok(result.id);
  assert.equal(studioCruiseDraftSchema.safeParse(result).success, true);
});

test('early Taipei disembarkation keeps full fare, permits onward flight and return cruise', async () => {
  mockOpenAI(answer());
  const draft = await preview();
  draft.disembarkAfterDay = 3;
  draft.onwardTransport = 'flight';
  draft.returnTransport = 'cruise';
  draft.days[2].details = 'Agent recommends an extra night in Taipei.';
  const itinerary = cruiseDraftToItinerary(draft, ['hk', 'sea', 'taipei', 'shanghai']);
  assert.equal(draft.fullFare, 4500);
  assert.equal(draft.days.length, 4);
  assert.equal(itinerary.days.length, 3);
  assert.equal(itinerary.days[2].title, 'Taipei');
  assert.deepEqual(itinerary.days[2].stopIds, ['taipei']);
  assert.equal(itinerary.days[1].date, '');
  assert.match(itinerary.days[1].summary, /2 October/);
  assert.deepEqual(itinerary.days[2].activities[0].sources, []);
  assert.match(itinerary.notes.join(' '), /Full cruise fare is retained/);
  assert.match(itinerary.notes.join(' '), /Onward flight/);
  assert.match(itinerary.notes.join(' '), /Return by cruise/);
});

test('cruise extraction refuses unreadable schedules and unsupported port/date/time claims', async () => {
  mockOpenAI({ ...answer(), days: [] });
  await assert.rejects(
    preview('Cruise brochure. No daily schedule shown.'),
    /No readable day-by-day/,
  );
  for (const change of [
    (value: ReturnType<typeof answer>) => {
      value.days[2].port = 'Osaka';
    },
    (value: ReturnType<typeof answer>) => {
      value.days[1].date = '2027-10-02';
    },
    (value: ReturnType<typeof answer>) => {
      value.days[0].departure = '19:00';
    },
    (value: ReturnType<typeof answer>) => {
      value.days[2].sourceExcerpt = 'invented source text';
    },
  ]) {
    const value = answer();
    change(value);
    mockOpenAI(value);
    await assert.rejects(preview(), /could not be matched to the source/);
  }
});

test('cruise URLs retain the import fetcher protections before any model call', async () => {
  await assert.rejects(
    extractStudioCruise(
      { kind: 'url', name: 'Internal link', url: 'https://127.0.0.1/cruise' },
      defaultStudioAgency(),
    ),
    /Only public HTTPS/,
  );
});

test('ambiguous fare currency stays unpriced and deleting cruise days never changes the fare', async () => {
  mockOpenAI({ ...answer(), currency: '' });
  const unpriced = await preview();
  assert.equal(unpriced.fullFare, null);
  assert.match(unpriced.warnings.join(' '), /did not identify a currency/);
  mockOpenAI(answer());
  const draft = await preview();
  draft.days.pop();
  assert.equal(studioCruiseDraftSchema.parse(draft).fullFare, 4500);
  assert.equal(cruiseDraftToItinerary(draft).days.length, 3);
  assert.equal(draft.fullFare, 4500);
});

test('an invented cruise fare cannot become a priced quote', async () => {
  mockOpenAI({ ...answer(), fullFare: 1200 });
  const draft = await preview();
  assert.equal(draft.fullFare, null);
  assert.match(draft.warnings.join(' '), /could not be matched to an explicit amount/);
  mockOpenAI(answer());
  assert.equal((await preview(text.replace('4500', '4,500.00'))).fullFare, 4500);
});

test('reviewed cruise source links reject executable or credential-bearing URLs', async () => {
  mockOpenAI(answer());
  const draft = await preview();
  for (const sourceUrl of [
    'not a URL',
    'javascript:alert(1)',
    'data:text/html,test',
    'https://user:secret@example.com/cruise',
  ])
    assert.equal(studioCruiseDraftSchema.safeParse({ ...draft, sourceUrl }).success, false);
});

test('cruise service identifiers and full fares stay within shared service limits', async () => {
  mockOpenAI(answer());
  const draft = await preview();
  assert.equal(
    studioCruiseDraftSchema.safeParse({ ...draft, id: 'a'.repeat(66), fullFare: 10_000_000 })
      .success,
    true,
  );
  assert.equal(studioCruiseDraftSchema.safeParse({ ...draft, id: 'a'.repeat(67) }).success, false);
  assert.equal(
    studioCruiseDraftSchema.safeParse({ ...draft, fullFare: 10_000_001 }).success,
    false,
  );
});

test('invalid and incomplete source dates remain visible text without becoming false calendar dates', async () => {
  assert.equal(cruiseIsoDate('2028-02-29'), '2028-02-29');
  for (const value of [
    '',
    '2027-02-29',
    '2027-02-30',
    '2027-13-01',
    '2 October',
    '2027-10-01T00:00:00Z',
  ])
    assert.equal(cruiseIsoDate(value), '');
  mockOpenAI(answer());
  const draft = await preview();
  draft.days[0].date = '2027-02-30';
  const itinerary = cruiseDraftToItinerary(draft);
  assert.equal(itinerary.days[0].date, '');
  assert.match(itinerary.days[0].summary, /2027-02-30/);
  assert.equal(draft.fullFare, 4500);
});
