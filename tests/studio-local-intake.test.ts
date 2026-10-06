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
  assert.match(destination.reply, /Paris.*Flight or Cruise\?/);
  await converse(value, 'flight');
  assert.equal(value.brief.outboundTransport, 'flight');
  await converse(value, 'Sydney');
  assert.equal(value.brief.origin, 'Sydney');
  await converse(value, 'dates flexible');
  await converse(value, 'return by flight');
  const nights = await converse(value, '3 nights');
  assert.equal(value.stops[0].nights, 3);
  assert.match(nights.reply, /How many adults/);
  const adults = await converse(value, '2 adults');
  assert.equal(value.brief.adults, 2);
  assert.equal(value.brief.children, null);
  assert.match(adults.reply, /children/);
  const children = await converse(value, 'no children');
  assert.equal(value.brief.children, 0);
  assert.doesNotMatch(children.reply, /what date.*arriv|when.*arriv/i);
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

for (const selectedMode of ['flight', 'cruise'] as const) {
  test(`one origin answer follows a ${selectedMode} button choice even when the chat still shows the transport question`, async () => {
    const value = newStudioWorkspace();
    await converse(value, 'hi');
    const destination = await converse(value, 'London');
    assert.match(destination.reply, /How would you like to travel there: Flight or Cruise\?/);
    value.brief.outboundTransport = selectedMode; // The button saves the brief without a chat turn.
    const originalRoute = structuredClone(value.stops);
    const reply = await converse(value, 'Sydney');
    assert.equal(value.brief.origin, 'Sydney');
    assert.equal(value.brief.outboundTransport, selectedMode);
    assert.deepEqual(value.stops, originalRoute);
    assert.equal(value.brief.departureDate || '', '');
    assert.equal(value.brief.startDate, '');
    assert.equal(value.brief.passportNationality || '', '');
    assert.equal(value.brief.adults, null);
    assert.equal(value.brief.children, null);
    assert.match(reply.reply, /departure city: Sydney/);
    assert.doesNotMatch(reply.reply, /Where will you depart from|couldn’t read/);
  });
}

test('a saved transport choice does not turn an ambiguous or unrelated short reply into an origin', async () => {
  const make = async () => {
    const value = newStudioWorkspace();
    await converse(value, 'hi');
    await converse(value, 'London');
    value.brief.outboundTransport = 'flight';
    return value;
  };
  for (const message of ['yes', 'no', 'thanks', 'Maybe Sydney', 'Not Sydney', '18 November 2027']) {
    const value = await make();
    const route = structuredClone(value.stops);
    await converse(value, message);
    assert.equal(value.brief.origin, '', message);
    assert.equal(value.brief.startDate, '', message);
    assert.equal(value.brief.departureDate || '', '', message);
    assert.equal(value.brief.passportNationality || '', '', message);
    assert.deepEqual(value.stops, route, message);
  }
  for (const condition of [
    'undecided',
    'known-origin',
    'multiple-stops',
    'different-question',
    'no-destination',
  ] as const) {
    const value = await make();
    if (condition === 'undecided') value.brief.outboundTransport = 'undecided';
    if (condition === 'known-origin') value.brief.origin = 'Melbourne';
    if (condition === 'multiple-stops')
      value.stops.push({ ...value.stops[0], id: 'paris', name: 'Paris', country: 'France' });
    if (condition === 'different-question')
      value.messages.push({
        id: 'passport',
        role: 'assistant',
        content: 'Which passport will you travel on?',
        createdAt: new Date().toISOString(),
      });
    if (condition === 'no-destination') value.stops = [];
    const before = structuredClone(value);
    await converse(value, 'Sydney');
    assert.equal(value.brief.origin, before.brief.origin, condition);
    assert.equal(value.brief.startDate, before.brief.startDate, condition);
    assert.equal(value.brief.passportNationality || '', '', condition);
    assert.deepEqual(value.stops, before.stops, condition);
  }
});

