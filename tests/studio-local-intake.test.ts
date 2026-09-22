import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStudioAgency } from '../shared/studio.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { reviewStudioBrief } from '../server/studio-models.ts';

let previousKey: string | undefined;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async () => {
    throw new Error('Local intake must not make a network request.');
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousKey;
});

const review = (value: ReturnType<typeof newStudioWorkspace>, message: string) =>
  reviewStudioBrief(value, message, defaultStudioAgency());

// The API stores each pair after review; exercise that same conversational context.
async function converse(value: ReturnType<typeof newStudioWorkspace>, message: string) {
  const result = await review(value, message);
  const createdAt = new Date().toISOString();
  value.messages.push(
    { id: `${value.messages.length}-user`, role: 'user', content: message, createdAt },
    {
      id: `${value.messages.length}-assistant`,
      role: 'assistant',
      content: result.reply,
      createdAt,
    },
  );
  return result;
}

test('a greeting asks for a destination without claiming details were saved or changing the blank brief', async () => {
  const value = newStudioWorkspace();
  const brief = structuredClone(value.brief);
  const result = await converse(value, 'hi');
  assert.equal(result.mode, 'local');
  assert.match(result.reply, /^Hi!/);
  assert.match(result.reply, /Where would you like the client to travel\?/);
  assert.doesNotMatch(result.reply, /saved|noted|continue to the route/i);
  assert.deepEqual(value.brief, brief);
  assert.deepEqual(value.stops, []);
});

test('local conversation progresses from a greeting through a short client brief', async () => {
  const value = newStudioWorkspace();
  await converse(value, 'hi');
  const destination = await converse(value, 'Paris');
  assert.equal(value.stops[0].name, 'Paris');
  assert.match(destination.reply, /Noted: Paris\. How many nights would you like in Paris\?/);
  const nights = await converse(value, '3 nights');
  assert.equal(value.stops[0].nights, 3);
  assert.match(nights.reply, /How many adults/);
  const adults = await converse(value, '2 adults');
  assert.equal(value.brief.adults, 2);
  assert.equal(value.brief.children, null);
  assert.match(adults.reply, /children/);
  const children = await converse(value, 'no children');
  assert.equal(value.brief.children, 0);
  assert.match(children.reply, /arrival date, or are dates flexible/);
  const dates = await converse(value, 'dates flexible');
  assert.equal(value.brief.datesFlexible, true);
  assert.match(dates.reply, /group budget/);
  const budget = await converse(value, 'budget AUD3000');
  assert.equal(value.brief.budget, 3000);
  assert.equal(value.brief.currency, 'AUD');
  assert.match(budget.reply, /group budget AUD 3000/);
  assert.match(budget.reply, /hotel standard/);
  assert.equal(value.stops.length, 1);
  assert.equal(value.stops[0].nights, 3);
});

test('short answers use only the last targeted question and keep unknown party facts unknown', async () => {
  const value = newStudioWorkspace();
  await converse(value, 'hi');
  await converse(value, 'Paris');
  await converse(value, '3');
  assert.equal(value.stops[0].nights, 3);
  assert.equal(value.brief.adults, null);
  await converse(value, 'two');
  assert.equal(value.brief.adults, 2);
  assert.equal(value.brief.children, null);
  await converse(value, 'no');
  assert.equal(value.brief.children, 0);
  await converse(value, 'flexible');
  assert.equal(value.brief.datesFlexible, true);
  await converse(value, '3000');
  assert.equal(value.brief.budget, 3000);
  assert.equal(value.brief.adults, 2);
  assert.equal(value.stops[0].nights, 3);

  const unprompted = newStudioWorkspace();
  await converse(unprompted, '2');
  assert.equal(unprompted.brief.adults, null);
  assert.equal(unprompted.brief.children, null);
  assert.deepEqual(unprompted.stops, []);
});

test('a literal unknown destination answer is retained without inventing a city or country', async () => {
  const value = newStudioWorkspace();
  await converse(value, 'hi');
  await converse(value, 'Nairobi, Kenya');
  assert.equal(value.stops.length, 1);
  assert.equal(value.stops[0].name, 'Nairobi');
  assert.equal(value.stops[0].country, 'Kenya');
  assert.equal(value.stops[0].nights, null);

  const country = newStudioWorkspace();
  await converse(country, 'hello');
  await converse(country, 'Japan');
  assert.equal(country.stops[0].name, 'Japan');
  assert.equal(country.stops[0].country, '');
});

