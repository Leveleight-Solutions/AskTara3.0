import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultStudioAgency,
  type StudioBrief,
  type StudioStop,
  type StudioWorkspace,
} from '../shared/studio.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';
import {
  applyStudioPatch,
  recalculateStudioStops,
  studioPatchSchema,
} from '../server/studio-domain.ts';
import {
  groundedStudioBrief,
  groundedStudioDates,
  requestedStudioNights,
  assertStudioRouteGrounding,
} from '../server/studio-grounding.ts';
import { reviewStudioBrief } from '../server/studio-models.ts';
import {
  resolveStudioClarification,
  studioStayConfirmation,
} from '../server/studio-intake-continuity.ts';
import { flightSearchSchema } from '../server/validation.ts';

// These are deterministic application-boundary regressions. Model responses below
// are explicitly mocked; they do not measure an upstream model's understanding.
const originalFetch = globalThis.fetch;
const envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let previous: Record<string, string | undefined>;
const agency = defaultStudioAgency();
beforeEach(() => {
  previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.OPENAI_API_KEY = 'synthetic-trip-matrix-test-key';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => assert.fail('Trip matrix must not make an external request.');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of envNames)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});
function stop(name: string, country: string, nights: number | null): StudioStop {
  return {
    id: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    country,
    nights,
    arrivalDate: '',
    arrivalFixed: false,
    departureDate: '',
    onwardTransport: 'undecided',
    neighbourhood: '',
    notes: '',
  };
}
function workspace(stops: StudioStop[] = [], startDate = '') {
  const value = newStudioWorkspace();
  applyStudioPatch(
    value,
    {
      revision: value.revision,
      brief: { startDate, preferredDestination: stops[0]?.name || '' },
      stops,
    },
    agency,
  );
  return value;
}
function ground(
  message: string,
  patch: Partial<StudioBrief>,
  current = newStudioWorkspace().brief,
) {
  return groundedStudioBrief(
    current,
    { ...current, ...patch },
    Object.keys(patch).map((field) => ({ field: field as keyof StudioBrief, evidence: message })),
    message,
    [],
  );
}
async function mockReview(
  value: StudioWorkspace,
  message: string,
  patch: Partial<StudioBrief>,
  proposedStops?: StudioStop[],
) {
  globalThis.fetch = async () =>
    Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                reply: 'Please review the supplied details.',
                action: 'continue',
                brief: { ...value.brief, ...patch },
                facts: Object.keys(patch).map((field) => ({ field, evidence: message })),
                route: (proposedStops || value.stops).map(
                  ({ id: _id, departureDate: _departure, ...entry }) => ({
                    ...entry,
                    arrivalFixed: Boolean(entry.arrivalFixed),
                  }),
                ),
                routeEvidence: proposedStops ? message : '',
              }),
            },
          ],
        },
      ],
    });
  return reviewStudioBrief(value, message, agency);
}

for (const { name, message, expected } of [
  { name: 'honeymoon', message: 'This is our honeymoon in the Maldives.', expected: 'tourism' },
  { name: 'explicit leisure holiday', message: 'A holiday in Mauritius.', expected: 'tourism' },
  {
    name: 'business visit',
    message: 'A business trip to Singapore for meetings.',
    expected: 'business',
  },
  {
    name: 'unknown purpose despite premium cabin',
    message: 'Business class flights to Tokyo.',
    expected: undefined,
  },
] as const)
  test(`trip matrix purpose: ${name}`, () => {
    assert.equal(ground(message, { tripPurpose: 'tourism' }).tripPurpose, expected);
  });

