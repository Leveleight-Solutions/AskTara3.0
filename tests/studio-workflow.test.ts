import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';
import type { StudioItem, StudioStop, StudioWorkspace } from '../shared/studio.ts';

const originalFetch = globalThis.fetch;
const envNames = [
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_REASONING_EFFORT',
  'LITEAPI_API_KEY',
  'NODE_ENV',
];
let previous: Record<string, string | undefined>;
let apps: ReturnType<typeof createApp>[] = [];
let servers: Server[] = [];
beforeEach(() => {
  previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) delete process.env[name];
  process.env.NODE_ENV = 'test';
  process.env.OPENAI_API_KEY = 'mock-studio-workflow-key';
  globalThis.fetch = async () => {
    assert.fail('Unexpected external provider request');
  };
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const server of servers.filter((value) => value.listening))
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  servers = [];
  for (const app of apps) {
    await app.locals.studioActions.shutdown();
    await app.locals.planningRuns.shutdown();
    app.locals.db.close();
  }
  apps = [];
  for (const name of envNames)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});
function setup() {
  const app = createApp(':memory:');
  apps.push(app);
  return { app, client: request.agent(app) };
}
type Client = ReturnType<typeof request.agent>;
const create = async (client: Client): Promise<StudioWorkspace> =>
  (await client.post('/api/studio/workspaces').send({}).expect(201)).body.workspace;
const path = (workspace: StudioWorkspace, suffix = '') =>
  `/api/studio/workspaces/${workspace.id}${suffix}`;
const patch = async (
  client: Client,
  workspace: StudioWorkspace,
  update: Record<string, unknown>,
): Promise<StudioWorkspace> =>
  (
    await client
      .patch(path(workspace))
      .send({ revision: workspace.revision, ...update })
      .expect(200)
  ).body.workspace;
const stop = (name: string, nights: number | null = 4): StudioStop => ({
  id: randomUUID(),
  name,
  country: '',
  nights,
  arrivalDate: '',
  arrivalFixed: false,
  departureDate: '',
  onwardTransport: 'undecided',
  neighbourhood: '',
  notes: '',
});
const item = (stopId: string): StudioItem => ({
  id: randomUUID(),
  kind: 'hotel',
  title: 'Agent-entered hotel',
  description: 'Check-in with the supplier.',
  stopId,
  startDate: '2026-11-01',
  endDate: '2026-11-08',
  status: 'externally_booked',
  source: 'manual',
  sourceUrl: '',
  supplier: 'Example supplier',
  privateReference: 'PRIVATE-REF-ABC',
  price: 1200,
  currency: 'AUD',
  priceStatus: 'agent_estimate',
  quotedAt: '',
  included: true,
  needsReview: false,
  cost: 900,
});
const reviewData = (workspace: StudioWorkspace, overrides: Record<string, unknown> = {}) => ({
  reply: 'Review the missing details, then approve the route when ready.',
  brief: workspace.brief,
  facts: [],
  route: workspace.stops.map(({ id: _id, departureDate: _departureDate, ...entry }) => ({
    ...entry,
    arrivalFixed: Boolean(entry.arrivalFixed),
  })),
  routeEvidence: '',
  ...overrides,
});
const modelResponse = (data: unknown, source?: string) =>
  Response.json({
    status: 'completed',
    output: [
      ...(source
        ? [
            {
              type: 'web_search_call',
              status: 'completed',
              action: { sources: [{ title: 'Official visitor guide', url: source }] },
            },
          ]
        : []),
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
    ],
  });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('first AI review only extracts the brief and rejects model defaults without literal evidence', async () => {
  const { client } = setup();
  const workspace = await create(client);
  const message = 'London for 4 nights, for 2 adults.';
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.text.format.name, 'studio_brief_review');
    assert.equal(body.tools, undefined);
    assert.equal(body.store, false);
    assert.match(body.instructions, /approve the route first/);
    return modelResponse(
      reviewData(workspace, {
        brief: {
          ...workspace.brief,
          adults: 2,
          children: 0,
          budget: 1500,
          startDate: '2026-11-01',
          cabin: 'economy',
        },
        facts: [
          { field: 'adults', evidence: '2 adults' },
          { field: 'children', evidence: 'no children' },
          { field: 'budget', evidence: 'AUD 1500' },
          { field: 'startDate', evidence: 'November 1, 2026' },
          { field: 'cabin', evidence: 'economy' },
        ],
        route: [
          {
            name: 'London',
            country: 'United Kingdom',
            nights: 4,
            arrivalDate: '',
            arrivalFixed: false,
            onwardTransport: 'undecided',
            neighbourhood: '',
            notes: '',
          },
        ],
        routeEvidence: 'London for 4 nights',
      }),
    );
  };
  const result = await client
    .post(path(workspace, '/review'))
    .send({ revision: workspace.revision, requestId: randomUUID(), message })
    .expect(200);
  const saved = result.body.workspace as StudioWorkspace;
  assert.equal(calls, 1);
  assert.equal(saved.brief.adults, 2);
  assert.equal(saved.brief.children, null);
  assert.equal(saved.brief.budget, null);
  assert.equal(saved.brief.startDate, '');
  assert.equal(saved.brief.cabin, '');
  assert.equal(saved.stops[0].name, 'London');
  assert.equal(saved.stops[0].nights, 4);
  assert.equal(saved.structureAccepted, false);
  assert.deepEqual(saved.items, []);
  assert.deepEqual(saved.recommendations, []);
  assert.equal(saved.messages.length, 2);
  assert.ok(saved.qualification.questions.some((question) => question.id === 'children'));
});

