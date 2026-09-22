import { afterEach, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.ts';

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  WEB_PORT: process.env.WEB_PORT,
  APP_ORIGIN: process.env.APP_ORIGIN,
};

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function appFor(
  t: TestContext,
  { production = false, webPort }: { production?: boolean; webPort?: string } = {},
) {
  process.env.NODE_ENV = production ? 'production' : 'development';
  if (webPort) process.env.WEB_PORT = webPort;
  else delete process.env.WEB_PORT;
  delete process.env.APP_ORIGIN;
  const app = createApp(':memory:');
  t.after(() => app.locals.db.close());
  return app;
}

function save(app: ReturnType<typeof createApp>, origin: string) {
  return request(app)
    .post('/api/saved')
    .set('Host', '127.0.0.1:3002')
    .set('Origin', origin)
    .set('Sec-Fetch-Site', 'same-site')
    .send({ type: 'destination', itemId: 'kyoto' });
}

test('development accepts loopback aliases on the configured frontend port', async (t) => {
  const app = appFor(t, { webPort: '5174' });
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const response = await save(app, `http://${hostname}:5174`).expect(201);
    assert.equal(response.body.item.itemId, 'kyoto');
  }
});

test('development defaults to port 5173 when WEB_PORT is unset', async (t) => {
  const app = appFor(t);
  for (const hostname of ['localhost', '127.0.0.1', '[::1]'])
    await save(app, `http://${hostname}:5173`).expect(201);
});

test('development rejects unrelated hosts and other frontend ports', async (t) => {
  const app = appFor(t, { webPort: '5174' });
  for (const origin of [
    'http://localhost:5173',
    'http://127.0.0.1:5175',
    'http://[::1]:5173',
    'http://localhost.example.test:5174',
    'https://untrusted.example.test',
  ]) {
    const response = await save(app, origin).expect(403);
    assert.equal(response.body.error, 'This origin is not allowed.');
  }
});

test('same-origin and explicitly configured origins remain allowed', async (t) => {
  const app = appFor(t, { webPort: '5174' });
  process.env.APP_ORIGIN = 'http://preview.example.test:8080';
  await save(app, 'http://127.0.0.1:3002').expect(201);
  await save(app, 'http://preview.example.test:8080').expect(201);
});

test('production accepts its explicit origin without allowing development aliases', async (t) => {
  const app = appFor(t, { production: true, webPort: '5174' });
  process.env.APP_ORIGIN = 'https://app.example.test';
  await save(app, 'https://app.example.test').expect(201);
  for (const hostname of ['localhost', '127.0.0.1', '[::1]'])
    await save(app, `http://${hostname}:5174`).expect(403);
});

test('cross-site requests remain forbidden even from a configured origin', async (t) => {
  const app = appFor(t, { webPort: '5174' });
  const response = await save(app, 'http://localhost:5174')
    .set('Sec-Fetch-Site', 'cross-site')
    .expect(403);
  assert.equal(response.body.error, 'Cross-site requests are not allowed.');
});
