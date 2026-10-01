import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultStudioAgency } from '../shared/studio.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { applyStudioPatch } from '../server/studio-domain.ts';
import { localStudioReview } from '../server/studio-local-intake.ts';
import { resolveStudioClarification } from '../server/studio-intake-continuity.ts';
import { reviewStudioBrief } from '../server/studio-models.ts';

const agency = defaultStudioAgency();
function london() {
  const workspace = newStudioWorkspace();
  localStudioReview(workspace, 'London for 3 nights, starting 2026-10-03', agency);
  return workspace;
}
test('new dates conflicting with an existing stay preserve the old schedule until confirmed', () => {
  const workspace = london();
  const before = structuredClone(workspace.stops);
  const reply = localStudioReview(workspace, 'Return on 8 October 2026', agency);
  assert.equal(workspace.clarification?.proposedNights, 5);
  assert.equal(workspace.clarification?.statedNights, 3);
  assert.deepEqual(workspace.stops, before);
  assert.equal(workspace.brief.endDate, '');
  assert.match(reply, /Shall I use those dates and 5 nights/);
});
test('moving arrival during a conflicting edit cannot shift the old stay before confirmation', () => {
  const workspace = london();
  applyStudioPatch(
    workspace,
    { revision: workspace.revision, brief: { endDate: '2026-10-06' } },
    agency,
  );
  const before = structuredClone(workspace.stops);
  localStudioReview(
    workspace,
    'Arrive on 4 October 2026 and return on 8 October 2026 for 3 nights',
    agency,
  );
  assert.equal(workspace.clarification?.proposedNights, 4);
  assert.equal(workspace.brief.startDate, '2026-10-03');
  assert.equal(workspace.brief.endDate, '2026-10-06');
  assert.deepEqual(workspace.stops, before);
});
test('manual route edits clear the old confirmation so a later yes cannot undo the edit', () => {
  const workspace = london();
  localStudioReview(workspace, 'Return on 8 October 2026', agency);
  assert.ok(workspace.clarification);
  applyStudioPatch(
    workspace,
    {
      revision: workspace.revision,
      stops: [{ ...workspace.stops[0], nights: 2 }],
    },
    agency,
  );
  assert.equal(workspace.clarification, null);
  assert.equal(resolveStudioClarification(workspace, 'yes', agency), undefined);
  assert.equal(workspace.stops[0].nights, 2);
});
test('a yes to another question cannot silently accept a saved date proposal', () => {
  const workspace = london();
  localStudioReview(workspace, 'Return on 8 October 2026', agency);
  workspace.messages.push({
    id: 'other-question',
    role: 'assistant',
    content: 'Are you travelling solo?',
    createdAt: new Date().toISOString(),
  });
  const reply = resolveStudioClarification(workspace, 'yes', agency);
  assert.match(reply || '', /Shall I use those dates and 5 nights/);
  assert.equal(workspace.stops[0].nights, 3);
  assert.ok(workspace.clarification);
});

test('model repair retains a literal new night count and later-stop dates cannot move the first stop', async (t) => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'synthetic-date-unit-test';
  const workspace = london();
  const candidate = () => ({
    reply: 'The dates are noted.',
    action: 'continue',
    brief: workspace.brief,
    facts: [],
    route: workspace.stops.map(({ id: _id, departureDate: _end, ...stop }) => ({
      ...stop,
      arrivalFixed: Boolean(stop.arrivalFixed),
    })),
    routeEvidence: '',
  });
  let answer: ReturnType<typeof candidate> = {
    ...candidate(),
    route: candidate().route.map((stop) => ({ ...stop, nights: 5 })),
    routeEvidence: 'Change London to 4 nights',
  };
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      status: 'completed',
      output: [
        { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] },
      ],
    }),
  );
  try {
    await reviewStudioBrief(workspace, 'Change London to 4 nights', agency);
    assert.equal(workspace.stops[0].nights, 4);
    assert.equal(workspace.stops[0].departureDate, '2026-10-07');
    applyStudioPatch(
      workspace,
      {
        revision: workspace.revision,
        stops: [
          workspace.stops[0],
          {
            ...workspace.stops[0],
            id: 'paris',
            name: 'Paris',
            country: 'France',
            nights: 2,
            arrivalDate: '',
            arrivalFixed: false,
          },
        ],
      },
      agency,
    );
    answer = {
      ...candidate(),
      route: candidate().route.map((stop, index) =>
        index === 1 ? { ...stop, arrivalDate: '2026-10-10', arrivalFixed: true } : stop,
      ),
      routeEvidence: 'Arrive Paris on 10 October 2026',
    };
    await reviewStudioBrief(workspace, 'Arrive Paris on 10 October 2026', agency);
    assert.equal(workspace.brief.startDate, '2026-10-03');
    assert.equal(workspace.stops[0].arrivalDate, '2026-10-03');
    assert.equal(workspace.stops[1].arrivalDate, '2026-10-10');
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