test('qualification can be skipped but recommendation and import extraction wait for explicit route acceptance', async () => {
  const { client } = setup();
  let workspace = await create(client);
  workspace = await patch(client, workspace, { stops: [stop('Paris', null)] });
  const imported = await client
    .post(path(workspace, '/import'))
    .send({
      revision: workspace.revision,
      kind: 'text',
      name: 'Tour',
      text: 'A fictional Paris museum tour, date to confirm.',
    })
    .expect(200);
  workspace = imported.body.workspace;
  const docId = imported.body.import.id;
  const recommendations = {
    revision: workspace.revision,
    requestId: randomUUID(),
    category: 'activity',
    stopIds: [workspace.stops[0].id],
    interests: 'Museums',
  };
  await client.post(path(workspace, '/recommendations')).send(recommendations).expect(409);
  await client
    .post(path(workspace, `/imports/${docId}/extract`))
    .send({ revision: workspace.revision, requestId: randomUUID() })
    .expect(409);
  workspace = (
    await client
      .post(path(workspace, '/structure'))
      .send({ revision: workspace.revision, skipQualification: true })
      .expect(200)
  ).body.workspace;
  assert.equal(workspace.qualification.skipped, true);
  assert.equal(workspace.structureAccepted, false);
  assert.equal(workspace.brief.adults, null);
  assert.equal(workspace.brief.startDate, '');
  assert.ok(workspace.qualification.questions.length > 0);
  await client
    .post(path(workspace, '/recommendations'))
    .send({ ...recommendations, revision: workspace.revision, requestId: randomUUID() })
    .expect(409);
  workspace = (
    await client
      .post(path(workspace, '/accept-structure'))
      .send({ revision: workspace.revision })
      .expect(200)
  ).body.workspace;
  assert.equal(workspace.structureAccepted, true);
  let calls = 0;
  const source = 'https://www.paris.fr/pages/museums';
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.text.format.name, 'studio_destination_recommendations');
    assert.equal(body.tool_choice, 'required');
    return modelResponse(
      {
        recommendations: [
          {
            stopId: workspace.stops[0].id,
            name: 'A sourced museum',
            description: 'A collection to explore at your own pace. Check opening times.',
            sourceUrls: [source],
          },
        ],
      },
      source,
    );
  };
  const result = await client
    .post(path(workspace, '/recommendations'))
    .send({ ...recommendations, revision: workspace.revision, requestId: randomUUID() })
    .expect(200);
  assert.equal(calls, 1);
  assert.equal(result.body.workspace.recommendations.length, 1);
  assert.equal(result.body.workspace.recommendations[0].category, 'activity');
  assert.deepEqual(result.body.workspace.items, []);
});