for (const { name, message, adults, children, childAges } of [
  {
    name: 'five adult friends hiking Nepal',
    message: 'Five adults and no children want a hiking holiday in Nepal.',
    adults: 5,
    children: 0,
    childAges: [],
  },
  {
    name: 'five friends do not establish adult or child counts',
    message: 'Five friends want to hike in Nepal.',
    adults: null,
    children: null,
    childAges: [],
  },
  {
    name: 'family with exact child ages',
    message: 'Two adults and two children aged three and nine want Japan.',
    adults: 2,
    children: 2,
    childAges: [3, 9],
  },
  {
    name: 'incomplete child ages stay unknown',
    message: 'Two adults and two children, one aged seven.',
    adults: 2,
    children: 2,
    childAges: [],
  },
  {
    name: 'an eighteen-year-old cannot silently become a child fare',
    message: 'Two adults and one kid aged eighteen.',
    adults: 2,
    children: 1,
    childAges: [],
  },
  {
    name: 'singular child is a counted child',
    message: 'Two adults and one child aged five.',
    adults: 2,
    children: 1,
    childAges: [5],
  },
])
  test(`trip matrix party: ${name}`, () => {
    const result = ground(message, { adults: 99, children: 9, childAges: [1] });
    assert.equal(result.adults, adults);
    assert.equal(result.children, children);
    assert.deepEqual(result.childAges, childAges);
  });

for (const { name, message, current, expectedBudget, expectedCurrency } of [
  {
    name: 'five-adult group total',
    message: 'Budget NPR 500000 total for the group.',
    current: { adults: 5, children: 0 },
    expectedBudget: 500000,
    expectedCurrency: 'NPR',
  },
  {
    name: 'explicit per person with confirmed adults',
    message: 'Budget AUD 1200 per person.',
    current: { adults: 5, children: 0 },
    expectedBudget: 6000,
    expectedCurrency: 'AUD',
  },
  {
    name: 'per person without confirmed party',
    message: 'Budget AUD 1200 per person.',
    current: {},
    expectedBudget: null,
    expectedCurrency: 'AUD',
  },
  {
    name: 'changing currency clears the old amount',
    message: 'Use EUR for the budget.',
    current: { budget: 6000, currency: 'AUD' },
    expectedBudget: null,
    expectedCurrency: 'EUR',
  },
  {
    name: 'changing to a total replaces a previous per-person amount',
    message: 'The total group budget is AUD 4200.',
    current: {
      adults: 5,
      children: 0,
      budget: 6000,
      requirements: [
        'Budget basis: AUD 1200 per person; group total calculated from confirmed multipliers.',
      ],
    },
    expectedBudget: 4200,
    expectedCurrency: 'AUD',
  },
] as const)
  test(`trip matrix money: ${name}`, () => {
    const prior: StudioBrief = {
      ...newStudioWorkspace().brief,
      ...current,
      requirements: 'requirements' in current ? [...current.requirements] : [],
    };
    const result = ground(message, { budget: 999999, currency: 'USD' }, prior);
    assert.equal(result.budget, expectedBudget);
    assert.equal(result.currency, expectedCurrency);
    if (name.startsWith('changing to a total')) assert.deepEqual(result.requirements, []);
  });

for (const { name, message, startDate, endDate, context } of [
  {
    name: 'explicit cross-year dates',
    message: 'Arrive on 28 December 2026 and return on 3 January 2027.',
    startDate: '2026-12-28',
    endDate: '2027-01-03',
  },
  {
    name: 'next January after a saved December arrival',
    message: 'Return on 3 January.',
    startDate: undefined,
    endDate: '2027-01-03',
    context: { brief: { ...newStudioWorkspace().brief, startDate: '2026-12-28' } },
  },
  {
    name: 'valid leap day',
    message: 'Arrive on 29 February 2028.',
    startDate: '2028-02-29',
    endDate: undefined,
  },
  {
    name: 'invalid non-leap date stays unknown',
    message: 'Arrive on 29 February 2027.',
    startDate: undefined,
    endDate: undefined,
  },
] as const)
  test(`trip matrix dates: ${name}`, () => {
    const result = groundedStudioDates(message, { today: '2026-10-01', ...context });
    assert.equal(result.startDate, startDate);
    assert.equal(result.endDate, endDate);
  });

