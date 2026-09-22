import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundedStudioBrief, assertStudioRouteGrounding } from '../server/studio-grounding.ts';
import { newStudioWorkspace, StudioError } from '../server/studio-store.ts';
import type { StudioBrief, StudioStop } from '../shared/studio.ts';

const brief = () => newStudioWorkspace().brief;
const stop = (name: string, nights: number | null = 4, country = ''): StudioStop => ({
  id: name,
  name,
  country,
  nights,
  arrivalDate: '',
  arrivalFixed: false,
  departureDate: '',
  onwardTransport: 'undecided',
  neighbourhood: '',
  notes: '',
});
const fact = (field: keyof StudioBrief, evidence: string) => ({ field, evidence });
const afterQuestion = (content: string) => ({
  messages: [{ role: 'assistant' as const, content }],
});

test('literal evidence cannot turn two adults into ninety-nine or infer zero children', () => {
  const current = brief();
  const result = groundedStudioBrief(
    current,
    { ...current, adults: 99, children: 0, budget: 1500 },
    [fact('adults', 'two adults'), fact('children', 'two adults'), fact('budget', 'AUD 1500')],
    'There are two adults. Plan London.',
    [],
  );
  assert.equal(result.adults, 2);
  assert.equal(result.children, null);
  assert.equal(result.budget, null);
});

test('explicit adult-only party and natural child ages are retained without invented passengers', () => {
  const current = brief();
  const message = 'Two adults and two children aged eight and twelve.';
  const result = groundedStudioBrief(
    current,
    { ...current, adults: 80, children: 7, childAges: [1, 2] },
    [
      fact('adults', 'Two adults'),
      fact('children', 'two children'),
      fact('childAges', 'aged eight and twelve'),
    ],
    message,
    [],
  );
  assert.equal(result.adults, 2);
  assert.equal(result.children, 2);
  assert.deepEqual(result.childAges, [8, 12]);
  const adultOnly = groundedStudioBrief(
    result,
    { ...result, children: 8 },
    [fact('children', 'no children')],
    'This time, no children.',
    [],
  );
  assert.equal(adultOnly.children, 0);
  assert.deepEqual(adultOnly.childAges, []);
});

test('short numeric answers fill only the field established by the prior question', () => {
  const current = brief();
  assert.equal(
    groundedStudioBrief(
      current,
      { ...current, adults: 99 },
      [fact('adults', 'Two')],
      'Two',
      [],
      afterQuestion('How many adults are travelling?'),
    ).adults,
    2,
  );
  assert.equal(
    groundedStudioBrief(current, { ...current, adults: 2 }, [fact('adults', 'Two')], 'Two', [])
      .adults,
    null,
  );
  assert.equal(
    groundedStudioBrief(
      current,
      { ...current, adults: 2 },
      [fact('adults', 'London')],
      'London',
      [],
    ).adults,
    null,
  );
  assert.equal(
    groundedStudioBrief(
      current,
      { ...current, adults: 2 },
      [fact('adults', 'Two adults')],
      'London',
      [],
    ).adults,
    null,
  );
});

test('forged price and currency are corrected from an explicit group budget', () => {
  const current = brief();
  const message = 'Our group budget is AUD three thousand.';
  const result = groundedStudioBrief(
    current,
    { ...current, budget: 5000, currency: 'USD' },
    [fact('budget', 'AUD three thousand'), fact('currency', 'AUD')],
    message,
    [],
  );
  assert.equal(result.budget, 3000);
  assert.equal(result.currency, 'AUD');
  const amountOnly = groundedStudioBrief(
    current,
    { ...current, budget: 7000 },
    [fact('budget', '$3,500')],
    'Budget $3,500.',
    [],
  );
  assert.equal(amountOnly.budget, 3500);
  assert.equal(amountOnly.currency, 'AUD');
});