test('chatter and unsupported input do not become destinations or claim saved facts', async () => {
  const value = newStudioWorkspace();
  await converse(value, 'hi');
  const brief = structuredClone(value.brief);
  for (const message of [
    'thanks',
    'okay',
    'I Do Not Know',
    'This Is Broken',
    'My Name Is Bill',
    'can you help me?',
    'asdf',
    '3000',
  ]) {
    const result = await converse(value, message);
    assert.doesNotMatch(result.reply, /saved|noted/i, message);
    assert.match(result.reply, /Where would you like the client to travel\?/, message);
    assert.deepEqual(value.brief, brief, message);
    assert.deepEqual(value.stops, [], message);
  }
  const unknown = await converse(value, 'tell me a joke');
  assert.match(unknown.reply, /couldn’t read any new trip details/);
  await converse(value, 'Paris for 3 nights');
  const route = structuredClone(value.stops);
  const request = value.brief.request;
  const thanks = await converse(value, 'thank you');
  assert.match(thanks.reply, /^You’re welcome\. How many adults/);
  const hello = await converse(value, 'hello');
  assert.match(hello.reply, /How many adults/);
  assert.deepEqual(value.stops, route);
  assert.equal(value.brief.request, request);
});

test('local intake connects the ordinary Home brief to a usable route and qualification', async () => {
  const value = newStudioWorkspace();
  const result = await review(
    value,
    'Plan a proposal for a fictional client: 2 adults, no children, arrive Paris on 2027-06-01 for 3 nights. Budget AUD 3000. Start with the route only.',
  );
  assert.equal(result.mode, 'local');
  assert.equal(value.title, 'Paris');
  assert.equal(value.brief.adults, 2);
  assert.equal(value.brief.children, 0);
  assert.equal(value.brief.budget, 3000);
  assert.equal(value.brief.currency, 'AUD');
  assert.equal(value.brief.startDate, '2027-06-01');
  assert.equal(value.brief.output, 'structure');
  assert.equal(value.stops.length, 1);
  assert.equal(value.stops[0].name, 'Paris');
  assert.equal(value.stops[0].nights, 3);
  assert.equal(value.stops[0].arrivalDate, '2027-06-01');
  assert.equal(value.stops[0].departureDate, '2027-06-04');
  assert.ok(!value.qualification.questions.some((question) => question.id === 'nights'));
});

test('explicit stay lengths work before or after known and uncatalogued destinations', async () => {
  for (const [message, name, nights] of [
    ['3 nights in Paris', 'Paris', 3],
    ['Paris for 3 nights', 'Paris', 3],
    ['Paris, France for 3 nights', 'Paris', 3],
    ['Plan a trip to Karachi for 4 nights', 'Karachi', 4],
    ['4 nights in Karachi', 'Karachi', 4],
    ['Plan a 5 day trip to Tokyo for 2 adults, no children.', 'Tokyo', null],
  ] as const) {
    const value = newStudioWorkspace();
    await review(value, message);
    assert.equal(value.stops.length, 1, message);
    assert.equal(value.stops[0].name, name, message);
    assert.equal(value.stops[0].nights, nights, message);
  }
});

test('local intake preserves explicit destination order and never chooses a city for a country', async () => {
  const value = newStudioWorkspace();
  await review(value, 'London for 4 nights, then Paris for 3 nights, then Kyoto for 2 nights.');
  assert.deepEqual(
    value.stops.map(({ name, nights }) => [name, nights]),
    [
      ['London', 4],
      ['Paris', 3],
      ['Kyoto', 2],
    ],
  );
  const country = newStudioWorkspace();
  await review(country, 'Plan a trip to Japan for 4 nights.');
  assert.equal(country.stops[0].name, 'Japan');
});

test('Home total travelers is retained without inventing the adult/child split', async () => {
  const value = newStudioWorkspace();
  await review(value, 'London for 4 nights for 2 travelers starting 2027-01-10');
  assert.equal(value.brief.startDate, '2027-01-10');
  assert.equal(value.brief.adults, null);
  assert.equal(value.brief.children, null);
  assert.deepEqual(value.brief.childAges, []);
  assert.ok(value.brief.requirements.includes('Party total: 2 travellers.'));
  assert.ok(value.qualification.questions.some((question) => question.id === 'adults'));
  assert.ok(value.qualification.questions.some((question) => question.id === 'children'));
  await review(value, '2 adults');
  assert.equal(value.brief.children, null);
});