test('trip matrix date arithmetic preserves leap and cross-year nights', () => {
  for (const [arrival, nights, departure] of [
    ['2028-02-28', 2, '2028-03-01'],
    ['2026-12-28', 6, '2027-01-03'],
  ] as const) {
    const [result] = recalculateStudioStops([stop('Tokyo', 'Japan', nights)], arrival);
    assert.equal(result.arrivalDate, arrival);
    assert.equal(result.departureDate, departure);
    assert.equal(result.nights, nights);
  }
});

for (const message of ['We all hold Australian passports.', 'Our passports are Australian.'])
  test(`trip matrix passport nationality supports plural declarations: ${message}`, () => {
    assert.equal(ground(message, { passportNationality: 'US' }).passportNationality, 'AU');
  });

test('trip matrix mixed passport nationalities do not become one shared nationality', () => {
  assert.equal(
    ground('Two travellers have Australian passports and three have Indian passports.', {
      passportNationality: 'AU',
    }).passportNationality,
    '',
  );
});

for (const basis of ['per person', 'per day', 'per night'])
  test(`trip matrix money excludes negated ${basis} from a declared trip total`, () => {
    const current = {
      ...newStudioWorkspace().brief,
      adults: 5,
      children: 0,
      requirements: ['Budget basis: AUD 100 per day; group total not confirmed.'],
    };
    const result = ground(
      `The budget is EUR 1800 for the whole trip, not ${basis}.`,
      { budget: 999999, currency: 'USD' },
      current,
    );
    assert.equal(result.budget, 1800);
    assert.equal(result.currency, 'EUR');
    assert.deepEqual(result.requirements, []);
  });

test('trip matrix money preserves an affirmative replacement for a rejected rate basis', () => {
  const current = { ...newStudioWorkspace().brief, adults: 5, children: 0 };
  const result = ground('Budget EUR 1800 not per day but per person.', { budget: 99 }, current);
  assert.equal(result.budget, 9000);
  assert.match(result.requirements[0], /per person/);
  assert.doesNotMatch(result.requirements[0], /per day/);
});

for (const message of ['Budget XYZ 5000.', 'Budget 5000 XYZ.'])
  test(`trip matrix money does not relabel an unknown currency as AUD: ${message}`, () => {
    const result = ground(message, { budget: 5000, currency: 'XYZ' });
    assert.equal(result.budget, null);
    assert.equal(result.currency, 'AUD');
  });

test('trip matrix money keeps ordinary words separate from ISO codes and other quoted prices', () => {
  const ordinary = ground('We should try all options. Budget 5000.', {
    budget: 99,
    currency: 'TRY',
  });
  assert.equal(ordinary.budget, 5000);
  assert.equal(ordinary.currency, 'AUD');
  const albanian = ground('Budget ALL 5000 total.', { budget: 99, currency: 'USD' });
  assert.equal(albanian.budget, 5000);
  assert.equal(albanian.currency, 'ALL');
  const changed = ground(
    'The flight quote is USD 800. Use EUR for the budget.',
    { currency: 'EUR' },
    { ...newStudioWorkspace().brief, budget: 6000, currency: 'AUD' },
  );
  assert.equal(changed.currency, 'EUR');
  assert.equal(changed.budget, null);
  const withTea = ground('Budget AUD 5000. We enjoy tea by the cup.', {
    budget: 99,
    currency: 'CUP',
  });
  assert.equal(withTea.budget, 5000);
  assert.equal(withTea.currency, 'AUD');
  const withDate = ground('Budget AUD 5000. Arrive on 10 NOV 2026.', { budget: 99 });
  assert.equal(withDate.budget, 5000);
  const capitalNegation = ground('Budget EUR 1800 NOT per day.', { budget: 99 });
  assert.equal(capitalNegation.budget, 1800);
});

