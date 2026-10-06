import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { defaultStudioAgency } from '../shared/studio.ts';
import { runStudioAssistant } from '../server/studio-assistant.ts';
import { localStudioReview } from '../server/studio-local-intake.ts';
import {
  groundedStudioBrief,
  assertStudioRouteGrounding,
  requestedStudioNights,
} from '../server/studio-grounding.ts';

const prompt =
  'We want a relaxed family holiday in London, United Kingdom. Arrive on 1 May 2027 and leave on 4 May 2027: exactly 3 nights. There are 2 adults and 1 child aged 7, travelling on Australian passports. Total group budget AUD 8000. We prefer central 4 star hotels, vegetarian food, gardens and museums, with a daily rest break. Flights will be arranged separately.';
const originalFetch = globalThis.fetch;
const fields = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let originalEnv: Record<string, string | undefined>;
beforeEach(() => {
  originalEnv = Object.fromEntries(fields.map((field) => [field, process.env[field]]));
  process.env.OPENAI_API_KEY = 'unit-test-literal-intake';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => assert.fail('Unexpected external request');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const field of fields)
    originalEnv[field] === undefined
      ? delete process.env[field]
      : (process.env[field] = originalEnv[field]);
});

test('actual-model-shaped full family extraction survives grounding in one call without losing the literal route or budget', async () => {
  const workspace = newStudioWorkspace();
  Object.assign(workspace.brief, {
    passportNationality: 'AU',
    interests: ['Gardens', 'Museums'],
    foodPreferences: ['Vegetarian'],
  });
  const proposed = {
    ...workspace.brief,
    preferredDestination: 'London',
    destinationCountry: 'GB',
    tripType: 'single',
    tripPurpose: 'tourism',
    startDate: '2027-05-01',
    endDate: '2027-05-04',
    adults: 2,
    children: 1,
    childAges: [7],
    budget: 8000,
    currency: 'AUD',
    hotelStandard: '4 star',
    hotelLocation: 'Central',
    requirements: [
      'Total group budget AUD 8000.',
      'Daily rest break.',
      'Flights will be arranged separately.',
    ],
  };
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    const payload = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
    assert.equal(payload.request, prompt);
    assert.equal(payload.validationFeedback, '');
    return Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                action: 'continue',
                reply: 'Shall I build the day-by-day London itinerary?',
                brief: proposed,
                facts: [
                  { field: 'preferredDestination', evidence: 'London, United Kingdom' },
                  { field: 'destinationCountry', evidence: 'United Kingdom' },
                  { field: 'tripPurpose', evidence: 'family holiday' },
                  { field: 'startDate', evidence: 'Arrive on 1 May 2027' },
                  { field: 'endDate', evidence: 'leave on 4 May 2027' },
                  { field: 'adults', evidence: '2 adults and 1 child aged 7' },
                  { field: 'children', evidence: '2 adults and 1 child aged 7' },
                  { field: 'childAges', evidence: '1 child aged 7' },
                  { field: 'budget', evidence: 'Total group budget AUD 8000.' },
                  { field: 'currency', evidence: 'Total group budget AUD 8000.' },
                  { field: 'hotelStandard', evidence: '4 star hotels' },
                  { field: 'hotelLocation', evidence: 'central 4 star hotels' },
                  {
                    field: 'requirements',
                    evidence: 'with a daily rest break. Flights will be arranged separately.',
                  },
                ],
                route: [
                  {
                    name: 'London',
                    country: 'GB',
                    nights: 3,
                    arrivalDate: '2027-05-01',
                    arrivalFixed: true,
                    onwardTransport: 'undecided',
                    neighbourhood: 'Central',
                    notes: '',
                  },
                ],
                routeEvidence:
                  'We want a relaxed family holiday in London, United Kingdom. Arrive on 1 May 2027 and leave on 4 May 2027: exactly 3 nights.',
              }),
            },
          ],
        },
      ],
    });
  };
  const result = await runStudioAssistant(workspace, prompt, defaultStudioAgency());
  assert.equal(calls, 1);
  assert.equal(result.mode, 'live');
  assert.equal(workspace.stops.length, 1);
  assert.equal(workspace.stops[0].name, 'London');
  assert.equal(workspace.stops[0].nights, 3);
  assert.equal(workspace.stops[0].arrivalDate, '2027-05-01');
  assert.equal(workspace.stops[0].departureDate, '2027-05-04');
  assert.deepEqual(
    [workspace.brief.adults, workspace.brief.children, workspace.brief.childAges],
    [2, 1, [7]],
  );
  assert.equal(workspace.brief.budget, 8000);
  assert.equal(workspace.brief.currency, 'AUD');
  assert.equal(workspace.brief.tripPurpose, 'tourism');
  assert.equal(workspace.brief.hotelLocation, 'Central');
  assert.doesNotMatch(result.reply, /Where would you like to travel/);
  assert.ok(
    !workspace.brief.requirements.some((requirement) => /Budget basis:.*per day/.test(requirement)),
  );
});

