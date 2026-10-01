import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStudioAgency } from '../shared/studio.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { reviewStudioBrief, studioRecommendations } from '../server/studio-models.ts';
import { publicHotelQuote, recommendStudioHotels } from '../server/studio-hotels.ts';

const originalFetch = globalThis.fetch;
const envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.OPENAI_API_KEY = 'synthetic-history-test-key';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of envNames)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});

const history = Array.from({ length: 24 }, (_, index) => ({
  destination: `Previous destination ${index}`,
  country: 'JP',
  visitedAt: '2025-03',
  interests: ['gardens'],
  feedback: 'disliked' as const,
  experience: 'planned' as const,
  notes: 'Prefers quiet areas instead of nightlife.',
  name: 'PRIVATE_PROFILE_NAME',
  clientId: 'PRIVATE_PROFILE_ID',
  dateOfBirth: '1988-01-01',
  photoDataUrl: 'data:image/png;base64,PRIVATE_PROFILE_PHOTO',
  passportNumber: 'PRIVATE_PASSPORT_NUMBER',
}));
function assertHistory(value: Record<string, unknown>[]) {
  assert.equal(value.length, 20);
  assert.equal(value[0].destination, 'Previous destination 4');
  assert.deepEqual(Object.keys(value[0]).sort(), [
    'country',
    'destination',
    'experience',
    'feedback',
    'interests',
    'notes',
    'visitedAt',
  ]);
  assert.equal(value[0].country, 'Japan');
  assert.equal(value[0].feedback, 'disliked');
  assert.equal(value[0].experience, 'planned');
  assert.equal(value[0].notes, 'Prefers quiet areas instead of nightlife.');
  assert.doesNotMatch(
    JSON.stringify(value),
    /PRIVATE|dateOfBirth|photoDataUrl|passportNumber|clientId/,
  );
}
const sourceUrl = 'https://www.visitlondon.com/things-to-do/food-and-drink';
function modelResponse(value: unknown, webSearch = false) {
  return Response.json({
    status: 'completed',
    output: [
      ...(webSearch
        ? [
            {
              type: 'web_search_call',
              status: 'completed',
              action: { sources: [{ url: sourceUrl, title: 'Synthetic visitor source' }] },
            },
          ]
        : []),
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
    ],
  });
}

test('intake receives bounded feedback history without private profile fields', async () => {
  const value = newStudioWorkspace();
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assertHistory(JSON.parse(body.input[0].content).returningClientHistory);
    assert.match(body.instructions, /Current trip instructions take precedence/);
    assert.match(body.instructions, /planned from a confirmed visited trip/);
    return modelResponse({
      reply: 'Hi! Where would you like to go?',
      action: 'continue',
      brief: value.brief,
      facts: [],
      route: [],
      routeEvidence: '',
    });
  };
  await reviewStudioBrief(value, 'hi', defaultStudioAgency(), undefined, history);
});

test('food and activity research receive feedback history while retaining current interests', async () => {
  const value = newStudioWorkspace();
  value.structureAccepted = true;
  value.stops = [
    {
      id: 'london',
      name: 'London',
      country: 'GB',
      nights: 3,
      arrivalDate: '2027-04-01',
      departureDate: '2027-04-04',
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const payload = JSON.parse(body.input[0].content);
    assertHistory(payload.travelHistory);
    assert.equal(payload.preferences.interests, 'This trip: vegetarian dining and live music');
    assert.match(body.instructions, /current trip instructions taking precedence/);
    assert.match(body.instructions, /not a confirmed visit/);
    assert.match(body.instructions, /Never infer demographics/);
    return modelResponse({ recommendations: [] }, true);
  };
  for (const category of ['food', 'activity'] as const)
    await studioRecommendations(
      value,
      ['london'],
      category,
      'This trip: vegetarian dining and live music',
      undefined,
      history,
    );
});

test('hotel shortlisting receives only safe history and quotes without changing current party or location', async () => {
  const value = newStudioWorkspace();
  value.brief.adults = 1;
  value.brief.hotelLocation = 'Central London';
  const quote = publicHotelQuote(
    {
      id: 'provider-offer',
      hotelId: 'provider-hotel',
      name: 'Fictional hotel',
      image: '',
      address: 'Fictional address',
      room: 'Single room',
      board: 'Breakfast',
      price: 500,
      currency: 'AUD',
      checkin: '2027-04-01',
      checkout: '2027-04-04',
    },
    'quote-1',
    new Date().toISOString(),
    'test',
    1,
    [],
  );
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const payload = JSON.parse(body.input[0].content);
    assertHistory(payload.travelHistory);
    assert.equal(payload.preferences.adults, 1);
    assert.equal(payload.preferences.location, 'Central London');
    assert.match(body.instructions, /current trip instructions take precedence/);
    assert.match(body.instructions, /not a confirmed visit/);
    assert.match(
      body.instructions,
      /infer demographics, nationality or the current travelling party/,
    );
    return modelResponse({
      picks: [{ quoteId: 'quote-1', reason: 'The returned quote lists breakfast.' }],
    });
  };
  const result = await recommendStudioHotels(value, [quote], undefined, history);
  assert.equal(result.status, 'ai');
  assert.equal(result.picks[0].quoteId, 'quote-1');
  assert.equal(value.brief.adults, 1);
});