test('trip matrix dates scope omitted-year rollover to an explicit return, including a short answer', () => {
  const context = {
    today: '2026-10-01',
    brief: { ...newStudioWorkspace().brief, startDate: '2026-12-28' },
  };
  assert.deepEqual(
    groundedStudioDates('Arrive on 28 December 2026 and return on 3 January.', {
      today: '2026-10-01',
    }),
    { startDate: '2026-12-28', endDate: '2027-01-03' },
  );
  assert.equal(
    groundedStudioDates('January 3', {
      ...context,
      messages: [{ role: 'assistant', content: 'When will you return?' }],
    }).endDate,
    '2027-01-03',
  );
  assert.equal(groundedStudioDates('Return on 3 January 2026.', context).endDate, '2026-01-03');
  assert.equal(groundedStudioDates('Return on 27 December.', context).endDate, '2026-12-27');
  assert.equal(
    groundedStudioDates('Change arrival to 3 January.', context).startDate,
    '2026-01-03',
  );
  assert.equal(
    groundedStudioDates('Return on 29 February.', {
      ...context,
      brief: { ...context.brief, startDate: '2027-12-28' },
    }).endDate,
    '2028-02-29',
  );
});

test('trip matrix a single saved destination qualifier permits its exact town name in a stay correction', () => {
  assert.equal(
    requestedStudioNights(
      'Please extend Ubud to five nights and leave on 17 November 2026.',
      'Ubud, Bali',
      4,
      true,
    ),
    5,
  );
  assert.equal(
    requestedStudioNights('Extend Ubud to five nights.', 'Ubud, Bali', 4, false),
    undefined,
    'A shortened label is not assumed to disambiguate a multi-stop route.',
  );
  assert.equal(
    requestedStudioNights('Please extend Ubud to five nights.', 'Nusa Dua, Bali', 4, true),
    undefined,
  );
});

test('trip matrix an arrival date between a destination and its stay cannot hide the first stop nights', () => {
  const message =
    'Arrive Kathmandu, Nepal on 10 November 2026 for two nights, then Pokhara for three nights, leaving Pokhara on 15 November.';
  assert.equal(requestedStudioNights(message, 'Kathmandu', null, false), 2);
  assert.equal(requestedStudioNights(message, 'Pokhara', null, false), 3);
});

test('trip matrix a natural date range and destination departure retain the supplied trip end', () => {
  assert.deepEqual(
    groundedStudioDates('Build the Ubud honeymoon, 12–17 November 2026, five nights.'),
    { startDate: '2026-11-12', endDate: '2026-11-17' },
  );
  const context = {
    brief: { ...newStudioWorkspace().brief, preferredDestination: 'New York', origin: 'Sydney' },
  };
  assert.deepEqual(
    groundedStudioDates(
      'Correction: my arrival in New York is 10 November 2026. Keep five nights, so depart on 15 November 2026.',
      context,
    ),
    { startDate: '2026-11-10', endDate: '2026-11-15' },
  );
  assert.deepEqual(
    groundedStudioDates(
      'Arrive New York on 10 November 2026 for five nights. Depart Sydney on 9 November 2026.',
      context,
    ),
    { startDate: '2026-11-10', departureDate: '2026-11-09' },
  );
});

test('trip matrix a polite multi-stop correction preserves both literal stays and final departure', () => {
  const message =
    'Please change Tokyo to two nights and Kyoto to four nights while keeping arrival 7 December and final departure 13 December 2026. Take a train between Tokyo and Kyoto, with exact train times to be confirmed.';
  const current = [stop('Tokyo', 'Japan', null), stop('Kyoto', 'Japan', 3)];
  const proposed = [
    { ...current[0], nights: 2, onwardTransport: 'train' as const },
    { ...current[1], nights: 4 },
  ];
  const context = {
    brief: {
      ...newStudioWorkspace().brief,
      preferredDestination: 'Tokyo',
      startDate: '2026-12-07',
    },
  };
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding(current, proposed, message, [], message, context),
  );
  assert.deepEqual(groundedStudioDates(message, context), {
    startDate: '2026-12-07',
    endDate: '2026-12-13',
  });
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        current,
        [{ ...proposed[0], nights: 8 }, proposed[1]],
        message,
        [],
        message,
        context,
      ),
    /route did not match/,
  );
});

