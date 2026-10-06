#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

// Opt-in actual model + desktop check. Fictional guest records only; no booking or publication.
assert.equal(process.env.STUDIO_JOURNEY_SMOKE, '1', 'Set STUDIO_JOURNEY_SMOKE=1 to opt in.');
const base = new URL(process.argv[2] || 'http://localhost:3018');
assert(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password);
const output = process.env.STUDIO_SMOKE_OUTPUT || `/private/tmp/asktara-journey-${randomUUID()}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
const page = await context.newPage();
let workspace, profile;
const report = {
  target: base.origin,
  checks: [],
  model: '',
  transport: {},
  briefing: {},
  supplier: {},
  cleanup: {},
  prohibitedRequests: [],
  pageErrors: [],
  journeyResponses: [],
};
const check = (condition, label) => {
  assert(condition, label);
  report.checks.push(label);
  console.log(`PASS ${label}`);
};
page.on('pageerror', (error) => report.pageErrors.push(error.message));
page.on('response', (response) => {
  const path = new URL(response.url()).pathname;
  if (/\/journey\/(?:research|select)$/.test(path))
    report.journeyResponses.push({ action: path.split('/').at(-1), status: response.status() });
});
page.on('request', (request) => {
  const path = new URL(request.url()).pathname;
  if (
    request.method() !== 'GET' &&
    /\/(?:bookings?|orders?|payments?|prebook)(?:\/|$)|\/proposal$/.test(path)
  )
    report.prohibitedRequests.push(path);
});
async function api(path, method = 'GET', body) {
  const response = await context.request.fetch(new URL(path, base).href, {
    method,
    headers: { Origin: base.origin },
    ...(body ? { data: body } : {}),
    timeout: 200000,
  });
  if (response.status() === 204) return;
  const result = await response.json();
  assert(
    response.ok(),
    `${method} ${path} HTTP ${response.status()}: ${result.error || result.code || 'request failed'}`,
  );
  if (result.workspace) workspace = result.workspace;
  return result;
}
const own = (suffix = '') => `/api/studio/workspaces/${workspace.id}${suffix}`;
async function mutateFromUI(suffix, action) {
  const waiting = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === own(suffix) && response.request().method() === 'POST',
    { timeout: 200000 },
  );
  const completed = Promise.race([
    waiting,
    page
      .getByRole('region', { name: 'Journey planner' })
      .getByRole('alert')
      .waitFor({ state: 'visible', timeout: 200000 })
      .then(async () => {
        throw new Error(
          await page
            .getByRole('region', { name: 'Journey planner' })
            .getByRole('alert')
            .innerText(),
        );
      }),
  ]);
  const [, response] = await Promise.all([action(), completed]);
  const result = await response.json();
  assert(
    response.ok(),
    `${suffix} HTTP ${response.status()}: ${result.error || result.code || 'request failed'}`,
  );
  if (result.workspace) workspace = result.workspace;
  return result;
}
async function latest() {
  await api(own());
}
try {
  const integrations = await api('/api/integrations');
  check(integrations.ai, 'Actual model integration configured');
  ({ client: profile } = await api('/api/studio/client-profiles', 'POST', {
    name: 'Fictional Journey Traveller',
    country: 'AU',
    nationality: 'AU',
    passportNationality: 'AU',
    dateOfBirth: '',
    photoDataUrl: '',
    context: 'Fictional journey regression only.',
    interests: [],
    foodPreferences: [],
    history: [],
  }));
  await api('/api/studio/workspaces', 'POST', {
    clientId: profile.id,
    brief: { origin: 'Sydney' },
  });
  const result = await api(own('/review'), 'POST', {
    revision: workspace.revision,
    requestId: randomUUID(),
    message:
      'I want to go to London for a business trip for 4 days. I depart from Sydney on 18 November 2026. Start by comparing travel routes, no bookings.',
  });
  report.model = result.model || '';
  check(
    workspace.stops[0]?.name === 'London' && workspace.brief.tripDays === 4,
    'Actual conversation retains London business trip and four days',
  );
  check(
    workspace.brief.departureDate === '2026-11-18' &&
      !workspace.brief.startDate &&
      workspace.stops[0].nights === null,
    'Departure is retained without an invented arrival or hotel nights',
  );
  check(
    !/(?:when|what date)[^?]{0,60}arriv[^?]*\?/i.test(result.reply),
    'Tara offers transport instead of asking for calculated arrival',
  );
  await page.goto(new URL(`/studio/${workspace.id}`, base).href);
  const planner = page.getByRole('region', { name: 'Journey planner' });
  await expect(planner).toBeVisible();
  await expect(planner.getByLabel('From', { exact: true })).toHaveValue('Sydney');
  await expect(planner.getByLabel('To', { exact: true })).toHaveValue('London');
  await expect(planner.getByLabel('Departure date', { exact: true })).toHaveValue('2026-11-18');
  check(true, 'Desktop journey card prefills known facts without arrival fields');
  await expect
    .poll(
      async () => {
        await latest();
        return Boolean(workspace.tripBriefing);
      },
      { timeout: 180000, intervals: [1000, 2000, 3000] },
    )
    .toBe(true);
  const early = workspace.tripBriefing.stops[0];
  report.briefing = {
    scope: early.scope,
    entryStatus: early.preliminaryEntryRequirements?.status || 'unavailable',
    weather: early.weather.kind,
    entrySources: early.preliminaryEntryRequirements?.sources.length || 0,
    weatherSources: early.weather.sources.length,
  };
  check(
    early.scope === 'preliminary' && early.entryRequirements === null,
    'Known passport and London start automatic preliminary checks without dates',
  );
  check(
    early.preliminaryEntryRequirements || early.entryError,
    'Entry research has conditional guidance or an explicit failure',
  );
  check(
    ['climate_overview', 'unavailable'].includes(early.weather.kind),
    'Undated weather is climate guidance or explicit unavailability, never a forecast',
  );
  const outward = await mutateFromUI('/journey/research', () =>
    planner.getByRole('button', { name: 'Flight', exact: true }).click(),
  );
  check(
    outward.research.input.direction === 'outbound' &&
      outward.research.input.origin === 'Sydney' &&
      outward.research.input.destination === 'London',
    'One Flight tap researches actual outward official sources before approval',
  );
  check(outward.research.options.length > 0, 'Actual official flight route choices are available');
  check(
    outward.research.options.every(
      (option) => option.sources.length > 0 && option.price === null && option.arrivalDate === '',
    ),
    'Published route cards have sources without fabricated fares or arrivals',
  );
  report.transport.outbound = outward.research.options.map((option) => ({
    title: option.title,
    operator: option.operator,
    sourceCount: option.sources.length,
    airportCodes: [option.originAirportCode, option.destinationAirportCode],
  }));
  await mutateFromUI('/journey/select', () =>
    planner.getByRole('button', { name: 'Use this route', exact: true }).first().click(),
  );
  check(
    Boolean(workspace.journeySelections.outbound) &&
      !workspace.brief.startDate &&
      workspace.items.length === 0,
    'Choosing published guidance saves preference without dates or a booking',
  );
  await planner.getByRole('button', { name: 'Return journey', exact: true }).click();
  await planner.getByLabel('Return departure date', { exact: true }).fill('2026-11-23');
  const inbound = await mutateFromUI('/journey/research', () =>
    planner.getByRole('button', { name: 'Flight', exact: true }).click(),
  );
  check(
    inbound.research.input.origin === 'London' &&
      inbound.research.input.destination === 'Sydney' &&
      inbound.research.input.departureDate === '2026-11-23',
    'Return search reverses the cities and uses explicit return departure',
  );
  check(
    inbound.research.options.length > 0 &&
      inbound.research.options.every(
        (option) => option.arrivalDate === '' && option.price === null,
      ),
    'Actual return guidance remains distinct from dated inventory',
  );
  report.transport.return = inbound.research.options.map((option) => ({
    title: option.title,
    sourceCount: option.sources.length,
  }));
  await page.screenshot({ path: `${output}/desktop-journey.png`, fullPage: true });
  await latest();
  await api(own(), 'PATCH', {
    revision: workspace.revision,
    brief: {
      adults: 1,
      children: 0,
      childAges: [],
      cabin: 'economy',
      outboundTransport: 'flight',
      returnTransport: 'flight',
    },
  });
  const before = structuredClone(workspace);
  const response = await context.request.post(new URL(own('/journey/flights/search'), base).href, {
    headers: { Origin: base.origin },
    data: {
      revision: workspace.revision,
      stopId: workspace.stops[0].id,
      direction: 'outbound',
      origin: 'SYD',
      destination: 'LHR',
      departureDate: '2026-11-18',
      returnDate: '2026-11-23',
      adults: 1,
      cabinClass: 'economy',
    },
    timeout: 90000,
  });
  const fareResult = await response.json();
  report.supplier = {
    status: response.status(),
    code: fareResult.code || '',
    mode: fareResult.mode || '',
    quoteCount: fareResult.quotes?.length || 0,
  };
  check(
    response.ok() ||
      (response.status() === 503 && fareResult.code === 'FLIGHTS_PROVIDER_UNAVAILABLE'),
    'Actual supplier returns real quotes or a clear provider-unavailable result',
  );
  await latest();
  check(
    workspace.revision === before.revision &&
      JSON.stringify(workspace.stops) === JSON.stringify(before.stops) &&
      workspace.items.length === before.items.length,
    'Fare search never modifies dates or records a booking',
  );
  await page.reload();
  await expect(page.getByRole('region', { name: 'Journey planner' })).toBeVisible();
  await expect(page.getByTestId('studio-trip-board')).toBeVisible();
  check(
    workspace.brief.returnDepartureDate === '2026-11-23' &&
      workspace.brief.tripDays === 4 &&
      !workspace.brief.startDate,
    'Reload preserves explicit return and duration with unresolved arrival',
  );
  check(
    report.prohibitedRequests.length === 0 && report.pageErrors.length === 0,
    'No booking, payment, publication or browser exceptions',
  );
} catch (error) {
  report.error = String(error.message)
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .slice(0, 1500);
  console.error(report.error);
  await page.screenshot({ path: `${output}/desktop-failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (workspace) {
    try {
      await latest();
      await api(own(), 'DELETE', { revision: workspace.revision });
      report.cleanup.workspace = true;
    } catch {
      report.cleanup.workspace = false;
      process.exitCode = 1;
    }
  }
  if (profile) {
    try {
      await api(`/api/studio/client-profiles/${profile.id}`, 'DELETE');
      report.cleanup.profile = true;
    } catch {
      report.cleanup.profile = false;
      process.exitCode = 1;
    }
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
  console.log(`Report: ${output}/report.json`);
}