test('per-person and per-day budgets retain their basis until every multiplier is confirmed', () => {
  const current = brief();
  const proposed = { ...current, budget: 6000, currency: 'AUD' };
  const message = 'Budget AUD 3000 per person.';
  const unconfirmed = groundedStudioBrief(
    current,
    proposed,
    [fact('budget', 'AUD 3000')],
    message,
    [],
  );
  assert.equal(unconfirmed.budget, null);
  assert.match(
    unconfirmed.requirements.join(' '),
    /AUD 3000 per person; group total not confirmed/,
  );
  const party = { ...current, adults: 2, children: 0 };
  const confirmed = groundedStudioBrief(
    party,
    { ...party, budget: 99 },
    [fact('budget', 'AUD 3000')],
    message,
    [],
  );
  assert.equal(confirmed.budget, 6000);
  const daily = groundedStudioBrief(
    party,
    { ...party, budget: 99 },
    [fact('budget', 'AUD 100')],
    'Budget AUD 100 per person per day for four days.',
    [],
  );
  assert.equal(daily.budget, 800);
  const unknownDays = groundedStudioBrief(
    party,
    { ...party, budget: 99 },
    [fact('budget', 'AUD 100')],
    'Budget AUD 100 per day.',
    [],
  );
  assert.equal(unknownDays.budget, null);
});

test('changing only currency never relabels a previously confirmed budget as converted money', () => {
  const current = { ...brief(), budget: 3000, currency: 'AUD' };
  const result = groundedStudioBrief(
    current,
    { ...current, currency: 'USD' },
    [fact('currency', 'USD')],
    'Use USD.',
    [],
  );
  assert.equal(result.currency, 'USD');
  assert.equal(result.budget, null);
});

test('arrival and return dates are read from explicit natural dates instead of model values', () => {
  const current = brief();
  const message = 'Arrive on 18th November 2026 and return on November 25, 2026.';
  const result = groundedStudioBrief(
    current,
    { ...current, startDate: '2027-01-01', endDate: '2027-01-10' },
    [fact('startDate', '18th November 2026'), fact('endDate', 'November 25, 2026')],
    message,
    [],
  );
  assert.equal(result.startDate, '2026-11-18');
  assert.equal(result.endDate, '2026-11-25');
  const missingYear = groundedStudioBrief(
    current,
    { ...current, startDate: '2026-11-18' },
    [fact('startDate', '18 November')],
    'Arrive 18 November.',
    [],
  );
  assert.equal(missingYear.startDate, '');
  const invalidDate = groundedStudioBrief(
    current,
    { ...current, startDate: '2026-03-02' },
    [fact('startDate', '30 February 2026')],
    'Arrive 30 February 2026.',
    [],
  );
  assert.equal(invalidDate.startDate, '');
});

test('Australian date forms and short date answers work without treating outbound flight departure as arrival', () => {
  const current = brief();
  const message = 'Depart Sydney on 2026-11-17. Arrive Paris on 2026-11-18.';
  const flight = groundedStudioBrief(
    current,
    { ...current, startDate: '2026-11-17' },
    [fact('startDate', '2026-11-18')],
    message,
    [],
  );
  assert.equal(flight.startDate, '2026-11-18');
  const short = groundedStudioBrief(
    current,
    { ...current, endDate: '2027-01-01' },
    [fact('endDate', '25/11/2026')],
    '25/11/2026',
    [],
    afterQuestion('What is the return date?'),
  );
  assert.equal(short.endDate, '2026-11-25');
});

test('a short no answer confirms zero children only when children were unambiguously asked about', () => {
  const current = { ...brief(), children: 2, childAges: [8, 12] };
  for (const answer of ['no', 'none', 'nope', 'No thanks.']) {
    const result = groundedStudioBrief(
      current,
      { ...current, children: 99 },
      [fact('children', answer)],
      answer,
      [],
      afterQuestion('Noted: 2 adults. Are any children travelling this time?'),
    );
    assert.equal(result.children, 0, answer);
    assert.deepEqual(result.childAges, [], answer);
  }
  for (const question of [
    'Any hotel preferences?',
    'Are there adults or children?',
    'Any children, and are dates flexible?',
  ]) {
    const result = groundedStudioBrief(
      current,
      { ...current, children: 0 },
      [fact('children', 'no')],
      'no',
      [],
      afterQuestion(question),
    );
    assert.equal(result.children, 2, question);
    assert.deepEqual(result.childAges, [8, 12], question);
  }
  assert.equal(
    groundedStudioBrief(
      current,
      { ...current, children: 0 },
      [],
      'no',
      [],
      afterQuestion('Any children travelling?'),
    ).children,
    2,
    'the model still needs a literal field fact',
  );
  assert.equal(
    groundedStudioBrief(
      brief(),
      { ...brief(), children: 1 },
      [fact('children', 'yes')],
      'yes',
      [],
      afterQuestion('Any children travelling?'),
    ).children,
    null,
    'yes does not establish a count',
  );
});

