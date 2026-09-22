import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { sessionCookieName } from '../server/config.ts';

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME,
};
const apps: ReturnType<typeof createApp>[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) app.locals.db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function appFor(port: string, database = ':memory:', name?: string) {
  process.env.NODE_ENV = 'development';
  process.env.PORT = port;
  if (name === undefined) delete process.env.SESSION_COOKIE_NAME;
  else process.env.SESSION_COOKIE_NAME = name;
  const app = createApp(database);
  apps.push(app);
  return app;
}

function databasePath() {
  const directory = mkdtempSync(join(tmpdir(), 'asktara-cookie-test-'));
  directories.push(directory);
  return join(directory, 'sessions.sqlite');
}

// Browser cookies are keyed by name and host, never by the port used in a URL.
function browserCookies() {
  const cookies = new Map<string, string>();
  return {
    cookies,
    async call(
      app: ReturnType<typeof createApp>,
      path: string,
      method: 'get' | 'post' = 'get',
      body?: object,
    ) {
      const pending = request(app)
        [method](path)
        .set('Host', 'localhost')
        .set('Cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
      if (body !== undefined) pending.send(body);
      const response = await pending;
      for (const header of response.headers['set-cookie'] || []) {
        const [name, value] = String(header).split(';')[0].split('=');
        cookies.set(name, value);
      }
      return response;
    },
  };
}

test('development cookie names separate API ports while production retains its default', () => {
  delete process.env.SESSION_COOKIE_NAME;
  delete process.env.PORT;
  process.env.NODE_ENV = 'development';
  assert.equal(sessionCookieName(), 'asktara_session_3001');
  process.env.PORT = '3002';
  assert.equal(sessionCookieName(), 'asktara_session_3002');
  process.env.NODE_ENV = 'production';
  assert.equal(sessionCookieName(), 'asktara_session');
  process.env.SESSION_COOKIE_NAME = 'custom_session';
  assert.equal(sessionCookieName(), 'custom_session');
  for (const invalid of ['', 'cookie name', 'cookie=value', 'cookie;other', 'x'.repeat(129)]) {
    process.env.SESSION_COOKIE_NAME = invalid;
    assert.throws(sessionCookieName, /SESSION_COOKIE_NAME must be a valid cookie name/);
  }
});

test('switching between local API instances keeps both guest sessions and saved data', async () => {
  const first = appFor('3001');
  const second = appFor('3002');
  const browser = browserCookies();
  assert.equal(
    (await browser.call(first, '/api/saved', 'post', { type: 'destination', itemId: 'kyoto' }))
      .status,
    201,
  );
  assert.equal(
    (await browser.call(second, '/api/saved', 'post', { type: 'destination', itemId: 'paris' }))
      .status,
    201,
  );
  assert.deepEqual([...browser.cookies.keys()].sort(), [
    'asktara_session_3001',
    'asktara_session_3002',
  ]);
  const originalTokens = [...browser.cookies];
  // A third, older checkout can overwrite the old name without affecting either app.
  browser.cookies.set('asktara_session', 'f'.repeat(64));
  for (let attempt = 0; attempt < 2; attempt++) {
    const firstSaved = await browser.call(first, '/api/saved');
    const secondSaved = await browser.call(second, '/api/saved');
    assert.equal(firstSaved.status, 200);
    assert.equal(secondSaved.status, 200);
    assert.deepEqual(
      firstSaved.body.items.map((item: { itemId: string }) => item.itemId),
      ['kyoto'],
    );
    assert.deepEqual(
      secondSaved.body.items.map((item: { itemId: string }) => item.itemId),
      ['paris'],
    );
    assert.equal(firstSaved.headers['set-cookie'], undefined);
    assert.equal(secondSaved.headers['set-cookie'], undefined);
  }
  for (const [name, token] of originalTokens) assert.equal(browser.cookies.get(name), token);
});

test('a valid legacy cookie migrates within its own database without losing the guest data', async () => {
  const file = databasePath();
  const legacy = appFor('3002', file, 'asktara_session');
  const browser = browserCookies();
  await browser.call(legacy, '/api/saved', 'post', { type: 'destination', itemId: 'kyoto' });
  const token = browser.cookies.get('asktara_session');
  const current = appFor('3002', file);
  const response = await browser.call(current, '/api/saved');
  assert.equal(response.status, 200);
  assert.equal(response.body.items[0].itemId, 'kyoto');
  assert.equal(browser.cookies.get('asktara_session_3002'), token);
  assert.equal(browser.cookies.get('asktara_session'), token);
  assert.equal(response.headers['set-cookie'].length, 1);

  // Logout revokes the migrated token so the remaining legacy cookie cannot restore it.
  assert.equal((await browser.call(current, '/api/auth/logout', 'post')).status, 200);
  browser.cookies.delete('asktara_session_3002');
  const afterLogout = await browser.call(current, '/api/saved');
  assert.deepEqual(afterLogout.body.items, []);
  assert.notEqual(browser.cookies.get('asktara_session_3002'), token);
});

test('a foreign legacy token starts a separate guest session and leaves the old cookie alone', async () => {
  const legacy = appFor('3001', ':memory:', 'asktara_session');
  const current = appFor('3002');
  const browser = browserCookies();
  await browser.call(legacy, '/api/saved', 'post', { type: 'destination', itemId: 'kyoto' });
  const legacyToken = browser.cookies.get('asktara_session');
  const response = await browser.call(current, '/api/saved');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.items, []);
  assert.notEqual(browser.cookies.get('asktara_session_3002'), legacyToken);
  assert.equal(browser.cookies.get('asktara_session'), legacyToken);
  assert.equal(response.headers['set-cookie'].length, 1);
});

test('an existing scoped cookie takes precedence over a valid legacy session', async () => {
  const file = databasePath();
  const legacy = appFor('3002', file, 'asktara_session');
  const browser = browserCookies();
  await browser.call(legacy, '/api/saved', 'post', { type: 'destination', itemId: 'kyoto' });
  const current = appFor('3002', file);
  browser.cookies.set('asktara_session_3002', 'f'.repeat(64));
  const response = await browser.call(current, '/api/saved');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.items, []);
  assert.notEqual(
    browser.cookies.get('asktara_session_3002'),
    browser.cookies.get('asktara_session'),
  );
});
