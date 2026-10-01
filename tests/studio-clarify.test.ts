import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clarifyMessage,
  clarifyQuestions,
  parseAges,
  planClarifyAnswers,
  type ClarifyAnswers,
} from '../shared/studio-clarify';
import type { StudioQuestion } from '../shared/studio';

const ask = (id: string, label = `${id}?`): StudioQuestion => ({
  id,
  label,
  reason: '',
  required: id === 'route',
});
const open = [
  'tripType',
  'returnTransport',
  'startDate',
  'nights',
  'adults',
  'children',
  'budget',
  'hotelStandard',
].map((id) => ask(id));
const empty = { children: null, childAges: [] };

test('picks and values go to the brief in one patch; nothing is sent to Tara', () => {
  const answers: ClarifyAnswers = {
    tripType: { kind: 'option', optionId: 'multiple' },
    returnTransport: { kind: 'option', optionId: 'cruise' },
    startDate: { kind: 'value', value: '2027-06-01' },
    adults: { kind: 'option', optionId: '2' },
    children: { kind: 'option', optionId: '0' },
    hotelStandard: { kind: 'option', optionId: '4-star' },
  };
  const plan = planClarifyAnswers(open, answers, empty);
  assert.deepEqual(plan.brief, {
    tripType: 'multiple',
    returnTransport: 'cruise',
    startDate: '2027-06-01',
    datesFlexible: false,
    adults: 2,
    children: 0,
    childAges: [],
    hotelStandard: '4-star',
  });
  assert.equal(plan.forTara.length, 0);
  assert.equal(clarifyMessage(plan), '');
});

test('written answers become one turn for Tara, with the saved ones alongside for context', () => {
  const plan = planClarifyAnswers(
    open,
    {
      nights: { kind: 'text', text: '4 in Tokyo, 3 in Kyoto' },
      budget: { kind: 'text', text: 'about AUD 12k for the group' },
      adults: { kind: 'option', optionId: '2' },
      hotelStandard: { kind: 'skip' },
    },
    empty,
  );
  assert.deepEqual(plan.brief, { adults: 2 });
  assert.equal(
    clarifyMessage(plan),
    [
      'Answers to your questions:',
      '- Nights or end date: 4 in Tokyo, 3 in Kyoto',
      '- Group budget: about AUD 12k for the group',
      '',
      'Saved to the brief: Adults: 2 adults.',
    ].join('\n'),
  );
});

test('a bare number typed for a head count is saved, not sent to the model', () => {
  const plan = planClarifyAnswers(
    open,
    { adults: { kind: 'text', text: ' 6 ' }, children: { kind: 'text', text: 'two teenagers' } },
    empty,
  );
  assert.deepEqual(plan.brief, { adults: 6 });
  assert.deepEqual(
    plan.forTara.map((line) => line.questionId),
    ['children'],
  );
});

test('the ages question appears after a children answer and goes away with "No children"', () => {
  const two = { children: { kind: 'option', optionId: '2' } } as ClarifyAnswers;
  assert.deepEqual(
    clarifyQuestions(open, two, empty)
      .map((q) => q.id)
      .slice(4, 7),
    ['adults', 'children', 'childAges'],
  );
  const none = { children: { kind: 'option', optionId: '0' } } as ClarifyAnswers;
  assert.ok(
    !clarifyQuestions([...open, ask('childAges')], none, empty).some((q) => q.id === 'childAges'),
  );
});

test('child ages are saved only when they match the head count', () => {
  const answers: ClarifyAnswers = {
    children: { kind: 'option', optionId: '2' },
    childAges: { kind: 'value', value: '6 and 9' },
  };
  assert.deepEqual(planClarifyAnswers(open, answers, empty).brief, {
    children: 2,
    childAges: [6, 9],
  });
  const short = { ...answers, childAges: { kind: 'value' as const, value: '6' } };
  const plan = planClarifyAnswers(open, short, empty);
  assert.deepEqual(plan.brief, { children: 2 });
  assert.deepEqual(
    plan.forTara.map((line) => line.questionId),
    ['childAges'],
  );
  assert.equal(parseAges('6, 19'), null);
});

test('a recognised passport country is saved as its code; anything else goes to Tara', () => {
  const questions = [ask('passportNationality')];
  assert.deepEqual(
    planClarifyAnswers(
      questions,
      { passportNationality: { kind: 'value', value: 'Australia' } },
      empty,
    ).brief,
    { passportNationality: 'AU' },
  );
  const plan = planClarifyAnswers(
    questions,
    { passportNationality: { kind: 'value', value: 'Narnia' } },
    empty,
  );
  assert.deepEqual(plan.brief, {});
  assert.equal(plan.forTara.length, 1);
});

test('answers to questions the server no longer asks are ignored', () => {
  const plan = planClarifyAnswers(
    [ask('budget')],
    { adults: { kind: 'option', optionId: '3' } },
    empty,
  );
  assert.deepEqual(plan, { brief: {}, saved: [], forTara: [] });
});

test('nights set per stop patch the route, not the model', () => {
  const stop = (id: string, name: string) => ({
    id,
    name,
    country: 'JP',
    nights: null,
    arrivalDate: '',
    departureDate: '',
    onwardTransport: 'undecided' as const,
    neighbourhood: '',
    notes: '',
  });
  const route = [stop('a', 'Tokyo'), stop('b', 'Kyoto')];
  const plan = planClarifyAnswers(
    open,
    {
      nights: {
        kind: 'nights',
        stops: [
          { id: 'a', name: 'Tokyo', nights: 4 },
          { id: 'b', name: 'Kyoto', nights: 3 },
        ],
      },
    },
    empty,
    route,
  );
  assert.deepEqual(
    plan.stops?.map((s) => [s.name, s.nights]),
    [
      ['Tokyo', 4],
      ['Kyoto', 3],
    ],
  );
  assert.equal(plan.saved[0].value, 'Tokyo 4 nights, Kyoto 3 nights');
  assert.equal(clarifyMessage(plan), '');
  // A route rebuilt since the answer was given leaves nothing to apply.
  const stale = planClarifyAnswers(
    open,
    { nights: { kind: 'nights', stops: [{ id: 'gone', name: 'Osaka', nights: 2 }] } },
    empty,
    route,
  );
  assert.equal(stale.stops, undefined);
  assert.equal(stale.saved.length, 0);
});
