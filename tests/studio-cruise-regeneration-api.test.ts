import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import type { StudioWorkspace } from '../shared/studio.ts';
import type { StudioCruiseDraft } from '../shared/studio-cruise.ts';

// Actual HTTP/SQLite workflow; both intake and research model responses are mocked.
const originalFetch = globalThis.fetch;
const envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT', 'NODE_ENV'];
let previous: Record<string, string | undefined>;
const apps: ReturnType<typeof createApp>[] = [];
beforeEach(() => {
  previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.OPENAI_API_KEY = 'synthetic-cruise-regeneration-test-key';
  process.env.NODE_ENV = 'test';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => assert.fail('Unexpected external request');
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const app of apps.splice(0)) {
    await app.locals.studioActions.shutdown();
    await app.locals.planningRuns.shutdown();
    app.locals.db.close();
  }
  for (const name of envNames)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});
const source = { url: 'https://tourism.example/park', title: 'Official visitor park guide' };
const response = (data: unknown, research = false) =>
  Response.json({
    status: 'completed',
    output: [
      ...(research
        ? [{ type: 'web_search_call', status: 'completed', action: { sources: [source] } }]
        : []),
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
    ],
  });
const cruise: StudioCruiseDraft = {
  id: 'synthetic-preserved-cruise',
  name: 'Fictional Asian voyage',
  ship: 'Fictional ship',
  sourceUrl: '',
  sourceName: 'Reviewed authored fixture',
  extractedAt: '2026-10-01T00:00:00.000Z',
  fullFare: 4500,
  currency: 'USD',
  disembarkAfterDay: 3,
  onwardTransport: 'flight',
  returnTransport: 'undecided',
  warnings: [],
  days: ['Hong Kong', 'At sea', 'Keelung', 'Shanghai'].map((port, index) => ({
    id: `reviewed-${index + 1}`,
    day: index + 1,
    date: `2027-10-0${index + 1}`,
    port,
    arrival: '',
    departure: '',
    details: 'Reviewed source row.',
  })),
};

