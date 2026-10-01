import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStudioItinerarySlots, generateStudioItinerary } from '../server/studio-itinerary.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { cruiseDraftToItinerary, type StudioCruiseDraft } from '../shared/studio-cruise.ts';
import type { StudioStop } from '../shared/studio.ts';

// Model responses are mocked; the real itinerary guards and reviewed cruise
// merging run without making external requests.
const originalFetch = globalThis.fetch;
let previousKey: string | undefined;
beforeEach(() => {
  previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'synthetic-cruise-generation-key';
  globalThis.fetch = async () => assert.fail('Unexpected model request');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  previousKey === undefined
    ? delete process.env.OPENAI_API_KEY
    : (process.env.OPENAI_API_KEY = previousKey);
});
function stop(id: string, name: string, date: string, nights: number): StudioStop {
  return {
    id,
    name,
    country: '',
    nights,
    arrivalDate: date,
    arrivalFixed: true,
    departureDate: '',
    onwardTransport: 'other',
    neighbourhood: '',
    notes: '',
  };
}
function fixture(early = false) {
  const workspace = newStudioWorkspace();
  workspace.structureAccepted = true;
  workspace.itineraryManual = true;
  const ports = early
    ? ['Hong Kong', 'At sea', 'Keelung', 'Kagoshima', 'Shanghai']
    : ['Barcelona', 'Marseille', 'At sea', 'Civitavecchia'];
  const dates = early
    ? ['2027-10-01', '2027-10-02', '2027-10-03', '2027-10-04', '2027-10-05']
    : ['2027-05-03', '2027-05-04', '2027-05-05', '2027-05-06'];
  const cruise: StudioCruiseDraft = {
    id: 'reviewed-cruise',
    name: 'Fictional reviewed sailing',
    ship: 'Fictional ship',
    sourceName: 'Authored test schedule',
    sourceUrl: '',
    extractedAt: '2026-10-01T00:00:00.000Z',
    currency: early ? 'USD' : 'EUR',
    fullFare: early ? 4500 : 3800,
    disembarkAfterDay: early ? 3 : null,
    onwardTransport: early ? 'flight' : 'undecided',
    returnTransport: 'flight',
    warnings: [],
    days: ports.map((port, index) => ({
      id: `reviewed-day-${index + 1}`,
      day: index + 1,
      date: dates[index],
      port,
      arrival: index ? '08:00' : '',
      departure: index < ports.length - 1 ? '18:00' : '',
      details: 'Reviewed source details. Confirm the schedule with the cruise line.',
    })),
  };
  workspace.cruises = [cruise];
  workspace.stops = early
    ? [
        stop('hk', 'Hong Kong', '2027-10-01', 0),
        stop('keelung', 'Keelung', '2027-10-03', 0),
        stop('taipei', 'Taipei', '2027-10-03', 2),
        stop('taichung', 'Taichung', '2027-10-05', 2),
      ]
    : [
        stop('barcelona', 'Barcelona', '2027-05-01', 2),
        stop('marseille', 'Marseille', '2027-05-04', 0),
        stop('civitavecchia', 'Civitavecchia', '2027-05-06', 0),
        stop('rome', 'Rome', '2027-05-06', 2),
      ];
  workspace.brief.startDate = early ? '2027-10-01' : '2027-05-01';
  workspace.brief.endDate = early ? '2027-10-07' : '2027-05-08';
  workspace.itinerary = cruiseDraftToItinerary(cruise);
  workspace.itinerary.days.at(-1)!.activities.push({
    period: 'evening',
    title: early ? 'Transfer to the Taipei hotel' : 'Transfer to the Rome hotel',
    description: 'Reviewed manual transfer; reconfirm the transport arrangements.',
    sources: [],
  });
  workspace.items = [
    {
      id: `cruise:${cruise.id}`,
      kind: 'cruise',
      title: cruise.name,
      description: 'Full cruise fare retained; no segment refund.',
      stopId: '',
      startDate: dates[0],
      endDate: dates[early ? 2 : 3],
      status: 'suggested',
      source: 'manual',
      sourceUrl: '',
      supplier: cruise.ship,
      privateReference: '',
      price: cruise.fullFare,
      currency: cruise.currency,
      priceStatus: 'agent_estimate',
      quotedAt: '',
      included: true,
      needsReview: false,
      cost: 2000,
    },
  ];
  return workspace;
}
const source = {
  url: 'https://tourism.example/official-park',
  title: 'Official park visitor guide',
};
function mockLandResearch(inspect?: (payload: any, data: any) => void) {
  const captured: any[] = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(String(options?.body));
    const payload = JSON.parse(request.input[0].content);
    captured.push(payload);
    const data = {
      days: payload.slots.map((slot: any) => ({
        day: slot.day,
        date: slot.date,
        stopIds: slot.stopIds,
        title: 'Gentle land exploration',
        summary: 'A relaxed land day with time left flexible.',
        activities: [
          {
            period: 'afternoon',
            kind: 'research',
            title: 'Explore the public park',
            description: 'Enjoy a gentle walk; reconfirm visitor information before travel.',
            sourceUrls: [source.url],
            serviceId: '',
          },
        ],
      })),
      notes: [],
    };
    inspect?.(payload, data);
    return Response.json({
      status: 'completed',
      output: [
        { type: 'web_search_call', status: 'completed', action: { sources: [source] } },
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
      ],
    });
  };
  return captured;
}

