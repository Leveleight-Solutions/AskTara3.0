import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { defaultStudioAgency, type StudioWorkspace } from '../shared/studio.ts';
import {
  initializeStudioStorage,
  newStudioWorkspace,
  StudioStore,
} from '../server/studio-store.ts';
import { reviewStudioBrief } from '../server/studio-models.ts';

const originalFetch = globalThis.fetch;
const environmentKeys = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let previousEnvironment: Record<string, string | undefined>;
beforeEach(() => {
  previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  process.env.OPENAI_API_KEY = 'continuity-unit-test-only';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => assert.fail('Unexpected external request');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of environmentKeys)
    if (previousEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnvironment[key];
});

const response = (value: unknown) =>
  Response.json({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  });
const route = (name = 'London', nights: number | null = null) => ({
  name,
  country: name === 'London' ? 'United Kingdom' : 'France',
  nights,
  arrivalDate: '',
  arrivalFixed: false,
  onwardTransport: 'undecided' as const,
  neighbourhood: '',
  notes: '',
});
const review = (workspace: StudioWorkspace) => ({
  reply: 'What date will you arrive in London?',
  action: 'continue',
  brief: workspace.brief,
  facts: [],
  route: workspace.stops.map(({ id: _id, departureDate: _date, ...stop }) => stop),
  routeEvidence: '',
});

test('a rejected model route does not discard independently grounded client details', async () => {
  const workspace = newStudioWorkspace();
  workspace.stops = [{ ...route(), id: 'london', departureDate: '' }];
  const message = 'my name is abdullah i am from sydney having a australian passport';
  globalThis.fetch = async () =>
    response({
      ...review(workspace),
      brief: {
        ...workspace.brief,
        clientName: 'Abdullah',
        origin: 'Sydney',
        passportNationality: 'AU',
      },
      facts: [
        { field: 'clientName', evidence: 'my name is abdullah' },
        { field: 'origin', evidence: 'i am from sydney' },
        { field: 'passportNationality', evidence: 'a australian passport' },
      ],
      // Simulate a hallucinated route from an otherwise useful extraction.
      route: [route('Paris', 30)],
      routeEvidence: message,
    });
  await reviewStudioBrief(workspace, message, defaultStudioAgency());
  assert.equal(workspace.brief.clientName, 'Abdullah');
  assert.equal(workspace.brief.origin, 'Sydney');
  assert.equal(workspace.brief.passportNationality, 'AU');
  assert.equal(workspace.stops.length, 1);
  assert.equal(workspace.stops[0].name, 'London');
  assert.equal(workspace.stops[0].nights, null);
});

