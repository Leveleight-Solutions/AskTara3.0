import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { applyStudioPatch, replaceStudioRecommendations } from '../server/studio-domain.ts';
import { defaultStudioAgency, type StudioWorkspace } from '../shared/studio.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { reviewStudioBrief } from '../server/studio-models.ts';
import { buildStudioItinerarySlots } from '../server/studio-itinerary.ts';

const originalFetch = globalThis.fetch;
const keys = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT', 'NODE_ENV'];
let environment: Record<string, string | undefined>;
let apps: ReturnType<typeof createApp>[] = [];
beforeEach(() => {
  environment = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.OPENAI_API_KEY = 'mock-only';
  process.env.NODE_ENV = 'test';
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => {
    throw new Error('Unexpected external call');
  };
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const app of apps) {
    await app.locals.studioActions.shutdown();
    await app.locals.planningRuns.shutdown();
    app.locals.db.close();
  }
  apps = [];
  for (const key of keys)
    if (environment[key] === undefined) delete process.env[key];
    else process.env[key] = environment[key];
});
const source = { url: 'https://www.visitlondon.com/things-to-do', title: 'London visitor guide' };
const response = (value: unknown, research = false) =>
  Response.json({
    status: 'completed',
    output: [
      ...(research
        ? [{ type: 'web_search_call', status: 'completed', action: { sources: [source] } }]
        : []),
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
    ],
  });
const london = (nights: number | null = null) => ({
  name: 'London',
  country: 'United Kingdom',
  nights,
  arrivalDate: '',
  arrivalFixed: false,
  onwardTransport: 'undecided' as const,
  neighbourhood: '',
  notes: '',
});
const draft = () => {
  const workspace = newStudioWorkspace();
  workspace.stops = [{ ...london(3), id: 'london', departureDate: '' }];
  return workspace;
};
const reviewData = (workspace: StudioWorkspace, action = 'continue') => ({
  reply: 'Would you like me to build the daily itinerary?',
  action,
  brief: workspace.brief,
  facts: [],
  route: workspace.stops.map(({ id: _id, departureDate: _date, ...stop }) => stop),
  routeEvidence: '',
});

test('London follow-up through the HTTP conversation applies combined date and night answers', async () => {
  const app = createApp(':memory:');
  apps.push(app);
  const client = request.agent(app);
  let workspace = (await client.post('/api/studio/workspaces').send({}).expect(201)).body
    .workspace as StudioWorkspace;
  const path = `/api/studio/workspaces/${workspace.id}/review`;
  const turn = async (message: string, data: unknown) => {
    globalThis.fetch = async () => response(data);
    workspace = (
      await client
        .post(path)
        .send({ revision: workspace.revision, requestId: randomUUID(), message })
        .expect(200)
    ).body.workspace;
  };
  await turn('hi', { ...reviewData(workspace), reply: 'Hi! Where would you like to travel?' });
  await turn('to london', {
    ...reviewData(workspace),
    route: [london()],
    routeEvidence: 'to london',
    reply: 'When would you like to arrive and how many nights would you like to stay?',
  });
  const originalId = workspace.stops[0].id;
  await turn('18 November 2026, for 3 nights', {
    ...reviewData(workspace),
    brief: { ...workspace.brief, startDate: '2026-11-18' },
    facts: [],
    route: [{ ...london(3), arrivalDate: '2026-11-18', arrivalFixed: true }],
    routeEvidence: '18 November 2026, for 3 nights',
  });
  assert.equal(workspace.stops[0].id, originalId);
  assert.equal(workspace.stops[0].nights, 3);
  assert.equal(workspace.stops[0].arrivalDate, '2026-11-18');
  assert.equal(workspace.brief.startDate, '2026-11-18');
  assert.equal(workspace.stops[0].departureDate, '2026-11-21');
  assert.equal(workspace.messages.length, 6);
});

test('chat builds a sourced itinerary, replays without model charges, exports and clears stale plans on edits', async () => {
  const app = createApp(':memory:');
  apps.push(app);
  const client = request.agent(app);
  let workspace = (await client.post('/api/studio/workspaces').send({}).expect(201)).body
    .workspace as StudioWorkspace;
  const path = `/api/studio/workspaces/${workspace.id}`;
  workspace = (
    await client
      .patch(path)
      .send({
        revision: workspace.revision,
        stops: draft().stops,
        brief: { startDate: '2026-11-18' },
      })
      .expect(200)
  ).body.workspace;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    if (body.text.format.name === 'studio_brief_review')
      return response(reviewData(workspace, 'itinerary'));
    assert.equal(body.text.format.name, 'studio_daily_itinerary');
    const input = JSON.parse(body.input[0].content);
    return response(
      {
        days: input.slots.map((slot: { day: number; date: string; stopIds: string[] }) => ({
          day: slot.day,
          date: slot.date,
          stopIds: slot.stopIds,
          title: `London day ${slot.day}`,
          summary: 'A flexible day in London.',
          activities: [
            {
              period: 'flexible',
              kind: 'research',
              title: 'Explore London',
              description: 'Choose a visitor experience at a relaxed pace.',
              sourceUrls: [source.url],
              serviceId: '',
            },
          ],
        })),
        notes: ['Check opening dates before visiting.'],
      },
      true,
    );
  };
  const body = {
    revision: workspace.revision,
    requestId: randomUUID(),
    message: 'Build the complete day-by-day itinerary.',
  };
  const built = await client.post(`${path}/review`).send(body).expect(200);
  workspace = built.body.workspace;
  assert.equal(built.body.nextAction, 'itinerary');
  assert.equal(workspace.structureAccepted, true);
  assert.equal(workspace.stage, 'itinerary');
  assert.equal(workspace.itinerary!.days.length, 4);
  assert.deepEqual(
    workspace.itinerary!.days.map((day) => day.date),
    ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'],
  );
  assert.equal(workspace.proposal, null);
  assert.equal(workspace.items.length, 0);
  const replay = await client.post(`${path}/review`).send(body).expect(200);
  assert.equal(replay.body.replayed, true);
  assert.equal(calls, 2);
  assert.deepEqual(
    (await client.get(path).expect(200)).body.workspace.itinerary,
    workspace.itinerary,
  );
  const preview = (await client.get(`${path}/proposal/preview`).expect(200)).body.proposal;
  assert.equal(preview.itinerary.days.length, 4);
  await client.get(`${path}/proposal/preview/pdf`).expect(200).expect('Content-Type', /pdf/);
  workspace = (
    await client
      .patch(path)
      .send({ revision: workspace.revision, brief: { interests: ['Quieter museums'] } })
      .expect(200)
  ).body.workspace;
  assert.equal(workspace.itinerary, null);
  assert.equal(workspace.structureAccepted, true);
});

