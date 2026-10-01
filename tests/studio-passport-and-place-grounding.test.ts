import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundedStudioBrief, assertStudioRouteGrounding } from '../server/studio-grounding.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';

function passport(message: string) {
  const current = newStudioWorkspace().brief;
  return groundedStudioBrief(
    current,
    { ...current, passportNationality: 'AU' },
    [{ field: 'passportNationality', evidence: message }],
    message,
    [],
  ).passportNationality;
}
for (const message of [
  'Five adults, no children, from Melbourne with Australian passports.',
  'Two adults, no children, travelling from Sydney on Australian passports.',
  'No children and we hold Australian passports.',
  'No nightlife and no hotel bookings. We hold Australian passports.',
])
  test(`unrelated negative does not erase an explicit passport: ${message}`, () => {
    assert.equal(passport(message), 'AU');
  });

for (const message of [
  'We do not hold Australian passports.',
  'No Australian passport.',
  'We travel without an Australian passport.',
  'We do not hold Australian passports or British passports.',
  'Australian passports and New Zealand passports.',
])
  test(`negated or mixed passport declarations are not guessed: ${message}`, () => {
    assert.equal(passport(message), '');
  });

test('a positive alternate passport survives a separately negated nationality', () => {
  assert.equal(passport('No Australian passport, only a New Zealand passport.'), 'NZ');
});

test('an explicitly named Ubud stay is not rejected by the broader Bali catalogue match', () => {
  const message =
    'Arrive in Ubud, Bali, Indonesia on 12 November 2026 for four nights, leaving on 16 November.';
  const route = [
    {
      name: 'Ubud',
      country: 'ID',
      nights: 4,
      arrivalDate: '2026-11-12',
      arrivalFixed: true,
      onwardTransport: 'undecided' as const,
      neighbourhood: '',
      notes: '',
    },
  ];
  const context = {
    brief: { ...newStudioWorkspace().brief, startDate: '2026-11-12', endDate: '2026-11-16' },
  };
  assert.doesNotThrow(() => assertStudioRouteGrounding([], route, message, [], message, context));
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding(
      [],
      [{ ...route[0], name: 'Ubud (Bali)' }],
      message,
      [],
      message,
      context,
    ),
  );
  assert.throws(() =>
    assertStudioRouteGrounding(
      [],
      [{ ...route[0], name: 'Sydney' }],
      message,
      [],
      message,
      context,
    ),
  );
  assert.throws(() =>
    assertStudioRouteGrounding([], [{ ...route[0], nights: 5 }], message, [], message, context),
  );
});

for (const verb of ['extend', 'lengthen', 'shorten']) {
  test(`an absolute ${verb} command keeps the destination name separate from the verb`, () => {
    const current = {
      id: 'ubud',
      name: 'Ubud',
      country: 'Indonesia',
      nights: 4,
      arrivalDate: '2026-11-12',
      departureDate: '2026-11-16',
      arrivalFixed: true,
      onwardTransport: 'undecided' as const,
      neighbourhood: '',
      notes: '',
    };
    const nights = verb === 'shorten' ? 3 : 5;
    const endDate = verb === 'shorten' ? '2026-11-15' : '2026-11-17';
    const message = `Please ${verb} Ubud to ${nights} nights and leave on ${endDate}.`;
    const context = { brief: { ...newStudioWorkspace().brief, startDate: '2026-11-12', endDate } };
    assert.doesNotThrow(() =>
      assertStudioRouteGrounding(
        [current],
        [{ ...current, nights }],
        message,
        [],
        message,
        context,
      ),
    );
    assert.throws(() =>
      assertStudioRouteGrounding(
        [current],
        [{ ...current, nights: 9 }],
        message,
        [],
        message,
        context,
      ),
    );
  });
}

for (const name of ['Ubud, Bali', 'Ubud (Bali)']) {
  test(`a unique qualified locality supports a short-name extension: ${name}`, () => {
    const current = {
      id: 'ubud',
      name,
      country: 'Indonesia',
      nights: 4,
      arrivalDate: '2026-11-12',
      departureDate: '2026-11-16',
      arrivalFixed: true,
      onwardTransport: 'undecided' as const,
      neighbourhood: '',
      notes: '',
    };
    const message = 'Please extend Ubud to five nights and leave on 17 November 2026.';
    const context = {
      brief: { ...newStudioWorkspace().brief, startDate: '2026-11-12', endDate: '2026-11-17' },
    };
    assert.doesNotThrow(() =>
      assertStudioRouteGrounding(
        [current],
        [{ ...current, nights: 5 }],
        message,
        [],
        message,
        context,
      ),
    );
    assert.throws(() =>
      assertStudioRouteGrounding(
        [current],
        [{ ...current, nights: 6 }],
        message,
        [],
        message,
        context,
      ),
    );
  });
}