test('a date reference remains available after several clarification turns', async () => {
  const workspace = newStudioWorkspace();
  workspace.stops = [{ ...route(), id: 'london', departureDate: '' }];
  const initialRequest = 'i wanna go to london for a bussiness trip for 4 days on 3rd of october';
  const dialogue = [
    ['user', initialRequest],
    ['assistant', 'Is 3 October your arrival date or departure date?'],
    ['user', 'its my departure date'],
    ['assistant', 'Are you departing from Sydney?'],
    ['user', 'yes'],
    ['assistant', 'Is London the only destination?'],
    ['user', 'yes'],
    ['assistant', 'What date will you arrive in London?'],
  ] as const;
  workspace.messages = dialogue.map(([role, content], index) => ({
    id: `continuity-${index}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  }));
  let sentContext = '';
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    sentContext = body.input[0].content;
    return response(review(workspace));
  };
  await reviewStudioBrief(workspace, 'i will arrive on the same date', defaultStudioAgency());
  assert.ok(
    sentContext.includes(initialRequest),
    'The original user-supplied date must remain available when a follow-up references it.',
  );
});

test('the reported London conversation keeps details across reloads and resolves a focused date confirmation', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T06:00:00Z') });
  const db = new DatabaseSync(':memory:');
  initializeStudioStorage(db);
  const store = new StudioStore(db);
  let workspace = store.create('continuity-test-owner');
  const turn = async (message: string, candidate: Record<string, unknown>) => {
    globalThis.fetch = async () => response(candidate);
    const result = await reviewStudioBrief(workspace, message, defaultStudioAgency());
    workspace.messages.push(
      {
        id: `user-${workspace.revision}`,
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
      },
      {
        id: `assistant-${workspace.revision}`,
        role: 'assistant',
        content: result.reply,
        createdAt: new Date().toISOString(),
      },
    );
    store.save('continuity-test-owner', workspace, workspace.revision);
    workspace = store.require('continuity-test-owner', workspace.id);
    return result;
  };
  try {
    await turn('hi', {
      ...review(workspace),
      reply: 'Hi! Where would your client like to travel?',
    });
    assert.equal(workspace.stops.length, 0);
    await turn('my name is abdullah i am from sydney having a australian passport', {
      ...review(workspace),
      reply: 'Hi Abdullah — noted Sydney and your Australian passport. Where would you like to go?',
      brief: {
        ...workspace.brief,
        clientName: 'Abdullah',
        origin: 'Sydney',
        passportNationality: 'AU',
      },
      facts: [
        { field: 'clientName', evidence: 'my name is abdullah' },
        { field: 'origin', evidence: 'i am from sydney' },
        { field: 'passportNationality', evidence: 'a australian passport' },
      ],
    });
    assert.equal(workspace.brief.clientName, 'Abdullah');
    assert.equal(workspace.brief.origin, 'Sydney');
    assert.equal(workspace.brief.passportNationality, 'AU');
    const request = 'i wanna go to london for a bussiness trip for 4 days on 3rd of october';
    const destination = await turn(request, {
      ...review(workspace),
      reply: 'Is 3 October your arrival date in London or departure date from Sydney?',
      brief: { ...workspace.brief, preferredDestination: 'London', context: 'Business trip' },
      facts: [
        { field: 'preferredDestination', evidence: 'go to london' },
        { field: 'context', evidence: 'bussiness trip' },
      ],
      // Four days do not justify silently selecting three hotel nights.
      route: [route('London', 3)],
      routeEvidence: request,
    });
    assert.equal(workspace.stops.length, 1);
    assert.equal(workspace.stops[0].name, 'London');
    assert.equal(workspace.stops[0].nights, null);
    assert.equal(workspace.brief.startDate, '');
    assert.doesNotMatch(destination.reply, /Which destination|did not match|clarify that change/i);
    const stopId = workspace.stops[0].id;

    await turn('its my departure date', {
      ...review(workspace),
      reply: 'Understood — departing Sydney on 3 October. What date will you arrive in London?',
      brief: { ...workspace.brief, departureDate: '2026-10-03' },
      facts: [{ field: 'departureDate', evidence: 'its my departure date' }],
    });
    assert.equal(workspace.brief.departureDate, '2026-10-03');
    assert.equal(workspace.brief.startDate, '');
    await turn('i will arrive on the same date', {
      ...review(workspace),
      reply: 'Arriving in London on 3 October. How many nights will you stay?',
      brief: { ...workspace.brief, startDate: '2026-10-03' },
      facts: [{ field: 'startDate', evidence: 'i will arrive on the same date' }],
      route: [{ ...route(), arrivalDate: '2026-10-03', arrivalFixed: true }],
      routeEvidence: 'i will arrive on the same date',
    });
    assert.equal(workspace.brief.startDate, '2026-10-03');
    assert.equal(workspace.brief.departureDate, '2026-10-03');
    assert.equal(workspace.stops[0].arrivalDate, '2026-10-03');
    assert.equal(workspace.stops[0].id, stopId);

    const conflict = '3 nights stay arrival on 3rd and going back on 8th';
    const clarification = await turn(conflict, {
      ...review(workspace),
      reply: 'Which duration should I use?',
      brief: { ...workspace.brief, startDate: '2026-10-03', endDate: '2026-10-08' },
      facts: [
        { field: 'startDate', evidence: 'arrival on 3rd' },
        { field: 'endDate', evidence: 'going back on 8th' },
      ],
      route: [{ ...route('London', 3), arrivalDate: '2026-10-03', arrivalFixed: true }],
      routeEvidence: conflict,
    });
    assert.equal(workspace.clarification?.kind, 'stay_dates');
    assert.equal(workspace.clarification?.statedNights, 3);
    assert.equal(workspace.clarification?.proposedNights, 5);
    assert.match(clarification.reply, /five|5/i);
    assert.match(clarification.reply, /shall|should|use|confirm/i);

    await turn('yes', {
      ...review(workspace),
      reply: 'Confirmed, five nights in London. How many people are travelling?',
    });
    assert.equal(workspace.clarification ?? null, null);
    assert.equal(workspace.stops[0].nights, 5);
    assert.equal(workspace.stops[0].arrivalDate, '2026-10-03');
    assert.equal(workspace.stops[0].departureDate, '2026-10-08');
    assert.equal(workspace.brief.endDate, '2026-10-08');
    const stableRoute = structuredClone(workspace.stops);
    await turn('yes', {
      ...review(workspace),
      reply: 'How many adults will travel?',
    });
    assert.deepEqual(workspace.stops, stableRoute);
    assert.equal(workspace.brief.adults, null);
    assert.equal(workspace.brief.children, null);
    assert.equal(workspace.brief.clientName, 'Abdullah');
    assert.equal(workspace.brief.origin, 'Sydney');
    assert.equal(workspace.brief.passportNationality, 'AU');
    assert.equal(workspace.structureAccepted, false);
    assert.equal(workspace.itinerary ?? null, null);
  } finally {
    db.close();
  }
});

test('an existing conversation stuck on an either-or question gets one explicit confirmation before a bare yes is applied', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-01T06:00:00Z') });
  const workspace = newStudioWorkspace();
  workspace.brief.clientName = 'Abdullah';
  workspace.brief.origin = 'Sydney';
  workspace.brief.passportNationality = 'AU';
  workspace.stops = [{ ...route(), id: 'legacy-london', departureDate: '' }];
  const dialogue = [
    ['user', 'i wanna go to london for a bussiness trip for 4 days on 3rd of october'],
    ['assistant', 'Is 3 October 2026 your arrival date or departure date from Sydney?'],
    ['user', 'its my departure date'],
    ['assistant', 'What date will you arrive in London?'],
    ['user', 'i will arrive on the same date'],
    ['assistant', 'What arrival date and number of nights should I use for London?'],
    ['user', '3 nights stay arrival on 3rd and going back on 8th'],
    ['assistant', 'Should I use five nights, 3–8 October, or three nights, 3–6 October?'],
    ['user', 'yes'],
    [
      'assistant',
      'Would you like to leave London on 6 October (three nights) or 8 October (five nights)?',
    ],
  ] as const;
  workspace.messages = dialogue.map(([role, content], index) => ({
    id: `legacy-${index}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  }));
  globalThis.fetch = async () => response(review(workspace));
  const first = await reviewStudioBrief(workspace, 'yes', defaultStudioAgency());
  assert.equal(workspace.stops[0].nights, null, 'An old either-or answer cannot select an option.');
  assert.equal(workspace.clarification?.statedNights, 3);
  assert.equal(workspace.clarification?.proposedNights, 5);
  assert.match(first.reply, /shall|confirm/i);
  workspace.messages.push(
    { id: 'legacy-yes', role: 'user', content: 'yes', createdAt: new Date().toISOString() },
    {
      id: 'legacy-focus',
      role: 'assistant',
      content: first.reply,
      createdAt: new Date().toISOString(),
    },
  );
  await reviewStudioBrief(workspace, 'yes', defaultStudioAgency());
  assert.equal(workspace.clarification ?? null, null);
  assert.equal(workspace.stops[0].nights, 5);
  assert.equal(workspace.stops[0].arrivalDate, '2026-10-03');
  assert.equal(workspace.stops[0].departureDate, '2026-10-08');
  assert.equal(workspace.brief.clientName, 'Abdullah');
  assert.equal(workspace.brief.origin, 'Sydney');
  assert.equal(workspace.brief.passportNationality, 'AU');
});