test('researched recommendation inclusion accepts different JSON key order while protecting names and citations', async () => {
  const { client } = setup();
  let workspace = await create(client);
  workspace = await patch(client, workspace, { stops: [stop('Paris', 3)] });
  workspace = (
    await client
      .post(path(workspace, '/accept-structure'))
      .send({ revision: workspace.revision })
      .expect(200)
  ).body.workspace;
  const source = 'https://www.paris.fr/pages/museums';
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.text.format.name, 'studio_destination_recommendations');
    return modelResponse(
      {
        recommendations: [
          {
            stopId: workspace.stops[0].id,
            name: 'A sourced Paris museum',
            description: 'Explore the collection at your own pace.',
            sourceUrls: [source],
          },
        ],
      },
      source,
    );
  };
  workspace = (
    await client
      .post(path(workspace, '/recommendations'))
      .send({
        revision: workspace.revision,
        requestId: randomUUID(),
        category: 'activity',
        stopIds: [workspace.stops[0].id],
        interests: 'Museums',
      })
      .expect(200)
  ).body.workspace;
  const original = workspace.recommendations[0];
  assert.equal(original.included, false);
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  reordered.sources = original.sources.map((entry) =>
    Object.fromEntries(Object.entries(entry).reverse()),
  );
  assert.deepEqual(reordered, original);
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(original));
  workspace = await patch(client, workspace, {
    recommendations: [{ ...reordered, included: true }],
  });
  assert.equal(workspace.recommendations[0].included, true);
  assert.deepEqual(workspace.recommendations[0].sources, original.sources);
  assert.equal(workspace.recommendations[0].name, original.name);
  await client
    .patch(path(workspace))
    .send({
      revision: workspace.revision,
      recommendations: [{ ...reordered, included: true, name: 'A different unsupported museum' }],
    })
    .expect(400);
  await client
    .patch(path(workspace))
    .send({
      revision: workspace.revision,
      recommendations: [
        {
          ...reordered,
          included: true,
          sources: [
            { ...original.sources[0], url: 'https://unsupported.example.net/invented-source' },
          ],
        },
      ],
    })
    .expect(400);
  const unchanged = (await client.get(path(workspace)).expect(200)).body
    .workspace as StudioWorkspace;
  assert.equal(unchanged.revision, workspace.revision);
  assert.equal(unchanged.recommendations[0].included, true);
  assert.deepEqual(unchanged.recommendations[0].sources, original.sources);
  workspace = await patch(client, workspace, {
    recommendations: [{ ...reordered, included: false }],
  });
  assert.equal(workspace.recommendations[0].included, false);
  assert.equal(calls, 1);
});

test('long routes, reordering, night edits and fixed arrivals recalculate dates and invalidate accepted services', async () => {
  const { client } = setup();
  let workspace = await create(client);
  const stops = [stop('Paris', 7), stop('London', 7), stop('Rome', 7), stop('Athens', 6)];
  workspace = await patch(client, workspace, {
    brief: { startDate: '2026-11-01', adults: 2, children: 0 },
    stops,
  });
  assert.equal(
    workspace.stops.reduce((sum, entry) => sum + (entry.nights || 0), 0),
    27,
  );
  assert.equal(workspace.stops.at(-1)?.departureDate, '2026-11-28');
  workspace = await patch(client, workspace, { items: [item(stops[0].id)] });
  workspace = (
    await client
      .post(path(workspace, '/accept-structure'))
      .send({ revision: workspace.revision })
      .expect(200)
  ).body.workspace;
  assert.equal(workspace.structureAccepted, true);
  assert.equal(workspace.items[0].needsReview, false);
  const reordered = [
    workspace.stops[1],
    { ...workspace.stops[0], nights: 8 },
    workspace.stops[2],
    workspace.stops[3],
  ];
  workspace = await patch(client, workspace, { stops: reordered });
  assert.deepEqual(
    workspace.stops.map((entry) => entry.name),
    ['London', 'Paris', 'Rome', 'Athens'],
  );
  assert.deepEqual(
    workspace.stops.map((entry) => entry.arrivalDate),
    ['2026-11-01', '2026-11-08', '2026-11-16', '2026-11-23'],
  );
  assert.equal(workspace.structureAccepted, false);
  assert.equal(workspace.stage, 'structure');
  assert.equal(workspace.items[0].needsReview, true);
  const fixed = workspace.stops.map((entry, index) =>
    index === 2 ? { ...entry, arrivalDate: '2026-11-18', arrivalFixed: true } : entry,
  );
  workspace = await patch(client, workspace, { stops: fixed });
  assert.equal(workspace.stops[2].arrivalDate, '2026-11-18');
  assert.equal(workspace.stops[3].arrivalDate, '2026-11-25');
  assert.equal(workspace.stops[3].departureDate, '2026-12-01');
  const conflict = workspace.stops.map((entry, index) =>
    index === 2 ? { ...entry, arrivalDate: '2026-11-10' } : entry,
  );
  await client
    .patch(path(workspace))
    .send({ revision: workspace.revision, stops: conflict })
    .expect(400);
  await client
    .patch(path(workspace))
    .send({ revision: workspace.revision, brief: { startDate: '2026-02-30' } })
    .expect(400);
  assert.equal(
    (await client.get(path(workspace)).expect(200)).body.workspace.revision,
    workspace.revision,
  );
});