test('flexible and fixed date answers use the latest date question without treating budget flexibility as travel dates', () => {
  const current = brief();
  const question = afterQuestion(
    'Noted: no children. What is the arrival date, or are dates flexible?',
  );
  const flexible = groundedStudioBrief(
    current,
    { ...current, datesFlexible: false },
    [fact('datesFlexible', 'flexible')],
    'flexible',
    [],
    question,
  );
  assert.equal(flexible.datesFlexible, true);
  assert.equal(
    groundedStudioBrief(
      current,
      { ...current, datesFlexible: true },
      [fact('datesFlexible', 'flexible')],
      'flexible',
      [],
      afterQuestion('What are your preferred travel dates?'),
    ).datesFlexible,
    true,
  );
  const fixed = groundedStudioBrief(
    flexible,
    flexible,
    [fact('datesFlexible', 'fixed')],
    'fixed',
    [],
    question,
  );
  assert.equal(fixed.datesFlexible, false);
  for (const message of ['flexible', 'not fixed']) {
    const result = groundedStudioBrief(
      current,
      { ...current, datesFlexible: true },
      [fact('datesFlexible', message)],
      message,
      [],
      afterQuestion('Is the group budget flexible?'),
    );
    assert.equal(result.datesFlexible, false, message);
  }
  const olderDateQuestion = groundedStudioBrief(
    current,
    { ...current, datesFlexible: true },
    [fact('datesFlexible', 'flexible')],
    'flexible',
    [],
    {
      messages: [
        ...question.messages,
        { role: 'user', content: '2026-11-18' },
        { role: 'assistant', content: 'What is the budget?' },
      ],
    },
  );
  assert.equal(olderDateQuestion.datesFlexible, false);
});

test('bare numeric answers cannot leak between budget, adults, child ages and ambiguous combined questions', () => {
  const current = { ...brief(), children: 1 };
  const facts = [fact('budget', '12'), fact('adults', '12'), fact('childAges', '12')];
  const proposed = { ...current, budget: 12, adults: 12, childAges: [12] };
  const budget = groundedStudioBrief(
    current,
    proposed,
    facts,
    '12',
    [],
    afterQuestion('Is there a group budget or price point?'),
  );
  assert.equal(budget.budget, 12);
  assert.equal(budget.adults, null);
  assert.deepEqual(budget.childAges, []);
  const adults = groundedStudioBrief(
    current,
    proposed,
    facts,
    '12',
    [],
    afterQuestion('How many adults are travelling?'),
  );
  assert.equal(adults.adults, 12);
  assert.equal(adults.budget, null);
  assert.deepEqual(adults.childAges, []);
  const ages = groundedStudioBrief(
    current,
    proposed,
    facts,
    '12',
    [],
    afterQuestion('What are the ages of all children?'),
  );
  assert.deepEqual(ages.childAges, [12]);
  assert.equal(ages.adults, null);
  assert.equal(ages.budget, null);
  const ambiguous = groundedStudioBrief(
    current,
    proposed,
    facts,
    '12',
    [],
    afterQuestion('How many nights and adults should I plan for?'),
  );
  assert.equal(ambiguous.adults, null);
  assert.equal(ambiguous.budget, null);
  assert.deepEqual(ambiguous.childAges, []);
});