test('a short night answer and hotel preference preserve saved route fields and identity', async () => {
  const value = newStudioWorkspace();
  await review(value, 'Paris starting 2027-06-01');
  value.stops[0].neighbourhood = 'Near the station';
  value.stops[0].notes = 'Agent supplied route note';
  value.stops[0].onwardTransport = 'train';
  const id = value.stops[0].id;
  await review(value, '3 nights');
  assert.equal(value.stops[0].id, id);
  assert.equal(value.stops[0].nights, 3);
  assert.equal(value.stops[0].departureDate, '2027-06-04');
  const route = structuredClone(value.stops);
  value.structureAccepted = true;
  await review(value, 'Prefer 4-star hotels. The client appointment is on 2027-07-12.');
  assert.equal(value.brief.hotelStandard, '4 star');
  assert.equal(value.brief.startDate, '2027-06-01');
  assert.deepEqual(value.stops, route);
  assert.equal(value.structureAccepted, true);
});

test('changing one stop retains other stops, IDs, transport and fixed arrivals', async () => {
  const value = newStudioWorkspace();
  await review(value, 'Paris for 3 nights, then London for 4 nights. Starting 2027-06-01');
  value.stops[0].onwardTransport = 'train';
  value.stops[1].arrivalDate = '2027-06-10';
  value.stops[1].arrivalFixed = true;
  await review(value, '4-star hotels please');
  const old = structuredClone(value.stops);
  await review(value, 'Paris for 4 nights');
  assert.equal(value.stops.length, 2);
  assert.equal(value.stops[0].id, old[0].id);
  assert.equal(value.stops[0].nights, 4);
  assert.equal(value.stops[0].onwardTransport, 'train');
  assert.deepEqual(value.stops[1], old[1]);
  await review(value, '3 nights');
  assert.equal(value.stops[0].nights, 4, 'ambiguous short answers do not pick a stop');
});

test('return dates and a later-stop arrival do not replace the trip start date', async () => {
  const value = newStudioWorkspace();
  await review(value, 'Paris for 3 nights, then London for 4 nights. Starting 2027-06-01');
  await review(value, 'Arrive in London on 2027-06-05. Return on 2027-06-10.');
  assert.equal(value.brief.startDate, '2027-06-01');
  assert.equal(value.brief.endDate, '2027-06-10');
  assert.equal(value.stops[1].arrivalDate, '2027-06-05');
  assert.equal(value.stops[1].arrivalFixed, true);
  await review(value, 'Start date is 2027-05-31');
  assert.equal(value.brief.startDate, '2027-05-31');
});

test('source-only intake extracts imported text with the latest message taking precedence', async () => {
  const value = newStudioWorkspace();
  value.imports.push({
    id: 'client-brief',
    kind: 'text',
    name: 'Client email',
    text: 'London for 4 nights, 2 adults, no children, starting 2027-01-10. Budget AUD 4000. 4-star hotels.',
    createdAt: new Date().toISOString(),
    sourceUrl: '',
    warnings: [],
  });
  await review(
    value,
    'Review the imported client information and prepare a route. Budget AUD 3500.',
  );
  assert.equal(value.title, 'London');
  assert.equal(value.stops[0].nights, 4);
  assert.equal(value.brief.startDate, '2027-01-10');
  assert.equal(value.brief.adults, 2);
  assert.equal(value.brief.children, 0);
  assert.equal(value.brief.budget, 3500);
  assert.equal(value.brief.hotelStandard, '4 star');
  await review(value, 'London for 5 nights. Start date is 2027-01-11.');
  await review(value, 'Prefer 5 star hotels');
  assert.equal(value.stops[0].nights, 5);
  assert.equal(value.brief.startDate, '2027-01-11');
  assert.equal(value.brief.hotelStandard, '5 star');
  assert.equal(value.brief.budget, 3500);
});

test('changing child count clears stale ages and leaves unknown ages unset', async () => {
  const value = newStudioWorkspace();
  await review(value, 'Paris 3 nights. Two adults and two children aged eight and twelve.');
  assert.deepEqual(value.brief.childAges, [8, 12]);
  await review(value, '1 kid');
  assert.equal(value.brief.children, 1);
  assert.deepEqual(value.brief.childAges, []);
});
