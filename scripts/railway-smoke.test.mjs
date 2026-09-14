import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSmoke } from './railway-smoke.mjs';

const origin = 'https://asktara.example.test';
const session = 'private-smoke-session';
const hiddenKey = 'private-key-must-never-be-logged';
function fixture({
  configured = false,
  flightFailure = false,
  aiFallback = false,
  htmlHealth = false,
} = {}) {
  const requests = [];
  let trip,
    run,
    deleted = false;
  const json = (body, status = 200, headers = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  const html =
    '<html><title>Asktara</title><div id="root"></div><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css"></html>';
  async function fetchImpl(url, options) {
    const path = url.pathname,
      method = options.method;
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ path, method, body });
    assert.equal(url.origin, origin);
    assert.equal(options.redirect, 'manual');
    if (method !== 'GET') assert.equal(options.headers.Origin, origin);
    if (path === '/' || path === '/chat/deployment-smoke')
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    if (path === '/assets/app.js')
      return new Response('/* built app */'.repeat(20), {
        headers: { 'Content-Type': 'application/javascript' },
      });
    if (path === '/assets/app.css')
      return new Response('body { color: black; }'.repeat(20), {
        headers: { 'Content-Type': 'text/css' },
      });
    if (path === '/api/health') {
      if (htmlHealth) return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      return json({ status: 'ok', service: 'asktara', database: 'connected' }, 200, {
        'Set-Cookie': `asktara_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      });
    }
    const owned = options.headers.Cookie === `asktara_session=${session}`;
    if (path === '/api/session')
      return json({ user: null }, 200, {
        'Set-Cookie': `asktara_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      });
    if (path === '/api/catalog') return json({ destinations: [{ id: 'lisbon' }] });
    if (path === '/api/integrations')
      return json({
        ai: configured,
        hotels: configured,
        flights: configured,
        activities: false,
        mode: configured ? 'live' : 'local',
      });
    if (path === '/api/config') return json({ mapsEmbedApiKey: hiddenKey });
    if (path === '/api/flights/search' || path === '/api/hotels/search') {
      assert.ok(owned);
      assert.equal(body.adults, 2);
      if (path.includes('/flights/')) {
        assert.equal(body.cabinClass, 'economy');
        assert.equal(body.departureDate, '2026-10-27');
        assert.equal(body.returnDate, '2026-10-30');
        if (flightFailure) return json({ error: hiddenKey }, 502);
      } else {
        assert.equal(body.guestNationality, 'PK');
        assert.equal(body.checkin, '2026-10-27');
        assert.equal(body.checkout, '2026-10-30');
      }
      return configured
        ? json({
            offers: [
              {
                id: 'offer',
                price: 100,
                currency: 'USD',
                requestedJourneyCount: 2,
                passengerCount: 2,
                priceScope: 'all_passengers_complete_journey',
                journeys: [
                  {
                    origin: { code: 'LHR' },
                    destination: { code: 'JFK' },
                    segments: [{ id: 'outbound' }],
                  },
                  {
                    origin: { code: 'JFK' },
                    destination: { code: 'LHR' },
                    segments: [{ id: 'inbound' }],
                  },
                ],
              },
            ],
            mode: 'test',
          })
        : json(
            {
              code: path.includes('/flights/') ? 'FLIGHTS_NOT_CONFIGURED' : 'HOTELS_NOT_CONFIGURED',
            },
            503,
          );
    }
    if (path === '/api/planning/runs' && method === 'POST') {
      assert.ok(owned, 'Planning must reuse the guest session');
      assert.equal(body.brief.includeHotels, false);
      assert.equal(body.brief.includeFlights, false);
      assert.match(body.requestId, /^[a-f0-9-]{36}$/);
      if (!run) {
        const date = body.message.match(/\d{4}-\d{2}-\d{2}/)[0];
        trip = {
          id: 'smoke-trip',
          revision: 1,
          title: 'Lisbon',
          destinationId: 'lisbon',
          destinations: [{ id: 'lisbon', name: 'Lisbon', country: 'Portugal' }],
          days: 3,
          startDate: date,
          travelers: 2,
          itinerary: Array.from({ length: 3 }, (_, i) => ({
            day: i + 1,
            items: [{ id: `stop-${i}`, title: 'Breakfast', time: '09:00', cost: 20 }],
          })),
          messages: [
            { role: 'user', content: body.message },
            { role: 'assistant', content: 'A plan' },
          ],
          planning: {
            model: 'gpt-6-astra',
            agentIds: ['intake', 'destinations', 'places', 'verification', 'itinerary', 'review'],
            sources: configured
              ? [{ kind: 'web', status: 'live', url: 'https://www.visitlisboa.com/' }]
              : [],
            issues: aiFallback ? [{ code: 'composition_fallback' }] : [],
          },
        };
        run = { id: 'smoke-run', tripId: trip.id, requestId: body.requestId, status: 'queued' };
      }
      assert.equal(body.requestId, run.requestId);
      return json({ run }, 202);
    }
    if (path === '/api/planning/runs/smoke-run') {
      assert.ok(owned);
      run = { ...run, status: 'completed', result: { trip, mode: configured ? 'live' : 'local' } };
      return json({ run });
    }
    if (path.startsWith('/api/trips/smoke-trip')) {
      if (!owned || deleted) return json({ error: 'Trip not found' }, 404);
      if (path.endsWith('/runs')) return json({ runs: [run] });
      if (path.endsWith('/revisions')) return json({ revisions: [{ version: trip.revision }] });
      if (path.endsWith('/calendar.ics'))
        return new Response(
          'BEGIN:VCALENDAR\r\nSUMMARY:Deployment smoke breakfast\r\nEND:VCALENDAR',
          { headers: { 'Content-Type': 'text/calendar' } },
        );
      if (method === 'PATCH') {
        if (body.revision !== trip.revision) return json({ error: 'Revision conflict' }, 409);
        trip = { ...trip, ...body, revision: trip.revision + 1 };
        trip.itinerary[0].items[0].locked = true;
      }
      if (method === 'DELETE') {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      return json({ trip });
    }
    throw new Error(`Unexpected test endpoint ${method} ${path}`);
  }
  return { fetchImpl, requests, deleted: () => deleted };
}
async function execute(options, smokeOptions = {}) {
  const mock = fixture(options),
    output = [];
  const result = await runSmoke({
    baseUrl: origin,
    fetchImpl: mock.fetchImpl,
    providers: true,
    now: new Date('2026-09-12T12:00:00Z'),
    pollInterval: 0,
    log: (line) => output.push(line),
    ...smokeOptions,
  });
  assert.ok(!output.join('\n').includes(session));
  assert.ok(!output.join('\n').includes(hiddenKey));
  return { ...mock, result, output };
}

test('smoke follows real route contracts, maintains ownership, verifies assets, and cleans up', async () => {
  const { result, requests, deleted } = await execute({});
  assert.equal(result.ok, true);
  assert.ok(deleted());
  assert.equal(requests.filter((request) => request.path === '/api/planning/runs').length, 2);
  assert.ok(requests.some((request) => request.path === '/api/trips/smoke-trip/calendar.ics'));
  assert.equal(result.checks.find((check) => check.name === 'flights search').status, 'pass');
});

test('configured provider probes distinguish test results and actual AI success', async () => {
  const { result, output } = await execute({ configured: true });
  assert.equal(result.ok, true);
  assert.equal(
    result.checks.find(
      (check) =>
        check.name === 'Configured AI completed intake, web research, venue checks and composition',
    ).status,
    'pass',
  );
  assert.equal(output.filter((line) => line.includes('TEST data')).length, 2);
});

test('AI fallback and configured supplier failure fail smoke without hiding later checks or cleanup', async () => {
  const { result, deleted } = await execute({
    configured: true,
    aiFallback: true,
    flightFailure: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.filter((check) => check.status === 'fail').length, 2);
  assert.equal(result.checks.find((check) => check.name === 'hotels search').status, 'pass');
  assert.equal(
    result.checks.find(
      (check) => check.name === 'Edit, protected stop, revisions, calendar and guest isolation',
    ).status,
    'pass',
  );
  assert.ok(deleted());
});

test('an HTML fallback at the health URL cannot masquerade as healthy API', async () => {
  const { result, deleted } = await execute({ htmlHealth: true });
  assert.equal(result.ok, false);
  assert.equal(
    result.checks.find((check) => check.name === 'API health and database').status,
    'fail',
  );
  assert.ok(deleted());
});

test('restart fixture preserves only its synthetic trip and writes its session privately', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asktara-smoke-test-'));
  const statePath = join(directory, 'state.json');
  try {
    const { result, deleted } = await execute({}, { statePath, keepTrip: true });
    assert.equal(result.ok, true);
    assert.equal(deleted(), false);
    assert.equal((await stat(statePath)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), {
      baseUrl: origin,
      cookie: `asktara_session=${session}`,
      tripId: 'smoke-trip',
      title: 'Deployment smoke itinerary',
      revision: 2,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a pre-existing restart fixture is never overwritten and the unrecoverable new trip is removed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'asktara-smoke-test-'));
  const statePath = join(directory, 'state.json');
  try {
    await writeFile(statePath, 'existing-session', { mode: 0o600 });
    const { result, deleted } = await execute({}, { statePath, keepTrip: true });
    assert.equal(result.ok, false);
    assert.equal(deleted(), true);
    assert.equal(await readFile(statePath, 'utf8'), 'existing-session');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