test('trip matrix uncertain or negated one-way ideas preserve existing return transport', () => {
  const current = { ...newStudioWorkspace().brief, returnTransport: 'flight' as const };
  for (const message of [
    'Maybe a one-way trip.',
    'What if there is no return flight?',
    'This is not one way.',
  ])
    assert.equal(
      ground(message, { returnTransport: 'undecided' }, current).returnTransport,
      'flight',
      message,
    );
  assert.equal(
    ground('No return flight, return by cruise.', { returnTransport: 'cruise' }, current)
      .returnTransport,
    'cruise',
  );
  assert.equal(
    ground(
      'No return flight.',
      { returnTransport: 'undecided' },
      { ...current, returnTransport: 'cruise' },
    ).returnTransport,
    'cruise',
  );
});

test('trip matrix mocked AI review: five adults keep a two-stop Nepal hiking route and group budget', async () => {
  const value = workspace();
  const message =
    'Kathmandu for 2 nights, then Pokhara for 5 nights. Five adults and no children. A hiking holiday with a total budget of AUD 10000.';
  await mockReview(
    value,
    message,
    {
      adults: 5,
      children: 0,
      budget: 10000,
      currency: 'AUD',
      interests: ['hiking'],
      tripPurpose: 'tourism',
    },
    [stop('Kathmandu', 'Nepal', 2), stop('Pokhara', 'Nepal', 5)],
  );
  assert.deepEqual(
    value.stops.map((entry) => [entry.name, entry.nights]),
    [
      ['Kathmandu', 2],
      ['Pokhara', 5],
    ],
  );
  assert.equal(value.brief.adults, 5);
  assert.equal(value.brief.children, 0);
  assert.equal(value.brief.budget, 10000);
  assert.equal(value.brief.startDate, '');
  assert.equal(value.structureAccepted, false);
});

test('trip matrix mocked AI review: changing Zermatt arrival leaves Zurich and Lucerne intact', async () => {
  const value = workspace(
    [
      stop('Zurich', 'Switzerland', 2),
      stop('Lucerne', 'Switzerland', 2),
      stop('Zermatt', 'Switzerland', 3),
    ],
    '2027-06-10',
  );
  const before = structuredClone(value.stops.slice(0, 2));
  const next = value.stops.map((entry) =>
    entry.name === 'Zermatt' ? { ...entry, arrivalDate: '2027-06-16', arrivalFixed: true } : entry,
  );
  await mockReview(value, 'Arrive Zermatt on 16 June 2027.', { startDate: '2027-06-16' }, next);
  assert.deepEqual(value.stops.slice(0, 2), before);
  assert.equal(value.brief.startDate, '2027-06-10');
  assert.equal(value.stops[2].arrivalDate, '2027-06-16');
});

test('trip matrix mocked AI review: an open-jaw route keeps different first and last destinations', async () => {
  const value = workspace();
  const message =
    'Paris for 3 nights, then Rome for 4 nights. Arrive Paris by flight from Sydney and return home by flight from Rome.';
  await mockReview(
    value,
    message,
    { origin: 'Sydney', outboundTransport: 'flight', returnTransport: 'flight' },
    [stop('Paris', 'France', 3), stop('Rome', 'Italy', 4)],
  );
  assert.deepEqual(
    value.stops.map((entry) => entry.name),
    ['Paris', 'Rome'],
  );
  assert.equal(value.brief.origin, 'Sydney');
  assert.equal(value.brief.outboundTransport, 'flight');
  assert.equal(value.brief.returnTransport, 'flight');
  assert.equal(value.items.length, 0, 'Planning a route does not fabricate a flight quote.');
});

test('trip matrix transport: changing to one way must clear a previously selected return flight', () => {
  const prior = {
    ...newStudioWorkspace().brief,
    outboundTransport: 'flight' as const,
    returnTransport: 'flight' as const,
  };
  const result = ground(
    'Make this one way. No return flight.',
    { returnTransport: 'undecided' },
    prior,
  );
  assert.equal(result.outboundTransport, 'flight');
  assert.equal(result.returnTransport, 'undecided');
});