test('a short date answer uses the prior arrival or return question and cannot fill both dates', () => {
  const current = brief();
  const facts = [fact('startDate', '18 November 2026'), fact('endDate', '18 November 2026')];
  const proposed = { ...current, startDate: '2026-11-18', endDate: '2026-11-18' };
  const arrival = groundedStudioBrief(
    current,
    proposed,
    facts,
    '18 November 2026',
    [],
    afterQuestion('When will you arrive, and how many nights?'),
  );
  assert.equal(arrival.startDate, '2026-11-18');
  assert.equal(arrival.endDate, '');
  const unprompted = groundedStudioBrief(current, proposed, facts, '18 November 2026', []);
  assert.equal(unprompted.startDate, '');
  assert.equal(unprompted.endDate, '');
  const ambiguous = groundedStudioBrief(
    current,
    proposed,
    facts,
    '18 November 2026',
    [],
    afterQuestion('What are the arrival and return dates?'),
  );
  assert.equal(ambiguous.startDate, '');
  assert.equal(ambiguous.endDate, '');
});

test('critical facts may use supplied documents but never absent prior-client assumptions', () => {
  const current = brief();
  const document = 'This booking is for three adults and no children. Budget AUD 9000.';
  const result = groundedStudioBrief(
    current,
    { ...current, adults: 5, children: 1, budget: 999 },
    [fact('adults', 'three adults'), fact('children', 'no children'), fact('budget', 'AUD 9000')],
    'Use the reviewed source.',
    [document],
  );
  assert.equal(result.adults, 3);
  assert.equal(result.children, 0);
  assert.equal(result.budget, 9000);
  const missing = groundedStudioBrief(
    current,
    { ...current, adults: 2 },
    [fact('adults', 'Last time there were two adults')],
    'A new trip for this client.',
    [],
  );
  assert.equal(missing.adults, null);
});

test('the real 28-day Paris-Berlin-London intake retains its facts and exact route', () => {
  const current = brief();
  const message =
    'Plan a 28-day European proposal for a fictional client: 2 adults, no children. Arrive Paris, France on 2026-11-18: Paris 9 nights, Berlin, Germany 9 nights, and London, United Kingdom 9 nights. Group budget AUD 12000. Prefer 4-star hotels near railway stations and quiet cultural visits. Start with the route only.';
  const proposed = {
    ...current,
    adults: 2,
    children: 0,
    startDate: '2026-11-18',
    budget: 12000,
    currency: 'AUD',
  };
  const result = groundedStudioBrief(
    current,
    proposed,
    [
      fact('adults', '2 adults'),
      fact('children', 'no children'),
      fact('startDate', '2026-11-18'),
      fact('budget', 'AUD 12000'),
      fact('currency', 'AUD'),
    ],
    message,
    [],
  );
  assert.equal(result.adults, 2);
  assert.equal(result.children, 0);
  assert.equal(result.budget, 12000);
  assert.equal(result.currency, 'AUD');
  assert.equal(result.startDate, '2026-11-18');
  const route = [
    stop('Paris', 9, 'France'),
    stop('Berlin', 9, 'Germany'),
    stop('London', 9, 'United Kingdom'),
  ];
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding(
      [],
      route,
      message,
      [],
      'Paris 9 nights, Berlin, Germany 9 nights, and London, United Kingdom 9 nights',
    ),
  );
});

test('a model cannot introduce an unsupported fixed arrival or leave a superseded per-person basis', () => {
  const route = [stop('London', 4)];
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        route,
        [{ ...route[0], arrivalDate: '2027-02-03', arrivalFixed: true }],
        'Two adults.',
        [],
        'Two adults',
      ),
    StudioError,
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        [],
        [{ ...route[0], arrivalDate: '2027-02-03', arrivalFixed: true }],
        'Plan London for 4 nights.',
        [],
        'London for 4 nights',
      ),
    StudioError,
  );
  const current = {
    ...brief(),
    requirements: ['Budget basis: AUD 3000 per person; group total not confirmed.'],
  };
  const result = groundedStudioBrief(
    current,
    { ...current, budget: 5000 },
    [fact('budget', 'AUD 4000')],
    'The total group budget is AUD 4000.',
    [],
  );
  assert.equal(result.budget, 4000);
  assert.equal(
    result.requirements.some((value) => value.startsWith('Budget basis:')),
    false,
  );
});