test('both suggested stay choices resolve directly without another model interpretation', async () => {
  for (const [message, nights, endDate] of [
    ['Keep 3 nights', 3, '2026-10-06'],
    ['Use 5 nights', 5, '2026-10-08'],
    ['Use arrival 2026-10-03 and return 2026-10-06 for 3 nights in London.', 3, '2026-10-06'],
    ['Use arrival 2026-10-03 and return 2026-10-08 for 5 nights in London.', 5, '2026-10-08'],
  ] as const) {
    const workspace = newStudioWorkspace();
    workspace.brief.startDate = '2026-10-03';
    workspace.stops = [
      {
        ...route(),
        id: 'choice-london',
        arrivalDate: '2026-10-03',
        arrivalFixed: true,
        departureDate: '',
      },
    ];
    workspace.clarification = {
      kind: 'stay_dates',
      stopId: 'choice-london',
      arrivalDate: '2026-10-03',
      departureDate: '2026-10-08',
      statedNights: 3,
      proposedNights: 5,
    };
    await reviewStudioBrief(workspace, message, defaultStudioAgency());
    assert.equal(workspace.clarification ?? null, null);
    assert.equal(workspace.stops[0].nights, nights);
    assert.equal(workspace.stops[0].departureDate, endDate);
    assert.equal(workspace.brief.endDate, endDate);
  }
});