for (const endpoint of ['itinerary', 'review'] as const)
  test(`${endpoint} HTTP regeneration retains reviewed cruise transfers after a persisted preference edit`, async () => {
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
          brief: { adults: 2, children: 0, startDate: '2027-10-01', endDate: '2027-10-05' },
        })
        .expect(200)
    ).body.workspace;
    workspace = (
      await client
        .post(`${path}/cruises/apply`)
        .send({ revision: workspace.revision, cruise })
        .expect(200)
    ).body.workspace;
    const itinerary = structuredClone(workspace.itinerary!);
    const transfer = {
      period: 'evening' as const,
      title: 'Reviewed transfer to the Taipei hotel',
      description: 'Keep this separately reviewed hotel transfer. Confirm transport arrangements.',
      sources: [],
    };
    itinerary.days.at(-1)!.activities.push(transfer);
    workspace = (
      await client
        .patch(path)
        .send({
          revision: workspace.revision,
          itinerary,
          stops: [
            ...workspace.stops,
            {
              id: 'taipei-land',
              name: 'Taipei',
              country: 'Taiwan',
              nights: 2,
              arrivalDate: '2027-10-03',
              arrivalFixed: true,
              departureDate: '',
              onwardTransport: 'undecided',
              neighbourhood: '',
              notes: '',
            },
          ],
        })
        .expect(200)
    ).body.workspace;
    workspace = (
      await client
        .post(`${path}/accept-structure`)
        .send({ revision: workspace.revision })
        .expect(200)
    ).body.workspace;
    const originalCruiseRows = structuredClone(workspace.itinerary!.days);
    const originalItems = structuredClone(workspace.items);
    const originalRoute = structuredClone(workspace.stops);
    let intakeCalls = 0;
    let researchCalls = 0;
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      const payload = JSON.parse(body.input[0].content);
      if (body.text.format.name === 'studio_brief_review') {
        intakeCalls++;
        return response({
          reply: 'I will build the daily plan.',
          action: 'itinerary',
          brief: workspace.brief,
          facts: [],
          route: workspace.stops.map(({ id: _id, departureDate: _date, ...stop }) => stop),
          routeEvidence: '',
        });
      }
      assert.equal(body.text.format.name, 'studio_daily_itinerary');
      researchCalls++;
      assert.deepEqual(
        payload.slots.map((slot: { date: string }) => slot.date),
        ['2027-10-04', '2027-10-05'],
      );
      return response(
        {
          days: payload.slots.map((slot: { day: number; date: string; stopIds: string[] }) => ({
            ...slot,
            kind: undefined,
            title: 'Relaxed Taipei time',
            summary: 'A gentle land day with a flexible pace.',
            activities: [
              {
                period: 'afternoon',
                kind: 'research',
                title: 'Public park visit',
                description: 'Enjoy a gentle stroll and reconfirm visitor information.',
                sourceUrls: [source.url],
                serviceId: '',
              },
            ],
          })),
          notes: [],
        },
        true,
      );
    };
    const generate = async () => {
      const body = {
        revision: workspace.revision,
        requestId: randomUUID(),
        [endpoint === 'review' ? 'message' : 'instructions']:
          'Build the complete daily itinerary, preserving the reviewed cruise and hotel transfer.',
      };
      workspace = (await client.post(`${path}/${endpoint}`).send(body).expect(200)).body.workspace;
      assert.equal(workspace.itineraryManual, true);
      assert.equal(workspace.itinerary!.days.length, 5);
      for (const original of originalCruiseRows) {
        const retained = workspace.itinerary!.days.find(
          (day) => day.cruiseDayId === original.cruiseDayId,
        )!;
        assert.ok(retained);
        assert.equal(retained.cruiseId, original.cruiseId);
        assert.equal(retained.date, original.date);
        assert.equal(retained.title, original.title);
        assert.equal(retained.summary, original.summary);
        assert.deepEqual(retained.activities, original.activities);
      }
      assert.deepEqual(workspace.items, originalItems);
      assert.deepEqual(workspace.stops, originalRoute);
      assert.equal(workspace.cruises![0].fullFare, 4500);
      assert.ok(
        workspace
          .itinerary!.days.find((day) => day.cruiseDayId === 'reviewed-3')!
          .stopIds.includes('taipei-land'),
      );
    };
    await generate();
    workspace = (
      await client
        .patch(path)
        .send({
          revision: workspace.revision,
          brief: { interests: ['Quiet gardens'], foodPreferences: ['Vegetarian'] },
        })
        .expect(200)
    ).body.workspace;
    assert.equal(workspace.itineraryManual, true);
    assert.ok(
      workspace.itinerary!.days.some((day) =>
        day.activities.some((activity) => activity.title === transfer.title),
      ),
    );
    workspace = (await client.get(path).expect(200)).body.workspace;
    await generate();
    const reloaded = (await client.get(path).expect(200)).body.workspace as StudioWorkspace;
    assert.equal(reloaded.itineraryManual, true);
    assert.deepEqual(reloaded.itinerary, workspace.itinerary);
    assert.equal(intakeCalls, endpoint === 'review' ? 2 : 0);
    assert.equal(researchCalls, 2);
  });

test('chat preserves reviewed sea days after the final port without mistaking them for a route-end conflict', async () => {
  const app = createApp(':memory:');
  apps.push(app);
  const client = request.agent(app);
  let workspace = (await client.post('/api/studio/workspaces').send({}).expect(201)).body
    .workspace as StudioWorkspace;
  const path = `/api/studio/workspaces/${workspace.id}`;
  const tailCruise: StudioCruiseDraft = {
    ...cruise,
    id: 'sea-day-ending-cruise',
    disembarkAfterDay: null,
    days: ['Hong Kong', 'At sea', 'Keelung', 'At sea', 'At sea'].map((port, index) => ({
      id: `sea-tail-${index + 1}`,
      day: index + 1,
      date: `2027-10-0${index + 1}`,
      port,
      arrival: '',
      departure: '',
      details: 'Reviewed source row.',
    })),
  };
  workspace = (
    await client
      .post(`${path}/cruises/apply`)
      .send({ revision: workspace.revision, cruise: tailCruise })
      .expect(200)
  ).body.workspace;
  assert.equal(workspace.stops.at(-1)?.departureDate, '2027-10-03');
  assert.equal(workspace.brief.endDate, '2027-10-05');
  workspace = (
    await client.post(`${path}/accept-structure`).send({ revision: workspace.revision }).expect(200)
  ).body.workspace;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(
      body.text.format.name,
      'studio_brief_review',
      'Cruise-only schedule needs no extra research request.',
    );
    calls++;
    return response({
      reply: 'I will preserve the reviewed daily cruise plan.',
      action: 'itinerary',
      brief: workspace.brief,
      facts: [],
      route: workspace.stops.map(({ id: _id, departureDate: _date, ...stop }) => stop),
      routeEvidence: '',
    });
  };
  const result = (
    await client
      .post(`${path}/review`)
      .send({
        revision: workspace.revision,
        requestId: randomUUID(),
        message: 'Build the complete daily itinerary using the reviewed cruise schedule.',
      })
      .expect(200)
  ).body;
  workspace = result.workspace;
  assert.equal(result.nextAction, 'itinerary');
  assert.equal(workspace.stage, 'itinerary');
  assert.equal(workspace.structureAccepted, true);
  assert.equal(workspace.itineraryManual, true);
  assert.equal(workspace.itinerary!.days.length, 5);
  assert.equal(workspace.itinerary!.days.at(-1)!.cruiseDayId, 'sea-tail-5');
  assert.equal(workspace.itinerary!.days.at(-1)!.date, '2027-10-05');
  assert.equal(calls, 1);
});