test('London evidence cannot justify Bali, missing named stops, a different country or forged nights', () => {
  assert.throws(
    () => assertStudioRouteGrounding([], [stop('Bali')], 'Plan 4 nights in London.', [], 'London'),
    StudioError,
  );
  assert.throws(
    () => assertStudioRouteGrounding([], [stop('London')], 'Plan London and Berlin.', [], 'London'),
    StudioError,
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        [],
        [stop('Paris', 9, 'Brazil')],
        'Paris, France 9 nights.',
        [],
        'Paris',
      ),
    StudioError,
  );
  assert.throws(
    () => assertStudioRouteGrounding([], [stop('London', 90)], 'London 4 nights.', [], 'London'),
    StudioError,
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        [],
        [stop('Berlin'), stop('London')],
        'Plan London and Berlin.',
        [],
        'London and Berlin',
      ),
    StudioError,
  );
});

test('transport changes preserve nights, while explicit relative night adjustments are checked', () => {
  const current = [stop('London', 4)];
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding(
      current,
      [{ ...current[0], onwardTransport: 'train' }],
      'London train please.',
      [],
      'London train please',
    ),
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        current,
        [{ ...current[0], nights: 99, onwardTransport: 'train' }],
        'London train please.',
        [],
        'London train please',
      ),
    StudioError,
  );
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding(
      current,
      [{ ...current[0], nights: 6 }],
      'Extend London by two nights.',
      [],
      'Extend London by two nights',
    ),
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        current,
        [{ ...current[0], nights: 99 }],
        'Extend London by two nights.',
        [],
        'Extend London by two nights',
      ),
    StudioError,
  );
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding(
      current,
      [{ ...current[0], nights: 3 }],
      'Shorten London by one night.',
      [],
      'Shorten London by one night',
    ),
  );
  const fixed = [{ ...current[0], arrivalDate: '2026-11-18', arrivalFixed: true }];
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding(
      fixed,
      [{ ...fixed[0], onwardTransport: 'train' }],
      'London train please.',
      [],
      'London train please',
    ),
  );
});

test('London intake accepts combined arrival and night answers after a destination-only turn', () => {
  const current = [stop('London', null, 'United Kingdom')];
  assert.doesNotThrow(() => assertStudioRouteGrounding([], current, 'to london', [], 'to london'));
  for (const message of [
    '18 November 2026, for 3 nights',
    '2026-11-18 and three nights please',
    'Arriving on November 18, 2026 and staying for 3 nights.',
  ]) {
    assert.doesNotThrow(
      () =>
        assertStudioRouteGrounding(
          current,
          [{ ...current[0], nights: 3, arrivalDate: '2026-11-18', arrivalFixed: true }],
          message,
          [],
          message,
          { brief: { ...brief(), startDate: '2026-11-18' } },
        ),
      message,
    );
    assert.throws(
      () =>
        assertStudioRouteGrounding(current, [{ ...current[0], nights: 30 }], message, [], message),
      StudioError,
      message,
    );
  }
});

test('date-only route answers preserve nights and allow a literal fixed arrival', () => {
  const current = [stop('London', 3)];
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding(
      current,
      [{ ...current[0], arrivalDate: '2026-11-18', arrivalFixed: true }],
      '18 November 2026',
      [],
      '18 November 2026',
    ),
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        current,
        [{ ...current[0], nights: 18, arrivalDate: '2026-11-18', arrivalFixed: true }],
        '18 November 2026',
        [],
        '18 November 2026',
      ),
    StudioError,
  );
});

test('bare night counts require the prior assistant question and a single unambiguous stop', () => {
  const current = [stop('London', null)];
  const messages = [
    { role: 'user' as const, content: 'to london' },
    { role: 'assistant' as const, content: 'How many nights would you like in London?' },
  ];
  for (const message of ['3', 'three'])
    assert.doesNotThrow(() =>
      assertStudioRouteGrounding(current, [{ ...current[0], nights: 3 }], message, [], message, {
        messages,
      }),
    );
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding(current, [{ ...current[0], nights: 3 }], '3', [], '3', {
      messages: [{ role: 'assistant', content: 'Noted: 2 adults. How many nights in London?' }],
    }),
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding(current, [{ ...current[0], nights: 3 }], '3', [], '3', {
        messages: [{ role: 'assistant', content: 'How many nights and adults should I plan for?' }],
      }),
    StudioError,
  );
  assert.throws(
    () => assertStudioRouteGrounding(current, [{ ...current[0], nights: 3 }], '3', [], '3'),
    StudioError,
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding(current, [{ ...current[0], nights: 3 }], '3', [], '3', {
        messages: [{ role: 'assistant', content: 'How many adults are travelling?' }],
      }),
    StudioError,
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        current,
        [{ ...current[0], nights: 18 }],
        '2026-11-18',
        [],
        '2026-11-18',
        { messages },
      ),
    StudioError,
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        [...current, stop('Paris', null)],
        [{ ...current[0], nights: 3 }, stop('Paris', null)],
        '3',
        [],
        '3',
        { messages },
      ),
    StudioError,
  );
});

