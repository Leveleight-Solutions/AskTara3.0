import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStudioAgency } from '../shared/studio.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { reviewStudioBrief } from '../server/studio-models.ts';
import { groundedStudioBrief, requestedStudioTripDays } from '../server/studio-grounding.ts';
import { studioTripBriefingReady } from '../shared/studio-trip-briefing.ts';

let key: string | undefined;
beforeEach(() => {
  key = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
});
afterEach(() => {
  if (key === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = key;
});

async function turn(workspace: ReturnType<typeof newStudioWorkspace>, text: string) {
  const result = await reviewStudioBrief(workspace, text, defaultStudioAgency());
  const createdAt = new Date().toISOString();
  workspace.messages.push(
    { id: `${workspace.messages.length}-u`, role: 'user', content: text, createdAt },
    { id: `${workspace.messages.length}-a`, role: 'assistant', content: result.reply, createdAt },
  );
  return result;
}

for (const [purpose, destination, duration] of [
  ['business', 'London', 4],
  ['honeymoon', 'Bali', 8],
  ['hiking trip', 'Kathmandu', 12],
  ['vacation', 'New York', 7],
  ['family holiday', 'Paris', 6],
  ['holiday', 'Kyoto', 5],
  ['business', 'Singapore', 3],
  ['cruise holiday', 'Sydney', 9],
] as const) {
  test(`${purpose} to ${destination}: transport comes before arrival and days never become nights`, async () => {
    const workspace = newStudioWorkspace();
    const result = await turn(
      workspace,
      `I want to go to ${destination} for a ${purpose} for ${duration} days.`,
    );
    assert.equal(workspace.stops[0].name, destination);
    assert.equal(workspace.brief.tripDays, duration);
    assert.equal(workspace.stops[0].nights, null);
    assert.equal(workspace.brief.startDate, '');
    assert.match(result.reply, /Flight or Cruise/);
    assert.doesNotMatch(result.reply, /(?:when|what date).{0,50}arriv/i);
    await turn(workspace, 'flight');
    assert.equal(workspace.brief.outboundTransport, 'flight');
    assert.equal(workspace.brief.returnTransport, 'undecided');
    const origin = destination === 'Sydney' ? 'London' : 'Sydney';
    await turn(workspace, origin);
    assert.equal(workspace.brief.origin, origin);
    assert.equal(workspace.stops.length, 1);
    await turn(workspace, 'depart on 18 November 2027');
    assert.equal(workspace.brief.departureDate, '2027-11-18');
    assert.equal(workspace.brief.startDate, '');
    assert.equal(workspace.stops[0].arrivalDate, '');
    await turn(workspace, 'return by flight');
    assert.equal(workspace.brief.returnTransport, 'flight');
    assert.equal(workspace.stops[0].nights, null);
  });
}

test('the reported London business request keeps the date role open while retaining four days', async () => {
  const workspace = newStudioWorkspace();
  await turn(workspace, 'I am from Sydney and I hold an Australian passport.');
  const result = await turn(
    workspace,
    'I wanna go to London for a bussiness trip for 4 days on 3rd of October',
  );
  assert.equal(workspace.brief.origin, 'Sydney');
  assert.equal(workspace.brief.passportNationality, 'AU');
  assert.equal(workspace.brief.tripDays, 4);
  assert.equal(workspace.brief.startDate, '');
  assert.equal(workspace.brief.departureDate || '', '');
  assert.equal(workspace.stops[0].nights, null);
  assert.equal(studioTripBriefingReady(workspace), true);
  assert.match(result.reply, /Flight or Cruise/);
  assert.doesNotMatch(result.reply, /departure.{0,30}or.{0,30}arrival|what date.{0,30}arriv/i);
});

test('short answers do not set a duration, party or arrival when the last question is transport mode', async () => {
  const workspace = newStudioWorkspace();
  await turn(workspace, 'London');
  for (const text of ['yes', '3', 'no', 'maybe']) {
    await turn(workspace, text);
    assert.equal(workspace.brief.adults, null);
    assert.equal(workspace.brief.tripDays ?? null, null);
    assert.equal(workspace.brief.startDate, '');
    assert.equal(workspace.stops[0].nights, null);
    assert.equal(workspace.brief.outboundTransport, 'undecided');
  }
});

test('explicit return departure is retained independently of unknown outbound arrival', async () => {
  const workspace = newStudioWorkspace();
  await turn(
    workspace,
    'London for 4 days. Depart Sydney on 18 November 2027, return flight on 23 November 2027.',
  );
  assert.equal(workspace.brief.departureDate, '2027-11-18');
  assert.equal(workspace.brief.returnDepartureDate, '2027-11-23');
  assert.equal(workspace.brief.startDate, '');
  assert.equal(workspace.stops[0].arrivalDate, '');
  assert.equal(workspace.stops[0].nights, null);
});

test('trip-day extraction rejects hypothetical, negated, conflicting and unrelated durations', () => {
  for (const text of [
    'Maybe go to London for 4 days.',
    'Do not go to London for 4 days.',
    'If we go for 4 days.',
    'Work for 4 days.',
    'A holiday for 4 days or for 8 days.',
    'Visit London for 999 days.',
  ])
    assert.equal(requestedStudioTripDays(text), undefined, text);
  assert.equal(requestedStudioTripDays('A twenty-eight-day trip to Japan.'), 28);
  assert.equal(requestedStudioTripDays('We want to go to Nepal for twelve days.'), 12);
});

test('a bare trip duration fills only a directly asked trip-days field, preserving unknown hotel nights', () => {
  const workspace = newStudioWorkspace();
  const proposed = { ...workspace.brief, tripDays: 99 };
  const direct = groundedStudioBrief(
    workspace.brief,
    proposed,
    [{ field: 'tripDays', evidence: 'four days' }],
    'four days',
    [],
    { messages: [{ role: 'assistant', content: 'What is the trip duration in days?' }] },
  );
  assert.equal(direct.tripDays, 4);
  const ambiguous = groundedStudioBrief(
    workspace.brief,
    proposed,
    [{ field: 'tripDays', evidence: 'four days' }],
    'four days',
    [],
    { messages: [{ role: 'assistant', content: 'How many adults or days?' }] },
  );
  assert.equal(ambiguous.tripDays ?? null, null);
});
