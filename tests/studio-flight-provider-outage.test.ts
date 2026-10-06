import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { searchFlights, ProviderError } from '../server/integrations.ts';
import { createApp } from '../server/app.ts';
import type { StudioWorkspace } from '../shared/studio.ts';

const originalFetch = globalThis.fetch;
const envNames = [
  'LITEAPI_API_KEY',
  'LITEAPI_MODE',
  'DUFFEL_ACCESS_TOKEN',
  'NODE_ENV',
  'OPENAI_API_KEY',
];
let previous: Record<string, string | undefined>;
const apps: ReturnType<typeof createApp>[] = [];
const query = {
  origin: 'DUB',
  destination: 'LIS',
  departureDate: '2027-11-15',
  adults: 2,
  cabinClass: 'economy' as const,
};
beforeEach(() => {
  previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.NODE_ENV = 'test';
  process.env.LITEAPI_API_KEY = 'sand_provider_outage_fixture';
  delete process.env.DUFFEL_ACCESS_TOKEN;
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async () => assert.fail('Unexpected external request');
});
afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.locals.studioActions.shutdown();
    await app.locals.planningRuns.shutdown();
    app.locals.db.close();
  }
  globalThis.fetch = originalFetch;
  for (const name of envNames)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});

test('LiteAPI flight 5xx and network failures report a temporary provider outage without blaming valid airports or retrying', async () => {
  for (const status of [500, 502, 503, 504, 0]) {
    let calls = 0;
    globalThis.fetch = async (input, options) => {
      calls++;
      assert.equal(String(input), 'https://api.liteapi.travel/v3.0/flights/rates');
      assert.deepEqual(JSON.parse(String(options?.body)).legs, [
        { origin: 'DUB', destination: 'LIS', date: '2027-11-15' },
      ]);
      if (!status) throw new TypeError('PRIVATE NETWORK FAILURE');
      return Response.json(
        { error: { code: 51099, message: 'PRIVATE PROVIDER BODY' } },
        { status },
      );
    };
    await assert.rejects(searchFlights(query), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 503);
      assert.equal(error.code, 'FLIGHTS_PROVIDER_UNAVAILABLE');
      assert.match(error.message, /temporarily unavailable/i);
      assert.doesNotMatch(error.message, /Check the airports|dates|PRIVATE|51099/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('Duffel flight 5xx uses the same stable outage contract and never falls back to another supplier', async () => {
  process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_provider_outage_fixture';
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    assert.match(String(input), /^https:\/\/api\.duffel\.com\/air\/offer_requests/);
    return Response.json({ errors: [{ message: 'PRIVATE SUPPLIER DETAIL' }] }, { status: 503 });
  };
  await assert.rejects(
    searchFlights(query),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === 'FLIGHTS_PROVIDER_UNAVAILABLE' &&
      error.status === 503,
  );
  assert.equal(calls, 1);
});

test('invalid credentials retain their specific error rather than being presented as a temporary outage', async () => {
  globalThis.fetch = async () => Response.json({ error: 'PRIVATE ERROR' }, { status: 401 });
  await assert.rejects(searchFlights(query), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.status, 502);
    assert.notEqual(error.code, 'FLIGHTS_PROVIDER_UNAVAILABLE');
    assert.match(error.message, /rejected the credentials/);
    assert.doesNotMatch(error.message, /PRIVATE ERROR/);
    return true;
  });
});

test('Studio API propagates supplier-unavailable code and leaves quotes, items and trip revision unchanged', async () => {
  const app = createApp(':memory:');
  apps.push(app);
  const client = request.agent(app);
  let workspace: StudioWorkspace = (
    await client.post('/api/studio/workspaces').send({}).expect(201)
  ).body.workspace;
  const path = `/api/studio/workspaces/${workspace.id}`;
  workspace = (
    await client
      .patch(path)
      .send({
        revision: workspace.revision,
        brief: {
          origin: 'DUB',
          adults: 2,
          children: 0,
          departureDate: '2027-11-15',
          startDate: '2027-11-15',
          endDate: '2027-11-19',
          outboundTransport: 'flight',
          returnTransport: 'flight',
        },
        stops: [
          {
            id: 'lisbon',
            name: 'Lisbon',
            country: 'PT',
            nights: 4,
            arrivalDate: '2027-11-15',
            departureDate: '2027-11-19',
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
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    assert.equal(String(input), 'https://api.liteapi.travel/v3.0/flights/rates');
    return Response.json(
      { error: { code: 51099, message: 'PRIVATE PROVIDER BODY' } },
      { status: 500 },
    );
  };
  const failed = await client
    .post(`${path}/flights/search`)
    .send({ revision: workspace.revision, ...query })
    .expect(503);
  assert.equal(failed.body.code, 'FLIGHTS_PROVIDER_UNAVAILABLE');
  assert.match(failed.body.error, /temporarily unavailable/i);
  assert.doesNotMatch(JSON.stringify(failed.body), /PRIVATE|51099|Check the airports/);
  assert.equal(calls, 1);
  assert.equal(
    app.locals.db
      .prepare('SELECT count(*) AS count FROM studio_quotes WHERE workspace_id=?')
      .get(workspace.id).count,
    0,
  );
  const unchanged: StudioWorkspace = (await client.get(path).expect(200)).body.workspace;
  assert.equal(unchanged.revision, workspace.revision);
  assert.deepEqual(unchanged.items, workspace.items);
  assert.deepEqual(unchanged.stops, workspace.stops);
  assert.equal(unchanged.proposal, null);
});