test('trip matrix supplier contract supports one-way flights without pretending to accept multi-city legs', () => {
  const oneWay = {
    origin: 'SYD',
    destination: 'NRT',
    departureDate: '2027-06-10',
    adults: 1,
    cabinClass: 'economy',
  };
  assert.equal(flightSearchSchema.safeParse(oneWay).success, true);
  assert.equal(
    flightSearchSchema.safeParse({ ...oneWay, legs: [{ origin: 'FCO', destination: 'SYD' }] })
      .success,
    false,
  );
});

test('trip matrix mocked AI review: underspecified warmth and dates do not permit an invented Bali booking brief', async () => {
  const value = workspace();
  await mockReview(
    value,
    'Somewhere warm, but I have not picked a destination or dates.',
    { adults: 2, children: 0, startDate: '2027-06-10', preferredDestination: '' },
    [stop('Bali', 'Indonesia', 7)],
  );
  assert.deepEqual(value.stops, []);
  assert.equal(value.brief.startDate, '');
  assert.equal(value.brief.adults, null);
  assert.equal(value.brief.children, null);
  assert.equal(value.structureAccepted, false);
});

test('trip matrix mocked AI review: negative preferences survive an unrelated invalid model route', async () => {
  const value = workspace([stop('Kyoto', 'Japan', 4)], '2027-05-01');
  const before = structuredClone(value.stops);
  const message = 'No nightclubs or strenuous hikes. Keep gentle gardens and vegetarian meals.';
  await mockReview(
    value,
    message,
    {
      interests: ['gentle gardens'],
      foodPreferences: ['vegetarian'],
      requirements: ['No nightclubs', 'No strenuous hikes'],
    },
    [stop('Tokyo', 'Japan', 2)],
  );
  assert.deepEqual(value.stops, before);
  assert.deepEqual(value.brief.requirements, ['No nightclubs', 'No strenuous hikes']);
  assert.deepEqual(value.brief.interests, ['gentle gardens']);
  assert.deepEqual(value.brief.foodPreferences, ['vegetarian']);
});

test('trip matrix mocked AI review: stay conflict waits for its exact confirmation and retains other facts', async () => {
  const value = workspace(
    [{ ...stop('Rarotonga', 'Cook Islands', 3), arrivalDate: '2027-05-01', arrivalFixed: true }],
    '2027-05-01',
  );
  value.brief.adults = 2;
  const before = structuredClone(value.stops);
  const result = await mockReview(value, 'Return on 6 May 2027, but stay for 3 nights.', {
    endDate: '2027-05-06',
  });
  assert.deepEqual(value.stops, before);
  assert.equal(value.brief.adults, 2);
  assert.equal(value.clarification?.proposedNights, 5);
  value.messages.push({
    id: 'other-question',
    role: 'assistant',
    content: 'Would you like breakfast?',
    createdAt: new Date().toISOString(),
  });
  resolveStudioClarification(value, 'yes', agency);
  assert.deepEqual(value.stops, before);
  value.messages.push({
    id: 'single-confirmation',
    role: 'assistant',
    content: studioStayConfirmation(value)!,
    createdAt: new Date().toISOString(),
  });
  resolveStudioClarification(value, 'yes', agency);
  assert.equal(value.stops[0].nights, 5);
  assert.equal(value.stops[0].departureDate, '2027-05-06');
  assert.equal(value.clarification, null);
  assert.match(result.reply, /5 nights/);
});

test('trip matrix documented route bounds reject oversized stops and routes instead of truncating', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => stop(`Stop ${i}`, 'Japan', 1));
  assert.equal(studioPatchSchema.safeParse({ revision: 1, stops: twenty }).success, true);
  assert.equal(
    studioPatchSchema.safeParse({ revision: 1, stops: [...twenty, stop('Extra', 'Japan', 1)] })
      .success,
    false,
  );
  assert.equal(
    studioPatchSchema.safeParse({ revision: 1, stops: [stop('Tokyo', 'Japan', 121)] }).success,
    false,
  );
});
