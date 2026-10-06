import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStudioAgency, type StudioStop, type StudioWorkspace } from '../shared/studio.ts';
import { newStudioWorkspace, StudioError } from '../server/studio-store.ts';
import { localStudioReview } from '../server/studio-local-intake.ts';
import { groundedStudioBrief, assertStudioRouteGrounding } from '../server/studio-grounding.ts';
import { applyStudioPatch } from '../server/studio-domain.ts';
import { buildStudioAssistantActions } from '../shared/studio-assistant.ts';
import {
  resolveStudioClarification,
  studioStayConfirmation,
} from '../server/studio-intake-continuity.ts';
import { reviewStudioBrief } from '../server/studio-models.ts';
import { runStudioAssistant } from '../server/studio-assistant.ts';

const agency = defaultStudioAgency();
const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = async () =>
    assert.fail('Short-query boundary tests must not call a provider.');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function turn(workspace: StudioWorkspace, content: string) {
  const reply = localStudioReview(workspace, content, agency);
  workspace.messages.push(
    {
      id: `user-${workspace.messages.length}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    },
    {
      id: `assistant-${workspace.messages.length}`,
      role: 'assistant',
      content: reply,
      createdAt: new Date().toISOString(),
    },
  );
  return reply;
}
const stop = (name: string, nights: number | null = null): StudioStop => ({
  id: name.toLowerCase(),
  name,
  country: name === 'Kyoto' ? 'Japan' : name === 'London' ? 'United Kingdom' : 'France',
  nights,
  arrivalDate: '',
  departureDate: '',
  onwardTransport: 'undecided',
  neighbourhood: '',
  notes: '',
});

test('a short Kyoto honeymoon conversation retains purpose, passport and explicit dates without inferring nights from days', () => {
  const workspace = newStudioWorkspace();
  turn(workspace, 'hi');
  turn(workspace, 'kyoto');
  const purpose = turn(workspace, 'honeymoon');
  assert.equal(workspace.stops[0].name, 'Kyoto');
  assert.equal(workspace.stops[0].country, 'Japan');
  assert.equal(workspace.brief.tripPurpose, 'tourism');
  assert.match(purpose, /Noted: travel purpose: tourism/);
  turn(workspace, '3 days');
  assert.equal(workspace.stops[0].nights, null);
  turn(workspace, 'three nights');
  turn(workspace, 'two');
  turn(workspace, 'no');
  turn(workspace, '18 Nov 2027');
  turn(workspace, 'budget AUD 6000');
  turn(workspace, '4 star');
  turn(workspace, 'Australian');
  assert.equal(workspace.brief.passportNationality, 'AU');
  assert.equal(workspace.brief.startDate, '2027-11-18');
  assert.equal(workspace.stops[0].nights, 3);
  assert.equal(workspace.stops[0].departureDate, '2027-11-21');
  assert.equal(workspace.brief.adults, 2);
  assert.equal(workspace.brief.children, 0);
  assert.equal(workspace.brief.budget, 6000);
  assert.equal(workspace.structureAccepted, false);
  assert.equal(workspace.itinerary, null);
  assert.equal(workspace.proposal, null);
});

test('tiny multi-city stay replies target one asked destination and preserve the other stops', () => {
  const workspace = newStudioWorkspace();
  const first = turn(workspace, 'Paris then London');
  assert.match(first, /How many nights would you like in Paris/);
  const ids = workspace.stops.map((entry) => entry.id);
  const second = turn(workspace, 'three');
  assert.match(second, /How many nights would you like in London/);
  assert.deepEqual(
    workspace.stops.map((entry) => entry.nights),
    [3, null],
  );
  const next = turn(workspace, 'two nights');
  assert.match(next, /How many adults/);
  assert.deepEqual(
    workspace.stops.map((entry) => entry.nights),
    [3, 2],
  );
  assert.deepEqual(
    workspace.stops.map((entry) => entry.id),
    ids,
  );
  const before = structuredClone(workspace.stops);
  turn(workspace, '3 nights');
  assert.deepEqual(
    workspace.stops,
    before,
    'An unprompted multi-stop duration must not pick a city.',
  );
});

test('a country-only idea accepts its explicitly named city sequence and keeps hotel nights unknown', async () => {
  const workspace = newStudioWorkspace();
  workspace.stops = [{ ...stop('Nepal'), country: 'NP' }];
  workspace.brief.preferredDestination = 'Nepal';
  workspace.brief.destinationCountry = 'NP';
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'short-query-mocked-unit-key';
  let calls = 0;
  try {
    for (const [message, nights] of [
      ['Kathmandu then Pokhara', null],
      ['Kathmandu 1 night', 1],
    ] as const) {
      globalThis.fetch = async () => {
        calls++;
        return Response.json({
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    brief: workspace.brief,
                    facts: [],
                    action: 'continue',
                    reply:
                      nights === null
                        ? 'How many nights in Kathmandu?'
                        : 'How many nights in Pokhara?',
                    route: [
                      { ...stop('Kathmandu', nights), country: 'NP' },
                      { ...stop('Pokhara'), country: 'Nepal' },
                    ].map(({ id: _id, departureDate: _date, ...entry }) => ({
                      ...entry,
                      arrivalFixed: false,
                    })),
                    routeEvidence: message,
                  }),
                },
              ],
            },
          ],
        });
      };
      await reviewStudioBrief(workspace, message, agency);
      assert.deepEqual(
        workspace.stops.map((entry) => entry.name),
        ['Kathmandu', 'Pokhara'],
      );
      assert.deepEqual(
        workspace.stops.map((entry) => entry.nights),
        [nights, null],
      );
      assert.equal(workspace.brief.passportNationality, '');
      assert.equal(workspace.itinerary, null);
      assert.equal(workspace.proposal, null);
    }
    assert.equal(calls, 2, 'Literal city refinement must not invoke a repair/repeat question.');
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test('country refinement cannot discard a confirmed city or add a city absent from the short answer', () => {
  const route = [stop('Nepal')];
  route[0].country = 'Nepal';
  const proposed = [
    { ...stop('Kathmandu'), country: 'NP' },
    { ...stop('Pokhara'), country: 'NP' },
  ];
  assert.doesNotThrow(() =>
    assertStudioRouteGrounding(
      route,
      proposed,
      'Kathmandu then Pokhara',
      [],
      'Kathmandu then Pokhara',
    ),
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        [stop('Paris')],
        proposed,
        'Kathmandu then Pokhara',
        [],
        'Kathmandu then Pokhara',
      ),
    StudioError,
  );
  assert.throws(
    () => assertStudioRouteGrounding(route, proposed, 'Kathmandu', [], 'Kathmandu'),
    StudioError,
  );
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        route,
        [
          { ...stop('Kathmandu'), country: 'NP' },
          { ...stop('Lima'), country: 'PE' },
        ],
        'Kathmandu then Lima',
        [],
        'Kathmandu then Lima',
      ),
    StudioError,
  );
  const local = newStudioWorkspace();
  local.stops = route;
  turn(local, 'Kathmandu then Pokhara');
  assert.deepEqual(
    local.stops.map((entry) => entry.name),
    ['Kathmandu', 'Pokhara'],
  );
  assert.deepEqual(
    local.stops.map((entry) => entry.nights),
    [null, null],
  );
});

test('an explicit tiny honeymoon purpose does not depend on the model emitting a separate purpose fact', () => {
  const current = newStudioWorkspace().brief;
  assert.equal(
    groundedStudioBrief(
      current,
      { ...current, context: 'honeymoon' },
      [{ field: 'context', evidence: 'honeymoon' }],
      'honeymoon',
      [],
    ).tripPurpose,
    'tourism',
  );
  assert.equal(
    groundedStudioBrief(current, current, [], 'tell me a honeymoon joke', []).tripPurpose,
    current.tripPurpose,
  );
  assert.equal(
    groundedStudioBrief(current, current, [], 'maybe a honeymoon', []).tripPurpose,
    current.tripPurpose,
  );
  assert.equal(
    groundedStudioBrief(current, current, [], 'business class', []).tripPurpose,
    current.tripPurpose,
  );
});

test('a short yes to children asks for the count rather than inventing it, then ages stay scoped to those children', () => {
  const workspace = newStudioWorkspace();
  turn(workspace, 'Paris for 3 nights');
  turn(workspace, '2 adults');
  const yes = turn(workspace, 'yes');
  assert.match(yes, /How many children/);
  assert.equal(workspace.brief.children, null);
  turn(workspace, 'two');
  assert.equal(workspace.brief.children, 2);
  assert.deepEqual(workspace.brief.childAges, []);
  turn(workspace, '8 and 12');
  assert.deepEqual(workspace.brief.childAges, [8, 12]);
  assert.equal(workspace.brief.adults, 2);
  assert.equal(workspace.stops[0].nights, 3);
});

test('clipped model evidence cannot confirm a negated or hypothetical travelling party', () => {
  const current = { ...newStudioWorkspace().brief, adults: 2, children: 1, childAges: [8] };
  for (const message of [
    'Not 5 adults.',
    'Maybe 5 adults.',
    'If 5 adults join.',
    'We might have 5 adults.',
  ]) {
    const result = groundedStudioBrief(
      current,
      { ...current, adults: 5 },
      [{ field: 'adults', evidence: '5 adults' }],
      message,
      [],
    );
    assert.equal(result.adults, 2, message);
  }
  for (const message of ['Not 2 children.', 'Maybe 2 children.', 'If 2 children join.']) {
    const result = groundedStudioBrief(
      current,
      { ...current, children: 2 },
      [{ field: 'children', evidence: '2 children' }],
      message,
      [],
    );
    assert.equal(result.children, 1, message);
    assert.deepEqual(result.childAges, [8], message);
  }
  const corrected = groundedStudioBrief(
    current,
    { ...current, adults: 99 },
    [{ field: 'adults', evidence: '5 adults' }],
    'Not 5 adults, 3 adults.',
    [],
  );
  assert.equal(corrected.adults, 3);
  const adultsAfterChildren = groundedStudioBrief(
    current,
    { ...current, adults: 5, children: 0 },
    [
      { field: 'adults', evidence: '5 adults' },
      { field: 'children', evidence: 'no children' },
    ],
    'No children and 5 adults.',
    [],
  );
  assert.equal(adultsAfterChildren.adults, 5);
  assert.equal(adultsAfterChildren.children, 0);
  const lastDeclaration = groundedStudioBrief(
    current,
    { ...current, adults: 3, children: 2 },
    [
      { field: 'adults', evidence: '3 adults' },
      { field: 'children', evidence: '2 children' },
    ],
    'We were travelling solo with no children last time; this trip has 3 adults and 2 children.',
    [],
  );
  assert.equal(lastDeclaration.adults, 3);
  assert.equal(lastDeclaration.children, 2);
});

test('live route validation accepts a tiny reply only for the uniquely named pending stop', () => {
  const current = [stop('Paris'), stop('London')];
  const context = {
    messages: [
      { role: 'assistant' as const, content: 'How many nights would you like in London?' },
    ],
  };
  for (const message of ['3', 'three', 'three nights']) {
    assert.doesNotThrow(() =>
      assertStudioRouteGrounding(
        current,
        [current[0], { ...current[1], nights: 3 }],
        message,
        [],
        message,
        context,
      ),
    );
    assert.throws(
      () =>
        assertStudioRouteGrounding(
          current,
          [{ ...current[0], nights: 3 }, current[1]],
          message,
          [],
          message,
          context,
        ),
      StudioError,
    );
  }
  assert.throws(
    () =>
      assertStudioRouteGrounding(
        current,
        [current[0], { ...current[1], nights: 3 }],
        '3',
        [],
        '3',
        {
          messages: [{ role: 'assistant', content: 'How many nights in Paris and London?' }],
        },
      ),
    StudioError,
  );
});

test('single-city relative night requests use the saved stay, while ambiguous or hypothetical changes remain unchanged', () => {
  for (const [message, expected] of [
    ['one more night', 4],
    ['add 2 nights', 5],
    ['one less night', 2],
    ['shorten it by one night', 2],
  ] as const) {
    const workspace = newStudioWorkspace();
    turn(workspace, 'Paris for 3 nights');
    const id = workspace.stops[0].id;
    turn(workspace, message);
    assert.equal(workspace.stops[0].nights, expected, message);
    assert.equal(workspace.stops[0].id, id);
    assert.equal(workspace.brief.adults, null);
    assert.doesNotThrow(() =>
      assertStudioRouteGrounding(
        [stop('Paris', 3)],
        [stop('Paris', expected)],
        message,
        [],
        message,
      ),
    );
  }
  const multiple = newStudioWorkspace();
  turn(multiple, 'Paris for 3 nights then London for 2 nights');
  const before = structuredClone(multiple.stops);
  turn(multiple, 'one more night');
  assert.deepEqual(multiple.stops, before);
  const single = newStudioWorkspace();
  turn(single, 'Paris for 3 nights');
  turn(single, 'maybe one more night');
  assert.equal(single.stops[0].nights, 3);
});

function conflictingStay() {
  const workspace = newStudioWorkspace();
  applyStudioPatch(
    workspace,
    {
      revision: workspace.revision,
      stops: [stop('London', 3)],
      brief: { startDate: '2027-10-03', endDate: '2027-10-06' },
    },
    agency,
  );
  workspace.clarification = {
    kind: 'stay_dates',
    stopId: 'london',
    arrivalDate: '2027-10-03',
    departureDate: '2027-10-08',
    statedNights: 3,
    proposedNights: 5,
  };
  workspace.messages.push({
    id: 'confirmation',
    role: 'assistant',
    content: studioStayConfirmation(workspace)!,
    createdAt: new Date().toISOString(),
  });
  return workspace;
}

test('a tiny explicit night choice resolves the pending contradiction without another model question', () => {
  for (const [answer, nights, end] of [
    ['three nights', 3, '2027-10-06'],
    ['5 nights', 5, '2027-10-08'],
    ['keep three nights', 3, '2027-10-06'],
  ] as const) {
    const workspace = conflictingStay();
    const reply = resolveStudioClarification(workspace, answer, agency);
    assert.match(reply || '', /Would you like me to build/);
    assert.equal(workspace.clarification, null);
    assert.equal(workspace.stops[0].nights, nights);
    assert.equal(workspace.brief.endDate, end);
  }
});

test('both generated confirmation button payloads deterministically apply their displayed alternative', () => {
  for (const choiceIndex of [0, 1]) {
    const workspace = conflictingStay();
    const choice = buildStudioAssistantActions(workspace)[0].choices![choiceIndex];
    assert.ok(resolveStudioClarification(workspace, choice.message, agency));
    assert.equal(workspace.clarification, null);
    assert.equal(workspace.stops[0].nights, choiceIndex === 0 ? 5 : 3);
  }
});

test('next-step suggestions respect external flight arrangements and do not promote unsupported family fares', () => {
  const workspace = newStudioWorkspace();
  applyStudioPatch(
    workspace,
    {
      revision: workspace.revision,
      stops: [stop('Kyoto', 3)],
      brief: { adults: 2, children: 0, startDate: '2027-11-18' },
    },
    agency,
  );
  workspace.structureAccepted = true;
  assert.ok(buildStudioAssistantActions(workspace).some((action) => action.kind === 'flights'));
  turn(workspace, 'Flights will be arranged separately.');
  assert.ok(!buildStudioAssistantActions(workspace).some((action) => action.kind === 'flights'));
  turn(workspace, 'Find flights for this trip now.');
  assert.ok(buildStudioAssistantActions(workspace).some((action) => action.kind === 'flights'));
  workspace.brief.children = 1;
  workspace.brief.childAges = [8];
  assert.ok(!buildStudioAssistantActions(workspace).some((action) => action.kind === 'flights'));
  assert.ok(buildStudioAssistantActions(workspace).some((action) => action.kind === 'activities'));
  assert.ok(buildStudioAssistantActions(workspace).some((action) => action.kind === 'preview'));
  assert.equal(workspace.proposal, null);
  assert.equal(workspace.items.length, 0);
});

test('itinerary completion copy does not promote flights outside the trip scope or unsupported family fares', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'short-query-completion-unit-key';
  const source = { url: 'https://tourism.example/garden', title: 'Visitor garden guide' };
  try {
    for (const party of [
      { children: 0, childAges: [], request: 'Flights arranged separately.' },
      { children: 1, childAges: [8], request: '' },
    ]) {
      const workspace = newStudioWorkspace();
      applyStudioPatch(
        workspace,
        {
          revision: workspace.revision,
          stops: [stop('Paris', 3)],
          brief: {
            adults: 2,
            children: party.children,
            childAges: party.childAges,
            startDate: '2027-11-18',
            request: party.request,
          },
        },
        agency,
      );
      let calls = 0;
      globalThis.fetch = async (_url, options) => {
        calls++;
        const body = JSON.parse(String(options?.body));
        const isReview = body.text.format.name === 'studio_brief_review';
        const input = JSON.parse(body.input[0].content);
        const data = isReview
          ? {
              brief: workspace.brief,
              facts: [],
              action: 'itinerary',
              reply: 'I can build the daily plan.',
              route: workspace.stops.map(({ id: _id, departureDate: _date, ...entry }) => ({
                ...entry,
                arrivalFixed: false,
              })),
              routeEvidence: '',
            }
          : {
              days: input.slots.map((slot: { day: number; date: string; stopIds: string[] }) => ({
                day: slot.day,
                date: slot.date,
                stopIds: slot.stopIds,
                title: 'Flexible garden day',
                summary: 'An optional visitor outing.',
                activities: [
                  {
                    kind: 'research',
                    period: 'flexible',
                    title: 'A garden visit',
                    description:
                      'Consider a garden outing at a relaxed pace; confirm visitor access before travelling.',
                    sourceUrls: [source.url],
                    serviceId: '',
                  },
                ],
              })),
              notes: [],
            };
        return Response.json({
          status: 'completed',
          output: [
            ...(!isReview
              ? [{ type: 'web_search_call', status: 'completed', action: { sources: [source] } }]
              : []),
            { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
          ],
        });
      };
      const completed = await runStudioAssistant(
        workspace,
        'Build our complete day-by-day itinerary.',
        agency,
      );
      assert.match(completed.reply, /review travel arrangements/);
      assert.doesNotMatch(completed.reply, /\bflights?\b/i);
      assert.ok(
        !buildStudioAssistantActions(workspace).some((action) => action.kind === 'flights'),
      );
      assert.equal(workspace.itinerary!.days.length, 4);
      assert.equal(workspace.proposal, null);
      assert.equal(workspace.items.length, 0);
      assert.equal(calls, 2);
    }
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