test('failed itinerary generation leaves the entire saved conversation and route unchanged', async () => {
  const app = createApp(':memory:');
  apps.push(app);
  const client = request.agent(app);
  let workspace = (await client.post('/api/studio/workspaces').send({}).expect(201)).body
    .workspace as StudioWorkspace;
  const path = `/api/studio/workspaces/${workspace.id}`;
  workspace = (
    await client
      .patch(path)
      .send({ revision: workspace.revision, stops: draft().stops })
      .expect(200)
  ).body.workspace;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.text.format.name === 'studio_brief_review')
      return response(reviewData(workspace, 'itinerary'));
    return new Response('', { status: 429 });
  };
  await client
    .post(`${path}/review`)
    .send({
      revision: workspace.revision,
      requestId: randomUUID(),
      message: 'Build the complete itinerary.',
    })
    .expect(503);
  assert.deepEqual((await client.get(path).expect(200)).body.workspace, workspace);
});

test('unreliable model route changes get one repair and then a clarification without changing the route', async () => {
  const workspace = draft();
  const before = structuredClone(workspace);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return response({
      ...reviewData(workspace),
      route: [{ ...london(30), name: 'Paris' }],
      routeEvidence: '3 nights',
    });
  };
  const result = await reviewStudioBrief(workspace, '3 nights', defaultStudioAgency());
  assert.equal(calls, 2);
  assert.match(result.reply, /clarify/);
  assert.deepEqual(workspace, before);
});

test('conversation-only changes preserve a daily plan but route changes invalidate it', () => {
  const workspace = draft();
  workspace.itinerary = {
    generatedAt: new Date().toISOString(),
    days: [
      {
        day: 1,
        date: '',
        stopIds: ['london'],
        title: 'London',
        summary: '',
        activities: [{ period: 'flexible', title: 'Free time', description: '', sources: [] }],
      },
    ],
    notes: [],
  };
  applyStudioPatch(
    workspace,
    { revision: workspace.revision, brief: { request: 'Thanks' } },
    defaultStudioAgency(),
  );
  assert.ok(workspace.itinerary);
  applyStudioPatch(
    workspace,
    { revision: workspace.revision, stops: [{ ...workspace.stops[0], nights: 4 }] },
    defaultStudioAgency(),
  );
  assert.equal(workspace.itinerary, null);
});

test('a newly grounded arrival correction updates an older fixed first-stop arrival', async () => {
  const workspace = draft();
  workspace.brief.startDate = '2026-11-18';
  workspace.stops[0] = {
    ...workspace.stops[0],
    arrivalDate: '2026-11-18',
    arrivalFixed: true,
    departureDate: '2026-11-21',
  };
  globalThis.fetch = async () =>
    response({
      ...reviewData(workspace),
      brief: { ...workspace.brief, startDate: '2026-11-20' },
      facts: [{ field: 'startDate', evidence: 'Arrive on 20 November 2026' }],
    });
  await reviewStudioBrief(workspace, 'Arrive on 20 November 2026', defaultStudioAgency());
  assert.equal(workspace.brief.startDate, '2026-11-20');
  assert.equal(workspace.stops[0].arrivalDate, '2026-11-20');
  assert.equal(workspace.stops[0].departureDate, '2026-11-23');
});

test('a direct daily plan cannot contradict an explicitly requested end date', () => {
  const workspace = draft();
  workspace.structureAccepted = true;
  workspace.brief.startDate = '2026-11-18';
  workspace.brief.endDate = '2026-11-25';
  assert.throws(() => buildStudioItinerarySlots(workspace), /end date|end.*differ/i);
});

test('replacing included recommendations clears their daily plan and rejects oversized research atomically', () => {
  const workspace = draft();
  workspace.itinerary = { generatedAt: new Date().toISOString(), days: [], notes: [] };
  const idea = {
    id: 'old',
    stopId: 'london',
    name: 'Museum',
    category: 'activity' as const,
    description: '',
    sources: [],
    included: true,
  };
  workspace.recommendations = [idea];
  replaceStudioRecommendations(workspace, ['london'], 'activity', [
    { ...idea, id: 'new', included: false },
  ]);
  assert.equal(workspace.itinerary, null);
  assert.equal(workspace.recommendations[0].id, 'new');
  const before = structuredClone(workspace);
  assert.throws(
    () =>
      replaceStudioRecommendations(
        workspace,
        ['london'],
        'food',
        Array.from({ length: 120 }, (_, index) => ({
          ...idea,
          category: 'food',
          id: `food-${index}`,
          included: false,
        })),
      ),
    /120 recommendations/,
  );
  assert.deepEqual(workspace, before);
});
