import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTripPrompt } from '../shared/trip-prompt';

test('home form does not append a second party size to an explicit London request', () => {
  const message = 'Plan 4 days in London starting 2027-05-10 for 2 adults with a $2400 budget.';
  assert.equal(buildTripPrompt(message, { travelers: 6, startDate: '2027-06-20' }), message);
});

test('explicit party wording wins over the form default, including mixed adults and children', () => {
  for (const party of [
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
    const message = `Plan 4 days in London ${party}`;
    assert.equal(buildTripPrompt(message, { travelers: 2 }), message, party);
  }
});

test('explicit dates and flexible timing do not receive a conflicting selected date', () => {
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
      buildTripPrompt(message, { travelers: 2, startDate: '2027-06-20' }),
      message,
      timing,
    );
  }
});

test('form details still supplement requests that leave party size or dates open', () => {
  const defaults = { travelers: 5, startDate: '2027-06-20' };
  assert.equal(
    buildTripPrompt('  A food trip to London  ', defaults),
    'A food trip to London for 5 travelers starting 2027-06-20',
  );
  assert.equal(
    buildTripPrompt('London for 3 adults', defaults),
    'London for 3 adults starting 2027-06-20',
  );
  assert.equal(
    buildTripPrompt('London starting 2027-05-10', defaults),
    'London starting 2027-05-10 for 5 travelers',
  );
  assert.equal(
    buildTripPrompt('I may want London for 5 days and $1.50 coffees', defaults),
    'I may want London for 5 days and $1.50 coffees for 5 travelers starting 2027-06-20',
  );
  assert.equal(
    buildTripPrompt('London for a week', { travelers: 3 }),
    'London for a week for 3 travelers',
  );
  assert.equal(buildTripPrompt('   ', defaults), '');
});

test('an untouched party selector never appends an invented traveller count', () => {
  assert.equal(
    buildTripPrompt('I would like help with a holiday', {}),
    'I would like help with a holiday',
  );
  assert.equal(
    buildTripPrompt('A food trip to London', { startDate: '2027-06-20' }),
    'A food trip to London starting 2027-06-20',
  );
  assert.equal(
    buildTripPrompt('A food trip to London', { travelers: Number.NaN }),
    'A food trip to London',
  );
});