test('local intake accepts adjacent currency codes without reading codes inside words', async () => {
  for (const message of ['budget AUD3000', 'budget 3000AUD', 'budget eur3000', 'budget NPR3000']) {
    const value = newStudioWorkspace();
    await converse(value, message);
    assert.equal(value.brief.budget, 3000, message);
    assert.equal(value.brief.currency, message.match(/AUD|eur|NPR/)![0].toUpperCase(), message);
  }
  const value = newStudioWorkspace();
  await converse(value, 'Our budget is 3000 in total; all meals included, try local places.');
  assert.equal(value.brief.budget, 3000);
  assert.equal(value.brief.currency, 'AUD');
});

test('short answers use only the last targeted question and keep unknown party facts unknown', async () => {
  const value = newStudioWorkspace();
  await converse(value, 'hi');
  await converse(value, 'Paris');
  const unassigned = await converse(value, '3');
  assert.equal(value.stops[0].nights, null);
  assert.equal(value.brief.adults, null);
  assert.match(unassigned.reply, /Flight or Cruise/);
  const ask = (content: string) =>
    value.messages.push({
      id: String(value.messages.length),
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
    });
  ask('How many nights would you like in Paris?');
  await converse(value, '3');
  assert.equal(value.stops[0].nights, 3);
  assert.equal(value.brief.adults, null);
  ask('How many adults are travelling?');
  await converse(value, 'two');
  assert.equal(value.brief.adults, 2);
  assert.equal(value.brief.children, null);
  ask('Are any children travelling?');
  await converse(value, 'no');
  assert.equal(value.brief.children, 0);
  ask('When would you like to depart, or are dates flexible?');
  await converse(value, 'flexible');
  assert.equal(value.brief.datesFlexible, true);
  ask('What is the group budget?');
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

test('natural travel declarations retain uncatalogued named cities without inventing stay nights or passport facts', async () => {
  for (const [message, name] of [
    ['I wanna go to Kathmandu for a hiking holiday for twelve days.', 'Kathmandu'],
    ['We are going to New York for a business trip for seven days.', 'New York'],
    ['I would like to travel to Singapore for a business trip for three days.', 'Singapore'],
    ['We want to go to Sydney for a cruise holiday for nine days.', 'Sydney'],
  ]) {
    const value = newStudioWorkspace();
    const result = await converse(value, message);
    assert.equal(value.stops.length, 1, message);
    assert.equal(value.stops[0].name, name, message);
    assert.equal(value.stops[0].nights, null, message);
    assert.equal(value.stops[0].arrivalDate, '', message);
    assert.equal(value.brief.startDate, '', message);
    assert.equal(value.brief.adults, null, message);
    assert.equal(value.brief.children, null, message);
    assert.equal(value.brief.passportNationality || '', '', message);
    assert.match(result.reply, /Flight or Cruise/);
    assert.doesNotMatch(result.reply, /couldn’t read|when.*arriv/i);
  }
});

test('negated, hypothetical and chatter place mentions cannot create a committed route', async () => {
  for (const message of [
    'Do not go to Kathmandu for twelve days.',
    'Maybe go to Singapore for three days.',
    'If we go to New York for seven days.',
    'We might go to Sydney for nine days.',
    'I could go to Kathmandu for twelve days.',
    'Do not visit Paris for three nights.',
    'Maybe London for three nights.',
    'Thanks for three nights.',
  ]) {
    const value = newStudioWorkspace();
    await converse(value, message);
    assert.deepEqual(value.stops, [], message);
    assert.equal(value.brief.startDate, '', message);
    assert.equal(value.brief.adults, null, message);
    assert.equal(value.brief.passportNationality || '', '', message);
  }
});

test('declared or directly asked origin cities never become destinations or passport evidence', async () => {
  for (const message of ['I am from Paris.', 'origin city: London', 'Depart from Kyoto.']) {
    const value = newStudioWorkspace();
    await converse(value, message);
    assert.equal(
      value.brief.origin,
      message.includes('Paris') ? 'Paris' : message.includes('London') ? 'London' : 'Kyoto',
    );
    assert.deepEqual(value.stops, []);
    assert.equal(value.brief.passportNationality || '', '');
  }
  const value = newStudioWorkspace();
  value.messages.push({
    id: 'origin-question',
    role: 'assistant',
    content: 'Where will you depart from?',
    createdAt: new Date().toISOString(),
  });
  await converse(value, 'Paris');
  assert.equal(value.brief.origin, 'Paris');
  assert.deepEqual(value.stops, []);
  assert.equal(value.brief.passportNationality || '', '');
});

test('the actual last night question fills only its named stop while transport remains undecided', async () => {
  const value = newStudioWorkspace();
  await converse(value, 'Paris then London');
  assert.equal(value.stops.length, 2);
  const ids = value.stops.map((stop) => stop.id);
  value.messages.push({
    id: 'targeted-nights',
    role: 'assistant',
    content: 'Noted: Paris and London. How many nights would you like in London?',
    createdAt: new Date().toISOString(),
  });
  await converse(value, 'three');
  assert.equal(value.stops[0].nights, null);
  assert.equal(value.stops[1].nights, 3);
  assert.deepEqual(
    value.stops.map((stop) => stop.id),
    ids,
  );
  assert.equal(value.brief.outboundTransport, 'undecided');
  assert.equal(value.brief.adults, null);
  value.messages.push({
    id: 'ambiguous-nights',
    role: 'assistant',
    content: 'How many nights in Paris or London?',
    createdAt: new Date().toISOString(),
  });
  await converse(value, '2');
  assert.equal(value.stops[0].nights, null);
  assert.equal(value.stops[1].nights, 3);
});

test('a newly recorded origin, departure or trip duration is acknowledged without claiming arrival is known', async () => {
  const value = newStudioWorkspace();
  await converse(value, 'London');
  await converse(value, 'flight');
  const origin = await converse(value, 'Sydney');
  assert.match(origin.reply, /Noted:.*departure city: Sydney/);
  const departure = await converse(value, 'depart on 18 November 2027');
  assert.match(departure.reply, /Noted:.*outbound departure 2027-11-18/);
  const duration = await converse(value, 'The trip lasts four days.');
  assert.equal(value.brief.tripDays, 4);
  assert.match(duration.reply, /Noted:.*4-day trip/);
  assert.doesNotMatch(duration.reply, /couldn’t read/i);
  assert.equal(value.brief.startDate, '');
  assert.equal(value.stops[0].nights, null);
});

test('negative stay and origin declarations preserve a saved route and its unknown arrival', async () => {
  const value = newStudioWorkspace();
  await converse(value, 'Paris for four nights.');
  const route = structuredClone(value.stops);
  for (const message of [
    'Do not change Paris to three nights.',
    'Maybe stay in Paris for three nights.',
    'Do not start on 2027-11-18.',
    'Maybe depart from Sydney.',
  ]) {
    await converse(value, message);
    assert.deepEqual(value.stops, route, message);
    assert.equal(value.brief.origin, '', message);
    assert.equal(value.brief.startDate, '', message);
  }
});

test('an unassigned short date or a city date paired only with trip days cannot become arrival', async () => {
  const value = newStudioWorkspace();
  await converse(value, 'London');
  for (const message of ['2027-11-18', '18 November 2027', 'London on 2027-11-18 for four days.']) {
    await converse(value, message);
    assert.equal(value.brief.startDate, '', message);
    assert.equal(value.brief.departureDate || '', '', message);
    assert.equal(value.stops[0].arrivalDate, '', message);
    assert.equal(value.stops[0].nights, null, message);
  }
  value.messages.push({
    id: 'actual-arrival-question',
    role: 'assistant',
    content: 'What date will you arrive in London?',
    createdAt: new Date().toISOString(),
  });
  await converse(value, '2027-11-18');
  assert.equal(value.brief.startDate, '2027-11-18');
  assert.equal(value.stops[0].arrivalDate, '2027-11-18');
  assert.equal(value.stops[0].nights, null);
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
  assert.match(thanks.reply, /Flight or Cruise/);
  const hello = await converse(value, 'hello');
  assert.match(hello.reply, /Flight or Cruise/);
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

test('local conversation collects transport first, then passport and scope without repeating known facts', async () => {
  const value = newStudioWorkspace();
  const complete = await converse(
    value,
    'Paris for 3 nights. 2 adults, no children, dates flexible, budget AUD 3000 and 4-star hotels.',
  );
  assert.match(complete.reply, /Flight or Cruise/);
  const outbound = await converse(value, 'cruise');
  assert.equal(value.brief.outboundTransport, 'cruise');
  assert.equal(value.brief.returnTransport, 'undecided');
  assert.match(outbound.reply, /depart from/);
  const origin = await converse(value, 'Sydney');
  assert.equal(value.brief.origin, 'Sydney');
  assert.match(origin.reply, /return be by flight or cruise/);
  const back = await converse(value, 'flight');
  assert.equal(value.brief.returnTransport, 'flight');
  assert.match(back.reply, /country issued the passport/);
  const nationality = await converse(value, 'Pakistani');
  assert.equal(value.brief.passportNationality, 'PK');
  assert.match(nationality.reply, /trip for/);
  const purpose = await converse(value, 'tourism');
  assert.equal(value.brief.tripPurpose, 'tourism');
  assert.match(purpose.reply, /single-destination or multi-destination/);
  await converse(value, 'single');
  assert.equal(value.brief.tripType, 'single');
  assert.equal(value.brief.startDate, '');
  assert.equal(value.stops.length, 1);
  assert.equal(value.stops[0].name, 'Paris');
});

test('local Stage 1 declarations work without a prior question and residence never establishes passport nationality', async () => {
  const value = newStudioWorkspace();
  await review(value, 'We live in Australia and were born in Pakistan.');
  assert.equal(value.brief.passportNationality, '');
  await review(
    value,
    'Passport nationality: Burkina Faso. This is a multi-destination trip. Arrive by cruise and return by flight.',
  );
  assert.equal(value.brief.passportNationality, 'BF');
  assert.equal(value.brief.tripType, 'multiple');
  assert.equal(value.brief.outboundTransport, 'cruise');
  assert.equal(value.brief.returnTransport, 'flight');
  await review(value, 'Arrival and return by flight.');
  assert.equal(value.brief.outboundTransport, 'flight');
  assert.equal(value.brief.returnTransport, 'flight');
});

test('ambiguous transport and unprompted short scope/country answers do not invent Stage 1 facts', async () => {
  const value = newStudioWorkspace();
  for (const message of [
    'Pakistani',
    'single',
    'cruise',
    'Maybe arrive by cruise.',
    'Arrival by flight or cruise.',
  ])
    await review(value, message);
  assert.equal(value.brief.passportNationality, '');
  assert.equal(value.brief.tripType, 'undecided');
  assert.equal(value.brief.outboundTransport, 'undecided');
  assert.equal(value.brief.returnTransport, 'undecided');
});

test('the live-smoke London followup also completes the core Stage 1 fields in local mode', async () => {
  const value = newStudioWorkspace();
  await converse(value, 'hi');
  await converse(value, 'London');
  await converse(
    value,
    'The fictional client holds an Australian passport. This is a single-destination trip, arriving 2027-03-10 for 3 nights, 2 adults and no children, budget AUD 6000. Arrival and return by flight. Four-star hotels near the city centre, culture and vegetarian food.',
  );
  assert.equal(value.brief.passportNationality, 'AU');
  assert.equal(value.brief.tripType, 'single');
  assert.equal(value.brief.startDate, '2027-03-10');
  assert.equal(value.stops[0].nights, 3);
  assert.equal(value.brief.adults, 2);
  assert.equal(value.brief.children, 0);
  assert.equal(value.brief.budget, 6000);
  assert.equal(value.brief.outboundTransport, 'flight');
  assert.equal(value.brief.returnTransport, 'flight');
});
