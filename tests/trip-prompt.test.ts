import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTripPrompt } from '../shared/trip-prompt';
import type { TripDates, TripParty } from '../shared/trip-details';

const party = (adults: number, children = 0): TripParty => ({ adults, children });
const on = (start: string, end = ''): TripDates => ({ mode: 'specific', start, end });
const monthsFrom = (start: string, end = ''): TripDates => ({ mode: 'flexible', start, end });

test('home chips do not append a second party size to an explicit London request', () => {
  const message = 'Plan 4 days in London starting 2027-05-10 for 2 adults with a $2400 budget.';
  assert.equal(buildTripPrompt(message, { party: party(6), dates: on('2027-06-20') }), message);
});

test('explicit party wording wins over the chip, including mixed adults and children', () => {
  for (const wording of [
    'for 3 travelers',
    'for four travellers',
    'for 2 adults and 1 child',
    'for a family of five',
    'for the two of us',
    'for a group of 8',
    'for two',
    'for two with food and culture',
    'as a solo trip',
    'just me',
    'for a couple',
    'for my partner and me',
  ]) {
    const message = `Plan 4 days in London ${wording}`;
    assert.equal(buildTripPrompt(message, { party: party(2) }), message, wording);
  }
});

test('explicit dates and flexible timing do not receive a conflicting selection', () => {
  for (const timing of [
    'starting 2027-05-10',
    'from 10/05/2027',
    'on May 10, 2027',
    'from 10 May to 14 May',
    'starting 10th of September',
    'in late October',
    'for a November getaway',
    'September 2027',
    'next weekend',
    'on Friday',
    'in two months',
    'during the summer',
    'tomorrow',
    'with flexible dates',
    'with no fixed date',
    'with no dates yet',
  ]) {
    const message = `London for 3 adults ${timing}`;
    assert.equal(
      buildTripPrompt(message, { party: party(2), dates: on('2027-06-20') }),
      message,
      timing,
    );
  }
});

test('chip answers still supplement requests that leave the party or the dates open', () => {
  const defaults = { party: party(5), dates: on('2027-06-20') };
  assert.equal(
    buildTripPrompt('  A food trip to London  ', defaults),
    'A food trip to London for 5 adults starting 2027-06-20',
  );
  assert.equal(
    buildTripPrompt('London for 3 adults', defaults),
    'London for 3 adults starting 2027-06-20',
  );
  assert.equal(
    buildTripPrompt('London starting 2027-05-10', defaults),
    'London starting 2027-05-10 for 5 adults',
  );
  assert.equal(
    buildTripPrompt('I may want London for 5 days and $1.50 coffees', defaults),
    'I may want London for 5 days and $1.50 coffees for 5 adults starting 2027-06-20',
  );
  assert.equal(
    buildTripPrompt('London for a week', { party: party(3) }),
    'London for a week for 3 adults',
  );
  assert.equal(buildTripPrompt('   ', defaults), '');
});

test('children are carried across as their own count, not folded into a total', () => {
  assert.equal(
    buildTripPrompt('A food trip to London', { party: party(2, 1) }),
    'A food trip to London for 2 adults, 1 child',
  );
  assert.equal(
    buildTripPrompt('A food trip to London', { party: party(2, 3) }),
    'A food trip to London for 2 adults, 3 children',
  );
  assert.equal(
    buildTripPrompt('A food trip to London', { party: party(1) }),
    'A food trip to London for 1 adult',
  );
});

test('a trip is stated as a span at either grain, days or months', () => {
  assert.equal(
    buildTripPrompt('A food trip to London', { dates: on('2027-06-20', '2027-06-27') }),
    'A food trip to London from 2027-06-20 to 2027-06-27',
  );
  /* A range of one day is a start date, not a same-day return. */
  assert.equal(
    buildTripPrompt('A food trip to London', { dates: on('2027-06-20', '2027-06-20') }),
    'A food trip to London starting 2027-06-20',
  );
  assert.equal(
    buildTripPrompt('A food trip to London', { dates: monthsFrom('2026-10') }),
    'A food trip to London with flexible dates in October 2026',
  );
  /* Two months are the two ends of one trip, not two candidate trips: the brief has to say leaving
     and returning, or the planner reads a December-or-January choice where the client meant a
     holiday over the new year. */
  assert.equal(
    buildTripPrompt('A food trip to London', { dates: monthsFrom('2026-12', '2027-01') }),
    'A food trip to London with flexible dates, leaving in December 2026 and returning in January 2027',
  );
  /* A span of one month is a month, not a same-month round trip worth spelling out twice. */
  assert.equal(
    buildTripPrompt('A food trip to London', { dates: monthsFrom('2026-10', '2026-10') }),
    'A food trip to London with flexible dates in October 2026',
  );
});

test('an untouched chip never appends an invented answer', () => {
  assert.equal(
    buildTripPrompt('I would like help with a holiday', {}),
    'I would like help with a holiday',
  );
  assert.equal(
    buildTripPrompt('A food trip to London', { dates: on('2027-06-20') }),
    'A food trip to London starting 2027-06-20',
  );
  /* The shapes that mean "opened it, chose nothing": a span with no departure, in either grain.
     Neither is a constraint, so neither reaches the brief. */
  assert.equal(
    buildTripPrompt('A food trip to London', { dates: monthsFrom('') }),
    'A food trip to London',
  );
  assert.equal(
    buildTripPrompt('A food trip to London', { dates: on('') }),
    'A food trip to London',
  );
  assert.equal(
    buildTripPrompt('A food trip to London', { party: { adults: Number.NaN, children: 0 } }),
    'A food trip to London',
  );
  assert.equal(
    buildTripPrompt('A food trip to London', { party: party(0) }),
    'A food trip to London',
  );
  assert.equal(
    buildTripPrompt('A food trip to London', { party: party(2, 99) }),
    'A food trip to London',
  );
});
