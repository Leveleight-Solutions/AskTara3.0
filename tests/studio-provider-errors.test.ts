import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import type { StudioWorkspace } from '../shared/studio.ts';

const originalFetch = globalThis.fetch;
const envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT', 'NODE_ENV'];
let previous: Record<string, string | undefined>;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) delete process.env[name];
  process.env.NODE_ENV = 'test';
  process.env.OPENAI_API_KEY = 'mock-provider-error-test-key';
  globalThis.fetch = async () => {
    assert.fail('Unexpected external provider request');
  };
  app = createApp(':memory:');
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  await app.locals.studioActions.shutdown();
  await app.locals.planningRuns.shutdown();
  app.locals.db.close();
  for (const name of envNames)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});

test('Studio reports actionable provider failures without exposing provider bodies or changing the proposal', async (t) => {
  const logs: unknown[][] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => logs.push(args));
  t.mock.method(console, 'error', (...args: unknown[]) => logs.push(args));
  const client = request.agent(app);
  const workspace = (await client.post('/api/studio/workspaces').send({}).expect(201)).body
    .workspace as StudioWorkspace;
  const path = `/api/studio/workspaces/${workspace.id}`;
  const original = (await client.get(path).expect(200)).body.workspace;
  const cases = [
    { status: 401, code: 'OPENAI_ACCESS_DENIED', message: /API key and project permissions/ },
    { status: 403, code: 'OPENAI_ACCESS_DENIED', message: /API key and project permissions/ },
    { status: 404, code: 'OPENAI_MODEL_UNAVAILABLE', message: /model setting and project access/ },
    { status: 429, code: 'OPENAI_RATE_LIMITED', message: /quota and billing/ },
    { status: 400, code: 'OPENAI_UNAVAILABLE', message: /please retry/ },
    { status: 500, code: 'OPENAI_UNAVAILABLE', message: /please retry/ },
    { status: 0, code: 'OPENAI_UNAVAILABLE', message: /please retry/ },
  ];
  for (const failure of cases) {
    const providerResponse = failure.status
      ? new Response('PRIVATE_PROVIDER_BODY containing PRIVATE_CLIENT_DATA', {
          status: failure.status,
        })
      : undefined;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (!providerResponse) throw new Error('PRIVATE_NETWORK_DETAILS');
      return providerResponse;
    };
    const result = await client
      .post(`${path}/review`)
      .send({ revision: workspace.revision, requestId: randomUUID(), message: 'hi' })
      .expect(503);
    assert.equal(calls, 1);
    assert.equal(result.body.code, failure.code);
    assert.match(result.body.error, failure.message);
    assert.match(result.body.error, /Your saved workspace is unchanged/);
    assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_/);
    if (providerResponse) assert.equal(providerResponse.bodyUsed, false);
    const saved = (await client.get(path).expect(200)).body.workspace;
    assert.deepEqual(saved, original);
  }
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_/);
});

test('a failed Studio review can be retried after credentials are corrected', async () => {
  const client = request.agent(app);
  const workspace = (await client.post('/api/studio/workspaces').send({}).expect(201)).body
    .workspace as StudioWorkspace;
  const path = `/api/studio/workspaces/${workspace.id}`;
  const input = { revision: workspace.revision, requestId: randomUUID(), message: 'hi' };
  globalThis.fetch = async () => new Response('Private authentication failure', { status: 401 });
  await client.post(`${path}/review`).send(input).expect(503);
  const reply = 'Hi! Where would your client like to travel?';
  globalThis.fetch = async () =>
    Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                reply,
                brief: workspace.brief,
                facts: [],
                route: [],
                routeEvidence: '',
              }),
            },
          ],
        },
      ],
    });
  const recovered = await client.post(`${path}/review`).send(input).expect(200);
  assert.equal(recovered.body.mode, 'live');
  assert.equal(recovered.body.reply, reply);
  assert.equal(recovered.body.workspace.revision, workspace.revision + 1);
  assert.deepEqual(
    recovered.body.workspace.messages.map((message: { content: string }) => message.content),
    ['hi', reply],
  );
});

test('AI-only Studio actions explain the missing key and preserve the approved proposal', async () => {
  delete process.env.OPENAI_API_KEY;
  const client = request.agent(app);
  let workspace = (await client.post('/api/studio/workspaces').send({}).expect(201)).body
    .workspace as StudioWorkspace;
  const path = `/api/studio/workspaces/${workspace.id}`;
  workspace = (
    await client
      .patch(path)
      .send({
        revision: workspace.revision,
        stops: [
          {
            id: randomUUID(),
            name: 'Paris',
            country: 'France',
            nights: 3,
            arrivalDate: '',
            arrivalFixed: false,
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
    await client.post(`${path}/accept-structure`).send({ revision: workspace.revision }).expect(200)
  ).body.workspace;
  const result = await client
    .post(`${path}/recommendations`)
    .send({
      revision: workspace.revision,
      requestId: randomUUID(),
      category: 'activity',
      stopIds: [workspace.stops[0].id],
      interests: 'Museums',
    })
    .expect(503);
  assert.equal(result.body.code, 'OPENAI_NOT_CONFIGURED');
  assert.match(result.body.error, /Add an OpenAI API key to the server/);
  assert.match(result.body.error, /Your saved workspace is unchanged/);
  assert.deepEqual((await client.get(path).expect(200)).body.workspace, workspace);
});