test('duration modifiers are not destinations, while separately declared cities still prevent an unsupported single-stop assignment', () => {
  const current = newStudioWorkspace().brief;
  for (const modifier of [
    'exactly',
    'precisely',
    'about',
    'around',
    'approximately',
    'roughly',
    'just',
    'only',
  ]) {
    const message = `A London holiday: ${modifier} 3 nights.`;
    assert.equal(requestedStudioNights(message, 'London', null, true), 3, modifier);
    assert.doesNotThrow(
      () =>
        assertStudioRouteGrounding(
          [],
          [{ name: 'London', country: 'United Kingdom', nights: 3 }],
          message,
          [],
          message,
          { brief: current },
        ),
      modifier,
    );
  }
  const conflicting = 'A London holiday: exactly 3 nights. Paris for 4 nights.';
  assert.throws(() =>
    assertStudioRouteGrounding(
      [],
      [{ name: 'London', country: 'United Kingdom', nights: 3 }],
      conflicting,
      [],
      conflicting,
      { brief: current },
    ),
  );
});

test('unrelated daily or nightly activities cannot change an explicit group budget, including decimals and the same sentence', () => {
  for (const message of [
    'Total group budget AUD 8000. Include a daily rest break.',
    'Total group budget AUD 8000, with a daily rest break.',
    'Budget AUD 8000.50. Nightly museum visits are optional.',
    'Budget AUD 8000.50, with nightly concerts.',
  ]) {
    const current = newStudioWorkspace().brief;
    const result = groundedStudioBrief(
      current,
      { ...current, budget: 99 },
      [{ field: 'budget', evidence: message }],
      message,
      [],
    );
    assert.equal(result.budget, message.includes('8000.50') ? 8000.5 : 8000, message);
    assert.ok(
      !result.requirements.some((requirement) => /Budget basis:/.test(requirement)),
      message,
    );
  }
  const current = { ...newStudioWorkspace().brief, adults: 2, children: 0 };
  const daily = 'Daily budget AUD 100 for 4 days.';
  assert.equal(
    groundedStudioBrief(current, current, [{ field: 'budget', evidence: daily }], daily, []).budget,
    400,
  );
  const nightly = 'Nightly budget AUD 100 for 3 nights.';
  assert.equal(
    groundedStudioBrief(current, current, [{ field: 'budget', evidence: nightly }], nightly, [])
      .budget,
    300,
  );
});

test('local intake preserves the same explicit family route, singular child, plural passports and group budget', () => {
  const workspace = newStudioWorkspace();
  const reply = localStudioReview(workspace, prompt, defaultStudioAgency());
  assert.equal(workspace.stops.length, 1);
  assert.equal(workspace.stops[0].name, 'London');
  assert.equal(workspace.stops[0].nights, 3);
  assert.equal(workspace.stops[0].arrivalDate, '2027-05-01');
  assert.equal(workspace.stops[0].departureDate, '2027-05-04');
  assert.deepEqual(
    [workspace.brief.adults, workspace.brief.children, workspace.brief.childAges],
    [2, 1, [7]],
  );
  assert.equal(workspace.brief.budget, 8000);
  assert.equal(workspace.brief.passportNationality, 'AU');
  assert.doesNotMatch(reply, /Where would you like to travel|any children/);
});