test('initial routes may use previous user destinations and grounded brief dates, never assistant inventions', () => {
  const messages = [
    { role: 'user' as const, content: 'hi' },
    { role: 'assistant' as const, content: 'Where would your client like to travel?' },
    { role: 'user' as const, content: 'to london' },
    { role: 'assistant' as const, content: 'What is the arrival date and how many nights?' },
  ];
  const proposed = [{ ...stop('London', 3), arrivalDate: '2026-11-18', arrivalFixed: true }];
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding([], proposed, '18 November 2026, 3 nights', [], '3 nights', {
      messages,
    }),
  );
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding([], proposed, '3 nights', [], 'to london', {
      messages,
      brief: { ...brief(), startDate: '2026-11-18' },
    }),
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding([], [stop('Bali', 3)], '3 nights', [], '3 nights', { messages }),
    StudioError,
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding([], [stop('London', 30)], '3 nights', [], '3 nights', {
        messages,
      }),
    StudioError,
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding([], [stop('Bali', 3)], '3 nights', [], '3 nights', {
        messages: [...messages, { role: 'assistant', content: 'Bali might be nice.' }],
      }),
    StudioError,
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding([], [stop('London', 3)], '3 nights', [], '3 nights', {
        messages: [
          ...messages,
          { role: 'user', content: 'Actually, change the destination to Paris.' },
        ],
      }),
    StudioError,
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        [],
        [stop('London', 3)],
        '3 nights',
        [],
        'Invented source excerpt',
        { messages },
      ),
    StudioError,
  );
});

test('new stops need literal stay lengths and another destination’s nights cannot change the saved stop', () => {
  assert.throws(
    () => assertStudioRouteGrounding([], [stop('London', 3)], 'to london', [], 'to london'),
    StudioError,
  );
  const current = [stop('London', 3)];
  for (const message of ['Berlin for 5 nights', '5 nights in Berlin', 'Add 5 nights'])
    assert.throws(
      () => assertStudioRouteGrounding(current, [stop('London', 5)], message, [], message),
      StudioError,
      message,
    );
});

test('unrelated answers preserve the route, while requested replacement, ordering and route ideas are allowed', () => {
  const current = [stop('Paris', 4, 'France'), stop('London', 4, 'United Kingdom')];
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding(current, structuredClone(current), 'Two adults.', [], ''),
  );
  assert.throws(
    () => assertStudioRouteGrounding(current, [stop('Bali')], 'Two adults.', [], 'Two adults'),
    StudioError,
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        current,
        [...current].reverse(),
        'Review the brief.',
        [],
        'Review the brief',
      ),
    StudioError,
  );
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding(
      current,
      [...current].reverse(),
      'Move London before Paris.',
      [],
      'Move London before Paris',
    ),
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        current,
        [{ ...current[0], nights: 5 }, current[1]],
        'Move London before Paris.',
        [],
        'Move London before Paris',
      ),
    StudioError,
  );
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding(
      current,
      [stop('Osaka', 6, 'Japan')],
      'Change the trip to Osaka for 6 nights.',
      [],
      'Osaka for 6 nights',
    ),
  );
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding(
      [],
      [stop('Kanazawa', 3, 'Japan'), stop('Takayama', 3, 'Japan')],
      'Suggest a route with two Japanese cities.',
      [],
      'Suggest a route',
    ),
  );
});