for (const early of [false, true])
  test(`mocked AI generation researches land and preserves reviewed ${early ? 'early-exit Asian' : 'Mediterranean'} cruise rows`, async () => {
    const value = fixture(early);
    const before = structuredClone(value);
    const captured = mockLandResearch();
    const result = await generateStudioItinerary(
      value,
      'Research the land days and preserve the cruise plan.',
    );
    assert.deepEqual(
      value,
      before,
      'Generation cannot rewrite source schedules, full fares, services or route.',
    );
    assert.equal(result.days.length, early ? 7 : 8);
    assert.deepEqual(
      result.days.map((day) => day.day),
      Array.from({ length: early ? 7 : 8 }, (_, i) => i + 1),
    );
    for (const original of before.itinerary!.days) {
      const kept = result.days.find((day) => day.cruiseDayId === original.cruiseDayId)!;
      assert.ok(kept);
      assert.equal(kept.cruiseId, original.cruiseId);
      assert.equal(kept.date, original.date);
      assert.equal(kept.title, original.title);
      assert.equal(kept.summary, original.summary);
      assert.deepEqual(kept.activities, original.activities);
      assert.ok(kept.stopIds.every((id) => value.stops.some((stop) => stop.id === id)));
    }
    const sea = result.days.find((day) => day.title === 'At sea')!;
    assert.ok(sea.cruiseId);
    assert.deepEqual(sea.stopIds, [], 'Sea days do not inherit adjacent ports as invented stays.');
    const shared = result.days.find((day) => day.date === (early ? '2027-10-03' : '2027-05-06'))!;
    assert.ok(shared.stopIds.includes(early ? 'taipei' : 'rome'));
    assert.equal(result.days.filter((day) => day.date === shared.date).length, 1);
    assert.ok(
      result.days
        .filter((day) => !day.cruiseId)
        .every((day) => day.activities[0].sources[0]?.url === source.url),
    );
    assert.match(result.notes.join(' '), /Full cruise fare is retained/);
    if (early) {
      assert.match(result.notes.join(' '), /early disembarkation: Keelung/i);
      assert.ok(!result.days.some((day) => ['Kagoshima', 'Shanghai'].includes(day.title)));
    }
    assert.equal(captured.length, 1);
    assert.equal(captured[0].slots.length, 4);
    assert.ok(
      captured[0].slots.every((slot: any) => slot.kind !== 'gap' && slot.kind !== 'cruise'),
    );
    assert.ok(captured[0].currentItinerary.days.every((day: any) => !day.cruiseId));
    assert.doesNotMatch(JSON.stringify(captured), /reviewed-day-|"cost"|4500|3800/);
  });

test('cruise-only generation preserves reviewed undated source order without calling an LLM', async () => {
  const value = fixture(true);
  value.stops = [];
  value.brief.endDate = '2027-10-03';
  value.cruises![0].days[1].date = '2 October';
  value.itinerary!.days[1].date = '';
  value.itinerary!.days[1].summary = '2 October · Agent-reviewed sea day';
  delete process.env.OPENAI_API_KEY;
  const before = structuredClone(value.itinerary!.days);
  const result = await generateStudioItinerary(value, 'Keep the reviewed schedule.');
  assert.deepEqual(result.days, before);
  assert.equal(result.days[1].date, '');
  assert.equal(value.cruises![0].fullFare, 4500);
});

