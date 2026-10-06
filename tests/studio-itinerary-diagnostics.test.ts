import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { generateStudioItinerary, buildStudioItinerarySlots } from '../server/studio-itinerary.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { OpenAIPlanningError } from '../server/agents/openai.ts';

const originalFetch = globalThis.fetch;
const envKeys = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.OPENAI_API_KEY = 'unit-test-itinerary-diagnostics';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys)
    previous[key] === undefined ? delete process.env[key] : (process.env[key] = previous[key]);
});
function trip() {
  const workspace = newStudioWorkspace();
  workspace.structureAccepted = true;
  workspace.brief.clientName = 'FICTIONAL_PRIVATE_CLIENT';
  workspace.stops = [
    {
      id: 'tokyo',
      name: 'Tokyo',
      country: 'JP',
      nights: 1,
      arrivalDate: '',
      departureDate: '',
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
  return workspace;
}
function unsourced(workspace: ReturnType<typeof trip>) {
  return Response.json({
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: {
          sources: [{ url: 'https://www.gotokyo.org/en/', title: 'Official test tourism guide' }],
        },
      },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              days: buildStudioItinerarySlots(workspace).map((slot) => ({
                day: slot.day,
                date: slot.date,
                stopIds: slot.stopIds,
                title: 'Flexible city day',
                summary: 'An unhurried visit.',
                activities: [
                  {
                    period: 'flexible',
                    kind: 'research',
                    title: 'A city garden',
                    description: 'Reconfirm visitor guidance before travelling.',
                    sourceUrls: ['https://invented.example/FICTIONAL_PRIVATE_URL'],
                    serviceId: '',
                  },
                ],
              })),
              notes: [],
            }),
          },
        ],
      },
    ],
  });
}

test('initial itinerary provider failure logs only a fixed phase/reason and numeric scope, leaving the trip unchanged', async (context) => {
  const workspace = trip(),
    before = structuredClone(workspace),
    logged: unknown[][] = [];
  context.mock.method(console, 'warn', (...args: unknown[]) => logged.push(args));
  globalThis.fetch = async () => {
    throw new Error('FICTIONAL_PRIVATE_CLIENT sk-fake-sensitive-error-body');
  };
  await assert.rejects(
    generateStudioItinerary(workspace, ''),
    (error: unknown) => error instanceof OpenAIPlanningError && error.code === 'OPENAI_UNAVAILABLE',
  );
  assert.deepEqual(workspace, before);
  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], 'Studio itinerary generation failed');
  const metadata = logged[0][1] as Record<string, unknown>;
  assert.equal(metadata.phase, 'initial');
  assert.equal(metadata.reason, 'OPENAI_UNAVAILABLE');
  assert.equal(metadata.days, 2);
  assert.equal(metadata.stops, 1);
  assert.deepEqual(Object.keys(metadata).sort(), [
    'days',
    'elapsedMs',
    'phase',
    'reason',
    'remainingMs',
    'stops',
  ]);
  assert.doesNotMatch(
    JSON.stringify(logged),
    /FICTIONAL_PRIVATE|sk-fake|error-body|payload|request/,
  );
});

test('a source-validation repair is distinguished from an initial provider outage without logging rejected URLs or raw output', async (context) => {
  const workspace = trip(),
    before = structuredClone(workspace),
    warned: unknown[][] = [],
    repaired: unknown[][] = [];
  context.mock.method(console, 'warn', (...args: unknown[]) => warned.push(args));
  context.mock.method(console, 'info', (...args: unknown[]) => repaired.push(args));
  let calls = 0;
  globalThis.fetch = async () => {
    if (++calls === 1) return unsourced(workspace);
    throw new Error('FICTIONAL_PRIVATE_PROVIDER_ERROR');
  };
  await assert.rejects(
    generateStudioItinerary(workspace, ''),
    (error: unknown) => error instanceof OpenAIPlanningError && error.code === 'OPENAI_UNAVAILABLE',
  );
  assert.equal(calls, 2);
  assert.deepEqual(workspace, before);
  assert.equal(repaired.length, 1);
  assert.equal((repaired[0][1] as { reason: string }).reason, 'research_citation');
  assert.equal((warned[0][1] as { phase: string }).phase, 'repair');
  assert.equal((warned[0][1] as { reason: string }).reason, 'OPENAI_UNAVAILABLE');
  assert.doesNotMatch(
    JSON.stringify([warned, repaired]),
    /FICTIONAL_PRIVATE|invented\.example|sourceUrls|CLIENT|PROVIDER_ERROR/,
  );
});
