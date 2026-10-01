import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStudioAgency, type StudioStop } from '../shared/studio.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { reviewStudioBrief } from '../server/studio-models.ts';

const originalFetch = globalThis.fetch;
let originalKey: string | undefined;
beforeEach(() => {
  originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'fictional-intake-unit-test';
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});
const stop = (name: string, nights: number, arrivalDate = '', arrivalFixed = false) => ({
  name,
  country: name === 'Kathmandu' || name === 'Pokhara' ? 'NP' : 'FR',
  nights,
  arrivalDate,
  arrivalFixed,
  onwardTransport: 'undecided' as const,
  neighbourhood: '',
  notes: '',
});
const mock = (data: unknown) => {
  globalThis.fetch = async () =>
    Response.json({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
    });
};

test('a multi-stop brief preserves both boundary dates when evidence names the whole route', async () => {
  const workspace = newStudioWorkspace();
  const message =
    'Arrive Kathmandu, Nepal on 10 November 2026 for two nights, then Pokhara for three nights, leaving Pokhara on 15 November.';
  mock({
    reply: 'The route is ready to review.',
    action: 'continue',
    brief: { ...workspace.brief, startDate: '2026-11-10', endDate: '2026-11-15' },
    facts: [
      { field: 'startDate', evidence: message },
      { field: 'endDate', evidence: message },
    ],
    route: [stop('Kathmandu', 2, '2026-11-10', true), stop('Pokhara', 3)],
    routeEvidence: message,
  });
  await reviewStudioBrief(workspace, message, defaultStudioAgency());
  assert.equal(workspace.brief.startDate, '2026-11-10');
  assert.equal(workspace.brief.endDate, '2026-11-15');
  assert.deepEqual(
    workspace.stops.map((entry) => entry.nights),
    [2, 3],
  );
  assert.deepEqual(
    workspace.stops.map((entry) => entry.departureDate),
    ['2026-11-12', '2026-11-15'],
  );
});

function existingRoute() {
  const workspace = newStudioWorkspace();
  workspace.brief.startDate = '2026-11-10';
  workspace.brief.endDate = '2026-11-15';
  workspace.stops = [
    { ...stop('Kathmandu', 2, '2026-11-10', true), id: 'kathmandu', departureDate: '2026-11-12' },
    { ...stop('Pokhara', 3, '2026-11-12'), id: 'pokhara', departureDate: '2026-11-15' },
  ];
  return workspace;
}
const modelRoute = (stops: StudioStop[]) =>
  stops.map(({ id: _id, departureDate: _end, ...entry }) => entry);

test('a corrected multi-stop night split preserves independently explicit trip boundaries', async () => {
  const workspace = existingRoute();
  workspace.brief.endDate = '';
  const message =
    'Change the split to one night in Kathmandu and four nights in Pokhara, still arriving 10 November and leaving 15 November 2026.';
  mock({
    reply: 'The revised split is ready.',
    action: 'continue',
    brief: workspace.brief,
    facts: [],
    route: [stop('Kathmandu', 1, '2026-11-10', true), stop('Pokhara', 4)],
    routeEvidence: message,
  });
  await reviewStudioBrief(workspace, message, defaultStudioAgency());
  assert.equal(workspace.brief.startDate, '2026-11-10');
  assert.equal(workspace.brief.endDate, '2026-11-15');
  assert.deepEqual(
    workspace.stops.map((entry) => entry.nights),
    [1, 4],
  );
  assert.equal(workspace.stops[1].arrivalDate, '2026-11-11');
  assert.equal(workspace.clarification ?? null, null);
});

for (const [message, field, date] of [
  ['We arrive in Pokhara on 12 November 2026.', 'startDate', '2026-11-12'],
  ['Pokhara arrival is 12 November 2026.', 'startDate', '2026-11-12'],
  ['We leave Kathmandu on 12 November 2026.', 'endDate', '2026-11-12'],
] as const) {
  test(`an intermediate stop date is not a whole-trip ${field}: ${message}`, async () => {
    const workspace = existingRoute();
    mock({
      reply: 'Noted.',
      action: 'continue',
      brief: { ...workspace.brief, [field]: date },
      facts: [{ field, evidence: message }],
      route: modelRoute(workspace.stops),
      routeEvidence: '',
    });
    await reviewStudioBrief(workspace, message, defaultStudioAgency());
    assert.equal(workspace.brief.startDate, '2026-11-10');
    assert.equal(workspace.brief.endDate, '2026-11-15');
  });
}

test('an unrelated preference cannot establish model-invented boundary dates', async () => {
  const workspace = existingRoute();
  mock({
    reply: 'Vegetarian food noted.',
    action: 'continue',
    brief: { ...workspace.brief, startDate: '2027-01-01', endDate: '2027-01-09' },
    facts: [
      { field: 'startDate', evidence: 'Vegetarian food please.' },
      { field: 'endDate', evidence: 'Vegetarian food please.' },
    ],
    route: modelRoute(workspace.stops),
    routeEvidence: '',
  });
  await reviewStudioBrief(workspace, 'Vegetarian food please.', defaultStudioAgency());
  assert.equal(workspace.brief.startDate, '2026-11-10');
  assert.equal(workspace.brief.endDate, '2026-11-15');
});

test('departure from the last destination grounds the multi-stop trip end, not origin departure', async () => {
  const workspace = existingRoute();
  workspace.brief.endDate = '';
  workspace.brief.origin = 'Melbourne';
  workspace.brief.preferredDestination = 'Kathmandu';
  const message = 'After Kathmandu, depart Pokhara on 15 November 2026.';
  mock({
    reply: 'The final departure is noted.',
    action: 'continue',
    brief: workspace.brief,
    facts: [],
    route: modelRoute(workspace.stops),
    routeEvidence: '',
  });
  await reviewStudioBrief(workspace, message, defaultStudioAgency());
  assert.equal(workspace.brief.endDate, '2026-11-15');
  assert.equal(workspace.brief.departureDate || '', '');
});

test('the Ubud extension updates both nights and the requested final date together', async () => {
  const workspace = newStudioWorkspace();
  workspace.brief.startDate = '2026-11-12';
  workspace.brief.endDate = '2026-11-16';
  workspace.stops = [
    {
      ...stop('Ubud', 4, '2026-11-12', true),
      country: 'Indonesia',
      id: 'ubud',
      departureDate: '2026-11-16',
    },
  ];
  const message =
    'Please extend Ubud to five nights and leave on 17 November 2026. Keep it one destination, two adults and no children.';
  mock({
    reply: 'Five nights in Ubud are noted.',
    action: 'continue',
    brief: { ...workspace.brief, endDate: '2026-11-17' },
    facts: [{ field: 'endDate', evidence: 'leave on 17 November 2026' }],
    route: modelRoute([{ ...workspace.stops[0], nights: 5 }]),
    routeEvidence: message,
  });
  await reviewStudioBrief(workspace, message, defaultStudioAgency());
  assert.equal(workspace.stops[0].nights, 5);
  assert.equal(workspace.stops[0].departureDate, '2026-11-17');
  assert.equal(workspace.brief.endDate, '2026-11-17');
  assert.equal(workspace.clarification ?? null, null);
});
