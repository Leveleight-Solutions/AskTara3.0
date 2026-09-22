import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../src/api.ts';

test('HTML from a frontend fallback is not accepted as a successful API save', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
  );
  await assert.rejects(
    api('/studio/workspaces', { method: 'POST', body: '{}' }),
    (error: unknown) =>
      error instanceof ApiError && error.status === 502 && error.code === 'INVALID_API_RESPONSE',
  );
});

test('malformed API JSON fails explicitly while successful empty deletions are accepted', async (t) => {
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  await assert.rejects(api('/studio/workspaces'), { code: 'INVALID_API_RESPONSE' });
  fetch.mock.mockImplementation(async () => new Response(null, { status: 204 }));
  assert.equal(await api('/studio/workspaces/example', { method: 'DELETE' }), undefined);
});

test('API errors retain validation/conflict details so the UI can recover correctly', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json(
      {
        error: 'Reload the current proposal before saving.',
        code: 'STUDIO_REVISION_CONFLICT',
      },
      { status: 409 },
    ),
  );
  await assert.rejects(api('/studio/workspaces/example', { method: 'PATCH', body: '{}' }), {
    status: 409,
    code: 'STUDIO_REVISION_CONFLICT',
    message: 'Reload the current proposal before saving.',
  });
});

test('a disconnected backend has a useful error without masking request cancellation', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(api('/session'), { code: 'BACKEND_UNAVAILABLE' });
  const cancelled = new DOMException('Aborted', 'AbortError');
  fetch.mock.mockImplementation(async () => {
    throw cancelled;
  });
  await assert.rejects(api('/session'), (error) => error === cancelled);
});

test('API requests retain cookies and caller headers and ask for JSON', async (t) => {
  t.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    assert.equal(path, '/api/profile');
    assert.equal(options.credentials, 'same-origin');
    const headers = new Headers(options.headers);
    assert.equal(headers.get('X-Request-ID'), 'local-test');
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.equal(headers.get('Accept'), 'application/json');
    return Response.json({ profile: { pace: 'relaxed' } });
  });
  assert.deepEqual(
    await api('/profile', {
      method: 'PATCH',
      body: '{"pace":"relaxed"}',
      headers: new Headers({ 'X-Request-ID': 'local-test' }),
    }),
    { profile: { pace: 'relaxed' } },
  );
});
