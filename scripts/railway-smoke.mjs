#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const futureDate = (now, days) =>
  new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);

/** An isolated synthetic guest; cookies never go to logs. */
function client(base, fetchImpl) {
  const cookies = new Map();
  let sessionFlags = '';
  let sessionCookieName;
  async function request(
    path,
    { method = 'GET', body, expected = 200, json = true, timeout = 30000 } = {},
  ) {
    const url = new URL(path, base);
    assert(url.origin === base.origin, 'Refusing to send the smoke session to another origin');
    const response = await fetchImpl(url, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
      headers: {
        ...(cookies.size
          ? { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') }
          : {}),
        ...(method !== 'GET' ? { Origin: base.origin } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const separator = pair.indexOf('=');
      if (separator < 1) continue;
      const name = pair.slice(0, separator);
      cookies.set(name, pair.slice(separator + 1));
      if (/;\s*HttpOnly(?:;|$)/i.test(cookie)) {
        sessionCookieName = name;
        sessionFlags = cookie.slice(pair.length);
      }
    }
    const raw = await response.text();
    assert(
      response.status === expected,
      `Expected HTTP ${expected}; received HTTP ${response.status}`,
    );
    if (!json) return { text: raw, contentType: response.headers.get('content-type') || '' };
    assert(
      (response.headers.get('content-type') || '').includes('application/json'),
      'Expected a JSON API response, received another content type',
    );
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('API returned invalid JSON');
    }
  }
  return {
    request,
    hasSession: () => Boolean(sessionCookieName && cookies.has(sessionCookieName)),
    sessionFlags: () => sessionFlags,
    cookieHeader: () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
  };
}

/** Real application checks; delete only the trip created by this invocation. */
export async function runSmoke({
  baseUrl = 'http://localhost:3001',
  providers = false,
  fetchImpl = fetch,
  log = console.log,
  now = new Date(),
  pollInterval = 2000,
  planningTimeout = 360000,
  statePath,
  keepTrip = false,
} = {}) {
  assert(!keepTrip || statePath, 'Keeping a smoke trip requires ASKTARA_SMOKE_STATE_PATH');
  const base = new URL(baseUrl);
  assert(
    ['http:', 'https:'].includes(base.protocol) &&
      !base.username &&
      !base.password &&
      !base.search &&
      !base.hash &&
      (base.pathname === '/' || base.pathname === ''),
    'Provide an HTTP(S) application origin without credentials, a path, or query parameters',
  );
  const http = client(base, fetchImpl);
  const checks = [];
  let tripId, runId, integrationState, plannedTrip, planningResult;
  const check = async (name, action) => {
    try {
      const detail = await action();
      checks.push({ name, status: 'pass', detail });
      log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
      return true;
    } catch (error) {
      // Do not include raw provider errors, bodies, keys or session cookies.
      const detail =
        error instanceof Error && !['TypeError', 'TimeoutError', 'AbortError'].includes(error.name)
          ? error.message
          : 'Request failed or timed out';
      checks.push({ name, status: 'fail', detail });
      log(`FAIL ${name} — ${detail}`);
      return false;
    }
  };
  const skip = (name, detail) => {
    checks.push({ name, status: 'skip', detail });
    log(`SKIP ${name} — ${detail}`);
  };
  const checkin = futureDate(now, 45),
    checkout = futureDate(now, 48);

  await check('API health and database', async () => {
    const body = await http.request('/api/health');
    assert(
      body.status === 'ok' && body.service === 'asktara' && body.database === 'connected',
      'Unexpected application health response',
    );
  });
  await check('Built frontend, assets and SPA route', async () => {
    const page = await http.request('/', { json: false });
    assert(
      page.contentType.includes('text/html') &&
        /<title>Asktara/i.test(page.text) &&
        /id=["']root["']/.test(page.text),
      'Production frontend HTML is missing',
    );
    const script = page.text.match(/<script\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
    assert(
      script && new URL(script, base).pathname.startsWith('/assets/'),
      'Production JavaScript bundle is missing; run the frontend build',
    );
    const asset = await http.request(script, { json: false });
    assert(
      /javascript/.test(asset.contentType) && asset.text.length > 100,
      'JavaScript asset was not served correctly',
    );
    const stylesheet = [
      ...page.text.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css(?:\?[^"']*)?)["']/gi),
    ][0]?.[1];
    assert(stylesheet, 'Production stylesheet is missing');
    const css = await http.request(stylesheet, { json: false });
    assert(
      css.contentType.includes('text/css') && css.text.length > 100,
      'Stylesheet asset was not served correctly',
    );
    const route = await http.request('/chat/deployment-smoke', { json: false });
    assert(
      route.contentType.includes('text/html') && route.text.includes(script),
      'SPA deep links do not return the built frontend',
    );
    return 'HTTP/assets checked; browser rendering is separate';
  });
  const sessionReady = await check('Anonymous session and catalog', async () => {
    const session = await http.request('/api/session');
    assert(session.user === null && http.hasSession(), 'The new guest session was not established');
    assert(
      /HttpOnly/i.test(http.sessionFlags()) && /SameSite=Lax/i.test(http.sessionFlags()),
      'Guest cookie is missing expected HttpOnly/SameSite protections',
    );
    if (base.protocol === 'https:')
      assert(
        /(?:^|;)\s*Secure(?:;|$)/i.test(http.sessionFlags()),
        'HTTPS deployment did not issue a Secure session cookie',
      );
    const catalog = await http.request('/api/catalog');
    assert(
      catalog.destinations?.some((destination) => destination.id === 'lisbon'),
      'Expected destination catalog was not returned',
    );
  });
  await check('Integration status and public config', async () => {
    integrationState = await http.request('/api/integrations');
    assert(
      ['ai', 'flights', 'hotels', 'activities'].every(
        (key) => typeof integrationState[key] === 'boolean',
      ),
      'Integration status schema is invalid',
    );
    const config = await http.request('/api/config');
    assert(
      Object.keys(config).every((key) => key === 'mapsEmbedApiKey'),
      'Public configuration exposes an unexpected field',
    );
    return `AI ${integrationState.ai ? 'configured' : 'off'}, flights ${integrationState.flights ? 'configured' : 'off'}, hotels ${integrationState.hotels ? 'configured' : 'off'}, embedded map ${config.mapsEmbedApiKey ? 'configured' : 'off'}; flags do not verify credentials`;
  });

  try {
    if (sessionReady) {
      const planned = await check(
        'Planning run, duplicate-request protection and itinerary',
        async () => {
          const input = {
            requestId: randomUUID(),
            message: `Create a 3 day Lisbon itinerary starting ${checkin} for 2 travelers with a total budget of $1300. Include food and culture. Do not search hotels or flights.`,
            brief: { includeHotels: false, includeFlights: false },
          };
          const started = await http.request('/api/planning/runs', {
            method: 'POST',
            body: input,
            expected: 202,
          });
          tripId = started.run?.tripId;
          runId = started.run?.id;
          assert(
            typeof tripId === 'string' && typeof runId === 'string',
            'Planning did not return a run and trip ID',
          );
          const replay = await http.request('/api/planning/runs', {
            method: 'POST',
            body: input,
            expected: 202,
          });
          assert(
            replay.run.id === runId && replay.run.tripId === tripId,
            'Retry created a different planning run',
          );
          const deadline = Date.now() + planningTimeout;
          let run = started.run,
            nextProgress = Date.now() + 20000;
          while (['queued', 'running'].includes(run.status)) {
            assert(Date.now() < deadline, 'Planning exceeded the smoke timeout');
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
            run = (await http.request(`/api/planning/runs/${runId}`)).run;
            if (Date.now() >= nextProgress) {
              log('WAIT planning is still running');
              nextProgress = Date.now() + 20000;
            }
          }
          assert(
            run.status === 'completed' && run.result,
            `Planning ended with status ${['failed', 'cancelled'].includes(run.status) ? run.status : 'unexpected'}`,
          );
          planningResult = run.result;
          plannedTrip = (await http.request(`/api/trips/${tripId}`)).trip;
          assert(
            plannedTrip.id === tripId &&
              plannedTrip.destinationId === 'lisbon' &&
              plannedTrip.days === 3 &&
              plannedTrip.startDate === checkin &&
              plannedTrip.travelers === 2,
            'Saved trip does not match the requested brief',
          );
          assert(
            plannedTrip.itinerary?.length === 3 &&
              plannedTrip.itinerary.every(
                (day, index) => day.day === index + 1 && day.items.length > 0,
              ),
            'Saved itinerary is incomplete',
          );
          assert(
            plannedTrip.messages.filter((message) => message.role === 'user').length === 1 &&
              plannedTrip.messages.filter((message) => message.role === 'assistant').length === 1,
            'Conversation persistence or request deduplication failed',
          );
          const runs = (await http.request(`/api/trips/${tripId}/runs`)).runs;
          assert(runs.length === 1 && runs[0].id === runId, 'Run history is inconsistent');
          return `${planningResult.mode === 'live' ? 'AI-assisted' : 'curated'} plan persisted`;
        },
      );
      if (planned) {
        if (integrationState?.ai)
          await check(
            'Configured AI completed intake, web research, venue checks and composition',
            async () => {
              const fallbacks = (plannedTrip.planning?.issues || [])
                .filter((issue) => ['intake_fallback', 'composition_fallback'].includes(issue.code))
                .map((issue) => issue.code);
              assert(
                planningResult.mode === 'live' && fallbacks.length === 0,
                `Configured AI fell back (${fallbacks.join(', ') || 'result mode is not live'}); verify OpenAI credentials, model access and quota`,
              );
              assert(
                plannedTrip.planning?.model === 'gpt-6-astra',
                'The deployed concierge is not using GPT-6 Astra',
              );
              assert(
                plannedTrip.planning.sources.some(
                  (source) =>
                    source.kind === 'web' &&
                    source.status === 'live' &&
                    source.url?.startsWith('https://'),
                ),
                'The AI plan has no live web research sources',
              );
              assert(
                plannedTrip.planning?.agentIds?.includes('verification'),
                'The plan did not complete current venue checks',
              );
              assert(
                plannedTrip.destinations?.some(
                  (destination) => destination.id === plannedTrip.destinationId,
                ),
                'The researched destination identity was not persisted',
              );
            },
          );
        else skip('Live AI', 'OPENAI_API_KEY is not configured; curated planning was exercised');
        const placeId = plannedTrip.itinerary
          .flatMap((day) => day.items)
          .find((item) => item.placeId?.startsWith('google-'))?.placeId;
        if (placeId)
          await check('Fresh Google place details', async () => {
            const { place } = await http.request(
              `/api/trips/${tripId}/places/${encodeURIComponent(placeId)}`,
            );
            assert(
              place?.id === placeId &&
                typeof place.name === 'string' &&
                typeof place.address === 'string',
              'Fresh place detail response is invalid',
            );
          });
        else if (plannedTrip.planning?.issues.some((issue) => issue.code === 'places_fallback'))
          await check('Google Places research', async () => {
            throw new Error(
              'Configured place research fell back; verify Places credentials and enabled API',
            );
          });
        else skip('Fresh Google place details', 'This plan returned no Google place references');
        await check('Edit, protected stop, revisions, calendar and guest isolation', async () => {
          const itinerary = structuredClone(plannedTrip.itinerary);
          const stop = itinerary[0].items[0];
          stop.title = 'Deployment smoke breakfast';
          stop.cost = 13;
          const { trip: edited } = await http.request(`/api/trips/${tripId}`, {
            method: 'PATCH',
            body: {
              revision: plannedTrip.revision,
              title: 'Deployment smoke itinerary',
              itinerary,
            },
          });
          assert(
            edited.revision === plannedTrip.revision + 1,
            'Saving did not increment the trip revision',
          );
          const { trip: persisted } = await http.request(`/api/trips/${tripId}`);
          const savedStop = persisted.itinerary[0].items.find((item) => item.id === stop.id);
          assert(
            persisted.title === 'Deployment smoke itinerary' &&
              savedStop?.title === stop.title &&
              savedStop.locked === true &&
              savedStop.cost === 13,
            'Edited protected stop did not persist',
          );
          const revisions = (await http.request(`/api/trips/${tripId}/revisions`)).revisions;
          assert(
            revisions.some((revision) => revision.version === persisted.revision),
            'Saved revision is missing from history',
          );
          const calendar = await http.request(`/api/trips/${tripId}/calendar.ics`, { json: false });
          assert(
            calendar.contentType.includes('text/calendar') &&
              calendar.text.includes('BEGIN:VCALENDAR') &&
              calendar.text.includes('SUMMARY:Deployment smoke breakfast'),
            'Calendar export is missing the saved stop',
          );
          await client(base, fetchImpl).request(`/api/trips/${tripId}`, { expected: 404 });
          await http.request(`/api/trips/${tripId}`, {
            method: 'PATCH',
            body: { revision: plannedTrip.revision, title: 'Stale change' },
            expected: 409,
          });
        });
      }
    } else skip('Planning and persistence', 'A guest session could not be established');

    for (const kind of ['flights', 'hotels']) {
      if (!integrationState) {
        skip(`${kind} search`, 'Integration status unavailable');
        continue;
      }
      if (integrationState[kind] && !providers) {
        skip(`${kind} search`, 'Configured; pass --providers to exercise supplier search');
        continue;
      }
      await check(`${kind} search`, async () => {
        const body =
          kind === 'flights'
            ? {
                origin: 'LHR',
                destination: 'JFK',
                departureDate: checkin,
                returnDate: checkout,
                adults: 2,
                cabinClass: 'economy',
              }
            : { destinationId: 'lisbon', checkin, checkout, adults: 2, guestNationality: 'PK' };
        const configured = integrationState[kind];
        const result = await http.request(`/api/${kind}/search`, {
          method: 'POST',
          body,
          expected: configured ? 200 : 503,
          timeout: 60000,
        });
        if (!configured) {
          assert(
            result.code ===
              (kind === 'flights' ? 'FLIGHTS_NOT_CONFIGURED' : 'HOTELS_NOT_CONFIGURED'),
            'Disconnected supplier did not return the expected explicit error',
          );
          return 'not configured; honest unavailable response verified';
        }
        assert(
          Array.isArray(result.offers) && ['test', 'live', 'provider'].includes(result.mode),
          'Provider search response schema is invalid',
        );
        assert(
          result.offers.every(
            (offer) =>
              Number.isFinite(offer.price) && offer.price >= 0 && /^[A-Z]{3}$/.test(offer.currency),
          ),
          'Search contains malformed prices or currencies',
        );
        if (kind === 'flights')
          assert(
            result.offers.every(
              (offer) =>
                offer.requestedJourneyCount === 2 &&
                offer.passengerCount === 2 &&
                offer.priceScope === 'all_passengers_complete_journey' &&
                offer.journeys?.length === 2 &&
                offer.journeys[0].origin.code === 'LHR' &&
                offer.journeys[0].destination.code === 'JFK' &&
                offer.journeys[1].origin.code === 'JFK' &&
                offer.journeys[1].destination.code === 'LHR' &&
                offer.journeys.every((journey) => journey.segments.length > 0),
            ),
            'Round-trip offers are missing a direction, segment details, or complete-party price scope',
          );
        return `${result.offers.length} offers; ${result.mode === 'test' ? 'TEST data' : result.mode === 'live' ? 'live provider response' : 'provider environment unverified'}; no booking attempted`;
      });
    }
  } finally {
    let stateSaved = false;
    if (tripId && statePath)
      stateSaved = await check('Save private restart fixture', async () => {
        const { trip } = await http.request(`/api/trips/${tripId}`);
        // Exclusive creation prevents overwriting another session or following a symlink.
        await writeFile(
          statePath,
          JSON.stringify(
            {
              baseUrl: base.origin,
              cookie: http.cookieHeader(),
              tripId,
              title: trip.title,
              revision: trip.revision,
            },
            null,
            2,
          ) + '\n',
          { flag: 'wx', mode: 0o600 },
        );
        return '0600 file created; session cookie is not logged';
      });
    if (tripId && keepTrip && stateSaved)
      skip(
        'Remove synthetic smoke trip',
        'Retained for restart verification; delete it with the private fixture session afterward',
      );
    else if (tripId)
      await check('Remove synthetic smoke trip', async () => {
        // DELETE also cancels any in-flight run owned by this synthetic guest.
        await http.request(`/api/trips/${tripId}`, {
          method: 'DELETE',
          expected: 204,
          json: false,
        });
        await http.request(`/api/trips/${tripId}`, { expected: 404 });
      });
  }
  const failed = checks.filter((check) => check.status === 'fail').length;
  log(
    `Smoke complete: ${checks.filter((check) => check.status === 'pass').length} passed, ${failed} failed, ${checks.filter((check) => check.status === 'skip').length} skipped. No bookings or payments attempted.`,
  );
  return { ok: failed === 0, checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg.startsWith('--') && arg !== '--providers')) {
    console.error(
      'Usage: node scripts/railway-smoke.mjs [https://application-origin] [--providers]',
    );
    process.exitCode = 1;
  } else {
    runSmoke({
      baseUrl: args.find((arg) => !arg.startsWith('--')) || 'http://localhost:3001',
      providers: args.includes('--providers'),
      statePath: process.env.ASKTARA_SMOKE_STATE_PATH || undefined,
      keepTrip: process.env.ASKTARA_SMOKE_KEEP_TRIP === '1',
    })
      .then((result) => {
        process.exitCode = result.ok ? 0 : 1;
      })
      .catch(() => {
        console.error(
          'Smoke could not start. Provide a valid origin; ASKTARA_SMOKE_KEEP_TRIP=1 also requires ASKTARA_SMOKE_STATE_PATH.',
        );
        process.exitCode = 1;
      });
  }
}