test('request IDs deduplicate concurrent reviews and stale model results cannot overwrite later edits', async () => {
  const { app } = setup();
  // A persistent local listener avoids Supertest closing its implicit server
  // between concurrent requests; this test exercises real HTTP concurrency.
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  const client = request.agent(server);
  let workspace = await create(client);
  let calls = 0;
  let entered = deferred<void>();
  let response = deferred<Response>();
  globalThis.fetch = async () => {
    calls++;
    entered.resolve();
    return response.promise;
  };
  const body = {
    revision: workspace.revision,
    requestId: randomUUID(),
    message: 'Please review this outline.',
  };
  const first = client
    .post(path(workspace, '/review'))
    .send(body)
    .then((result) => result);
  await entered.promise;
  const duplicate = client
    .post(path(workspace, '/review'))
    .send(body)
    .then((result) => result);
  response.resolve(modelResponse(reviewData(workspace)));
  const [one, two] = await Promise.all([first, duplicate]);
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  assert.equal(calls, 1);
  workspace = one.body.workspace;
  assert.equal(workspace.revision, body.revision + 1);
  assert.equal(workspace.messages.length, 2);
  workspace = await patch(client, workspace, { title: 'The agent’s latest title' });
  const replay = await client.post(path(workspace, '/review')).send(body).expect(200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.workspace.title, 'The agent’s latest title');
  await client
    .post(path(workspace, '/review'))
    .send({ ...body, message: 'Different request' })
    .expect(409);
  await client
    .post(path(workspace, '/review'))
    .send({ ...body, requestId: randomUUID() })
    .expect(409);
  assert.equal(calls, 1);
  entered = deferred<void>();
  response = deferred<Response>();
  const oldWorkspace = structuredClone(workspace);
  const pending = client
    .post(path(workspace, '/review'))
    .send({
      revision: workspace.revision,
      requestId: randomUUID(),
      message: 'Review while I edit.',
    })
    .then((result) => result);
  await entered.promise;
  workspace = await patch(client, workspace, { title: 'Saved while the model was running' });
  response.resolve(modelResponse(reviewData(oldWorkspace)));
  assert.equal((await pending).status, 409);
  const final = (await client.get(path(workspace)).expect(200)).body.workspace;
  assert.equal(final.title, 'Saved while the model was running');
  assert.equal(final.revision, workspace.revision);
  assert.equal(final.messages.length, 2);
  assert.equal(calls, 2);
});

test('workspace ownership, guest migration, export and account deletion also protect public proposals', async () => {
  const { app, client } = setup();
  const stranger = request.agent(app);
  let workspace = await create(client);
  workspace = await patch(client, workspace, {
    brief: {
      clientName: 'Fictional Client',
      context: 'PRIVATE CLIENT HISTORY',
      startDate: '2026-11-01',
      adults: 2,
      children: 0,
    },
    stops: [stop('Paris', 3)],
  });
  await client
    .patch('/api/studio/agency')
    .send({
      agency: { name: 'Fictional Test Agency', customQuestions: ['Any loyalty preference?'] },
    })
    .expect(200);
  await stranger.get(path(workspace)).expect(404);
  await stranger
    .patch(path(workspace))
    .send({ revision: workspace.revision, title: 'Intruder edit' })
    .expect(404);
  assert.deepEqual((await stranger.get('/api/studio/workspaces').expect(200)).body.workspaces, []);
  assert.deepEqual((await stranger.get('/api/studio/clients').expect(200)).body.clients, []);
  workspace = (
    await client
      .post(path(workspace, '/accept-structure'))
      .send({ revision: workspace.revision })
      .expect(200)
  ).body.workspace;
  const published = await client
    .post(path(workspace, '/proposal'))
    .send({ revision: workspace.revision })
    .expect(201);
  workspace = published.body.workspace;
  const token = published.body.proposal.token;
  const publicPath = `/api/studio/proposals/${token}`;
  const before = await stranger.get(publicPath).expect(200);
  assert.doesNotMatch(JSON.stringify(before.body), /PRIVATE CLIENT HISTORY/);
  const guestOwner = app.locals.db
    .prepare('SELECT owner_id FROM studio_workspaces WHERE id=?')
    .get(workspace.id).owner_id;
  const password = 'fictional-password-123';
  const registered = await client
    .post('/api/auth/register')
    .send({ name: 'Fictional Agent', email: 'studio-contract@example.com', password })
    .expect(201);
  const userId = registered.body.user.id;
  assert.notEqual(userId, guestOwner);
  assert.equal(
    app.locals.db.prepare('SELECT owner_id FROM studio_workspaces WHERE id=?').get(workspace.id)
      .owner_id,
    userId,
  );
  assert.equal(
    app.locals.db.prepare('SELECT owner_id FROM studio_proposals WHERE token=?').get(token)
      .owner_id,
    userId,
  );
  assert.equal(
    (await client.get('/api/studio/agency').expect(200)).body.agency.name,
    'Fictional Test Agency',
  );
  const exported = await client.get('/api/account/export').expect(200);
  assert.equal(exported.body.studio.workspaces[0].id, workspace.id);
  assert.equal(exported.body.studio.workspaces[0].brief.context, 'PRIVATE CLIENT HISTORY');
  assert.equal(exported.body.studio.workspaces[0].proposalPublished, true);
  assert.doesNotMatch(JSON.stringify(exported.body), new RegExp(token));
  const fresh = await create(client);
  assert.equal(fresh.brief.adults, null);
  assert.equal(fresh.brief.children, null);
  assert.equal(fresh.brief.clientName, '');
  await stranger.delete(path(workspace)).expect(404);
  await client
    .delete('/api/account')
    .send({ currentPassword: password, confirmation: 'DELETE' })
    .expect(200);
  await stranger.get(publicPath).expect(404);
  await stranger.get(`${publicPath}/pdf`).expect(404);
  assert.equal(
    app.locals.db.prepare('SELECT COUNT(*) AS count FROM studio_workspaces').get().count,
    0,
  );
  assert.equal(
    app.locals.db.prepare('SELECT COUNT(*) AS count FROM studio_proposals').get().count,
    0,
  );
  assert.equal(
    app.locals.db.prepare('SELECT COUNT(*) AS count FROM studio_agencies').get().count,
    0,
  );
});