test('a same-date manually authored land transfer joins the protected cruise boundary', async () => {
  const value = fixture(true);
  const activity = {
    period: 'evening' as const,
    title: 'Reviewed luggage collection',
    description: 'Keep this separately reviewed transfer task.',
    sources: [],
  };
  value.itinerary!.days.push({
    day: 4,
    date: '2027-10-03',
    stopIds: ['taipei', 'removed-stop'],
    title: 'Taipei arrival',
    summary: '',
    activities: [activity],
  });
  mockLandResearch();
  const result = await generateStudioItinerary(value, 'Plan the land stay.');
  const shared = result.days.find((day) => day.date === '2027-10-03')!;
  assert.ok(shared.activities.some((entry) => entry.title === activity.title));
  assert.ok(!shared.stopIds.includes('removed-stop'));
  value.itinerary = result;
  value.itineraryManual = false;
  const regenerated = await generateStudioItinerary(value, 'Make land days quieter.');
  assert.deepEqual(
    regenerated.days.find((day) => day.date === '2027-10-03'),
    shared,
  );
});

test('mixed cruise and land dates must be grounded before regeneration, without changing the saved plan', async () => {
  const value = fixture(true);
  value.itinerary!.days[1].date = '';
  const before = structuredClone(value);
  await assert.rejects(generateStudioItinerary(value, ''), /Confirm the cruise dates/);
  assert.deepEqual(value, before);
});

test('AI cannot add duplicate cruise days or change a land day date during cruise regeneration', async () => {
  const value = fixture(false);
  mockLandResearch((_payload, data) =>
    data.days.push({ ...data.days[0], day: 3, date: '2027-05-03' }),
  );
  await assert.rejects(generateStudioItinerary(value, ''), /cover every trip day/);
  mockLandResearch((_payload, data) => (data.days[0].date = '2027-05-02'));
  await assert.rejects(generateStudioItinerary(value, ''), /changed the accepted route/);
});

test('preserved cruise text retains privacy validation and generation day limits', async () => {
  const value = fixture(true);
  value.itinerary!.days[0].activities[0].description = 'Passport number: ABC123456';
  await assert.rejects(generateStudioItinerary(value, ''), /private client details/);
  const long = fixture(false);
  long.stops = [];
  long.cruises![0].days = Array.from({ length: 36 }, (_, index) => ({
    ...long.cruises![0].days[0],
    id: `day-${index}`,
    day: index + 1,
    date: '',
    port: 'At sea',
  }));
  long.itinerary = null;
  assert.throws(() => buildStudioItinerarySlots(long), /up to 35 days/);
});

test('a cruise end date cannot conceal a land route extending beyond the requested trip end', async () => {
  const value = fixture(false);
  value.brief.endDate = '2027-05-06';
  value.stops.at(-1)!.nights = 4;
  const before = structuredClone(value);
  await assert.rejects(generateStudioItinerary(value, ''), /route and requested end date differ/);
  assert.deepEqual(value, before);
});

test('nonchronological reviewed rows retain source order for cruise-only plans and block ambiguous mixed plans', async () => {
  const value = fixture(false);
  value.itinerary!.days[1].date = '2027-05-05';
  value.itinerary!.days[2].date = '2027-05-04';
  await assert.rejects(generateStudioItinerary(value, ''), /Review the cruise date order/);
  value.stops = [];
  value.brief.endDate = '2027-05-06';
  const before = structuredClone(value.itinerary!.days);
  const result = await generateStudioItinerary(value, 'Preserve the reviewed schedule.');
  assert.deepEqual(result.days, before);
});

test('unique legacy cruise rows gain source identity while retaining reviewed activities', async () => {
  const value = fixture(true);
  for (const day of value.itinerary!.days) delete day.cruiseDayId;
  const transfer = structuredClone(value.itinerary!.days.at(-1)!.activities);
  mockLandResearch();
  const result = await generateStudioItinerary(value, 'Plan land days.');
  const retained = result.days.find((day) => day.cruiseDayId === 'reviewed-day-3')!;
  assert.deepEqual(retained.activities, transfer);
});