test('route approval and chat reject a genuine combined cruise-end conflict', async () => {
  const app = createApp(':memory:');
  apps.push(app);
  const client = request.agent(app);
  let workspace = (await client.post('/api/studio/workspaces').send({}).expect(201)).body
    .workspace as StudioWorkspace;
  const path = `/api/studio/workspaces/${workspace.id}`;
  workspace = (
    await client
      .post(`${path}/cruises/apply`)
      .send({ revision: workspace.revision, cruise })
      .expect(200)
  ).body.workspace;
  workspace = (
    await client
      .patch(path)
      .send({ revision: workspace.revision, brief: { endDate: '2027-10-02' } })
      .expect(200)
  ).body.workspace;
  const rejected = await client
    .post(`${path}/accept-structure`)
    .send({ revision: workspace.revision })
    .expect(400);
  assert.match(rejected.body.error, /route end differs/i);
  globalThis.fetch = async (_url, options) => {
    assert.equal(JSON.parse(String(options?.body)).text.format.name, 'studio_brief_review');
    return response({
      reply: 'I will build the plan.',
      action: 'itinerary',
      brief: workspace.brief,
      facts: [],
      route: workspace.stops.map(({ id: _id, departureDate: _date, ...stop }) => stop),
      routeEvidence: '',
    });
  };
  const result = (
    await client
      .post(`${path}/review`)
      .send({
        revision: workspace.revision,
        requestId: randomUUID(),
        message: 'Build the complete daily itinerary.',
      })
      .expect(200)
  ).body;
  assert.equal(result.nextAction, 'structure');
  assert.match(result.reply, /end date differ/);
  assert.equal(result.workspace.itinerary.days.length, 3);
});

for (const dated of [true, false])
  test(`reviewed ${dated ? '366-day' : 'undated'} manual cruises remain approvable without AI generation limits`, async () => {
    const app = createApp(':memory:');
    apps.push(app);
    const client = request.agent(app);
    let workspace = (await client.post('/api/studio/workspaces').send({}).expect(201)).body
      .workspace as StudioWorkspace;
    const path = `/api/studio/workspaces/${workspace.id}`;
    const manualCruise: StudioCruiseDraft = {
      ...cruise,
      id: dated ? 'long-manual-cruise' : 'undated-manual-cruise',
      disembarkAfterDay: null,
      days: Array.from({ length: dated ? 366 : 3 }, (_, index) => ({
        id: `manual-${index}`,
        day: index + 1,
        date: dated
          ? new Date(Date.UTC(2027, 9, 1 + index)).toISOString().slice(0, 10)
          : `Day ${index + 1}`,
        port: dated && index === 0 ? 'Hong Kong' : 'At sea',
        arrival: '',
        departure: '',
        details: '',
      })),
    };
    workspace = (
      await client
        .post(`${path}/cruises/apply`)
        .send({ revision: workspace.revision, cruise: manualCruise })
        .expect(200)
    ).body.workspace;
    workspace = (
      await client
        .post(`${path}/accept-structure`)
        .send({ revision: workspace.revision })
        .expect(200)
    ).body.workspace;
    assert.equal(workspace.structureAccepted, true);
    assert.equal(workspace.itineraryManual, true);
    assert.equal(workspace.itinerary!.days.length, dated ? 366 : 3);
  });