test('reviewed imported PNR remains private and each source only creates excluded candidates once', async () => {
  const { client } = setup();
  let workspace = await create(client);
  workspace = await patch(client, workspace, { stops: [stop('London', 4)] });
  const sourceText =
    'PNR ABC123\nQF1 Sydney to London. Customer group price AUD 2400. Year unclear.';
  const saved = await client
    .post(path(workspace, '/import'))
    .send({ revision: workspace.revision, kind: 'text', name: 'Fictional PNR', text: sourceText })
    .expect(200);
  workspace = saved.body.workspace;
  assert.equal(workspace.imports[0].text, sourceText);
  assert.deepEqual(workspace.items, []);
  assert.equal(workspace.structureAccepted, false);
  const docId = saved.body.import.id;
  const preview = await client.get(path(workspace, '/proposal/preview')).expect(200);
  assert.doesNotMatch(JSON.stringify(preview.body), /ABC123|Fictional PNR|sourceText/);
  workspace = (
    await client
      .post(path(workspace, '/accept-structure'))
      .send({ revision: workspace.revision })
      .expect(200)
  ).body.workspace;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.text.format.name, 'studio_import_arrangements');
    assert.equal(body.tools, undefined);
    assert.equal(body.store, false);
    return modelResponse({
      items: [
        {
          kind: 'flight',
          title: 'QF1 Sydney to London',
          description: 'Flight details require agent review.',
          stopId: workspace.stops[0].id,
          startDate: '',
          endDate: '',
          supplier: 'Qantas',
          privateReference: 'ABC123',
          price: 2400,
          currency: 'AUD',
          evidence: 'QF1 Sydney to London. Customer group price AUD 2400.',
        },
      ],
    });
  };
  const body = { revision: workspace.revision, requestId: randomUUID() };
  const extracted = await client
    .post(path(workspace, `/imports/${docId}/extract`))
    .send(body)
    .expect(200);
  workspace = extracted.body.workspace;
  assert.equal(calls, 1);
  assert.equal(workspace.items.length, 1);
  assert.equal(workspace.items[0].included, false);
  assert.equal(workspace.items[0].needsReview, true);
  assert.equal(workspace.items[0].status, 'suggested');
  assert.equal(workspace.items[0].privateReference, 'ABC123');
  assert.equal(workspace.items[0].startDate, '');
  const replay = await client
    .post(path(workspace, `/imports/${docId}/extract`))
    .send(body)
    .expect(200);
  assert.equal(replay.body.workspace.items.length, 1);
  await client
    .post(path(workspace, `/imports/${docId}/extract`))
    .send({ revision: workspace.revision, requestId: randomUUID() })
    .expect(409);
  assert.equal(calls, 1);
  const publicPreview = await client.get(path(workspace, '/proposal/preview')).expect(200);
  assert.equal(publicPreview.body.proposal.items.length, 0);
  assert.doesNotMatch(JSON.stringify(publicPreview.body), /ABC123|Fictional PNR/);
});
