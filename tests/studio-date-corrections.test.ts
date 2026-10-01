import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStudioAgency, type StudioStop, type StudioWorkspace } from '../shared/studio.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { applyStudioPatch } from '../server/studio-domain.ts';
import { groundedStudioDates, readStudioDateReferences } from '../server/studio-grounding.ts';
import { reviewStudioBrief } from '../server/studio-models.ts';

const agency = defaultStudioAgency();
const originalFetch = globalThis.fetch;
const envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.OPENAI_API_KEY = 'synthetic-date-corrections-test-key';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => assert.fail('Unexpected external request');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of envNames)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});

function stop(name: string, nights: number): StudioStop {
  return {
    id: name.toLowerCase(),
    name,
    country: name === 'London' ? 'United Kingdom' : 'France',
    nights,
    arrivalDate: '',
    arrivalFixed: false,
    departureDate: '',
    onwardTransport: 'undecided',
    neighbourhood: '',
    notes: '',
  };
}
function london(multiple = false) {
  const value = newStudioWorkspace();
  applyStudioPatch(
    value,
    {
      revision: value.revision,
      brief: { startDate: '2026-10-03', preferredDestination: 'London' },
      stops: [
        { ...stop('London', 3), arrivalDate: '2026-10-03', arrivalFixed: true },
        ...(multiple ? [stop('Paris', 2)] : []),
      ],
    },
    agency,
  );
  return value;
}
function candidate(value: StudioWorkspace) {
  return {
    reply: 'The date is noted.',
    action: 'continue',
    brief: value.brief,
    facts: [] as { field: string; evidence: string }[],
    route: value.stops.map(({ id: _id, departureDate: _date, ...entry }) => ({
      ...entry,
      arrivalFixed: Boolean(entry.arrivalFixed),
    })),
    routeEvidence: '',
  };
}
function mockResponse(answer: unknown) {
  globalThis.fetch = async () =>
    Response.json({
      status: 'completed',
      output: [
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] },
      ],
    });
}

test('replacing an arrival date establishes the new arrival without inventing a return date', () => {
  for (const message of [
    'Change arrival from 3 October 2026 to 4 October 2026.',
    'Move the arrival date from 3 October 2026 to 4 October 2026.',
    'I will not arrive on 3 October 2026; I will arrive on 4 October 2026.',
    'I will not arrive on 3 October 2026 and arrive on 4 October 2026.',
  ])
    assert.deepEqual(groundedStudioDates(message), { startDate: '2026-10-04' }, message);
});

test('rejected return dates are excluded while the positive return date survives', () => {
  for (const message of [
    'Return on 8 October 2026, not 6 October 2026.',
    'Return not on 6 October 2026 but on 8 October 2026.',
    'Change return from 6 October 2026 to 8 October 2026.',
  ])
    assert.deepEqual(groundedStudioDates(message), { endDate: '2026-10-08' }, message);
  assert.deepEqual(groundedStudioDates('Do not arrive on 3 October 2026 or 4 October 2026.'), {});
});

test('correction filtering retains ordinary date ranges and cannot borrow an assistant date', () => {
  assert.deepEqual(groundedStudioDates('London from 3 October 2026 to 8 October 2026.'), {
    startDate: '2026-10-03',
    endDate: '2026-10-08',
  });
  assert.deepEqual(
    readStudioDateReferences('I will arrive on the same date.', {
      messages: [{ role: 'assistant', content: 'How about 3 October 2026?' }],
    }),
    [],
  );
  assert.deepEqual(
    groundedStudioDates('I will arrive on the same date.', {
      messages: [
        { role: 'user', content: 'Change departure from 3 October 2026 to 4 October 2026.' },
        { role: 'assistant', content: 'What date will you arrive?' },
      ],
    }),
    { startDate: '2026-10-04' },
  );
});

test('review persists the positive arrival correction and leaves the return unknown', async () => {
  const value = london();
  const message = 'Change arrival from 3 October 2026 to 4 October 2026.';
  mockResponse({
    ...candidate(value),
    brief: { ...value.brief, startDate: '2026-10-04' },
    facts: [{ field: 'startDate', evidence: message }],
    route: candidate(value).route.map((entry) => ({ ...entry, arrivalDate: '2026-10-04' })),
    routeEvidence: message,
  });
  await reviewStudioBrief(value, message, agency);
  assert.equal(value.brief.startDate, '2026-10-04');
  assert.equal(value.brief.endDate, '');
  assert.equal(value.stops[0].arrivalDate, '2026-10-04');
  assert.equal(value.stops[0].departureDate, '2026-10-07');
  assert.equal(value.clarification ?? null, null);
});

test('review confirms a conflicting positive return without selecting the explicitly rejected date', async () => {
  const value = london();
  const message = 'Return on 8 October 2026, not 6 October 2026.';
  mockResponse({
    ...candidate(value),
    brief: { ...value.brief, endDate: '2026-10-08' },
    facts: [{ field: 'endDate', evidence: message }],
  });
  await reviewStudioBrief(value, message, agency);
  assert.equal(value.clarification?.departureDate, '2026-10-08');
  assert.equal(value.clarification?.proposedNights, 5);
  assert.equal(value.stops[0].nights, 3);
});

test('a later-stop arrival fact cannot move the global start or the first fixed arrival', async () => {
  for (const evidence of ['Arrive Paris on 10 October 2026', '10 October 2026']) {
    const value = london(true);
    const message = 'Arrive Paris on 10 October 2026';
    mockResponse({
      ...candidate(value),
      brief: { ...value.brief, startDate: '2026-10-10' },
      facts: [{ field: 'startDate', evidence }],
      route: candidate(value).route.map((entry) =>
        entry.name === 'Paris'
          ? { ...entry, arrivalDate: '2026-10-10', arrivalFixed: true }
          : entry,
      ),
      routeEvidence: message,
    });
    await reviewStudioBrief(value, message, agency);
    assert.equal(value.brief.startDate, '2026-10-03', evidence);
    assert.equal(value.stops[0].arrivalDate, '2026-10-03', evidence);
    assert.equal(value.stops[1].arrivalDate, '2026-10-10', evidence);
  }
});

test('multi-stop first-arrival facts still update the actual trip boundary', async () => {
  const value = london(true);
  const message = 'Arrive London on 4 October 2026';
  mockResponse({
    ...candidate(value),
    brief: { ...value.brief, startDate: '2026-10-04' },
    facts: [{ field: 'startDate', evidence: message }],
    route: candidate(value).route.map((entry) =>
      entry.name === 'London' ? { ...entry, arrivalDate: '2026-10-04' } : entry,
    ),
    routeEvidence: message,
  });
  await reviewStudioBrief(value, message, agency);
  assert.equal(value.brief.startDate, '2026-10-04');
  assert.equal(value.stops[0].arrivalDate, '2026-10-04');
  assert.equal(value.stops[1].arrivalDate, '2026-10-07');
});
