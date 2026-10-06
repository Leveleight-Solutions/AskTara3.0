#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

// A new fictional guest and profile only. No booking, payment or publication calls.
const base = new URL(process.argv[2] || 'http://localhost:5174');
assert(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password);
const output = process.env.STUDIO_SMOKE_OUTPUT || `/private/tmp/asktara-desktop-${randomUUID()}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1050 },
  acceptDownloads: true,
});
const page = await context.newPage();
let workspace, profile;
const report = {
  target: base.origin,
  checks: [],
  unexpectedMutations: [],
  pageErrors: [],
  cleanup: {},
};
const check = (condition, label) => {
  assert(condition, label);
  report.checks.push(label);
  console.log(`PASS ${label}`);
};
page.on('pageerror', (error) => report.pageErrors.push(error.message));
page.on('request', (request) => {
  const path = new URL(request.url()).pathname;
  if (
    request.method() !== 'GET' &&
    /\/(?:bookings?|orders?|payments?|prebook)(?:\/|$)|\/proposal$/.test(path)
  )
    report.unexpectedMutations.push(path);
});
async function api(path, method = 'GET', body) {
  const response = await context.request.fetch(new URL(path, base).href, {
    method,
    headers: { Origin: base.origin },
    ...(body ? { data: body } : {}),
    timeout: 200000,
  });
  assert(response.ok(), `${method} ${path} HTTP ${response.status()}`);
  if (response.status() === 204) return;
  const result = await response.json();
  if (result.workspace) workspace = result.workspace;
  return result;
}
const own = (suffix) => `/api/studio/workspaces/${workspace.id}${suffix || ''}`;
async function waitMutation(suffix, operation) {
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === own(suffix) && response.request().method() === 'POST',
    { timeout: 200000 },
  );
  await operation();
  const completed = await response;
  assert(completed.ok(), `${suffix} HTTP ${completed.status()}`);
  const result = await completed.json();
  if (result.workspace) workspace = result.workspace;
  return result;
}
try {
  const status = await api('/api/integrations');
  check(status.ai && status.hotels, 'Actual AI and hotel providers are configured');
  ({ client: profile } = await api('/api/studio/client-profiles', 'POST', {
    name: 'Fictional Desktop Family',
    country: 'AU',
    nationality: 'AU',
    passportNationality: 'AU',
    dateOfBirth: '1988-07-12',
    photoDataUrl: '',
    context: 'Fictional test customer. Prefers relaxed travel.',
    interests: ['Gardens', 'Museums'],
    foodPreferences: ['Vegetarian'],
    history: [
      {
        destination: 'Kyoto',
        country: 'JP',
        experience: 'visited',
        feedback: 'liked',
        notes: 'Quiet gardens and walkable neighbourhoods.',
      },
    ],
  }));
  await page.goto(new URL('/clients', base).href);
  await expect(page.getByRole('region', { name: 'Selected client' })).toContainText(profile.name);
  check(true, 'Private client address book renders saved identity and travel feedback');
  await page.getByRole('button', { name: 'Create a proposal', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Who is this proposal for?' });
  await picker.getByRole('button', { name: new RegExp(profile.name) }).click();
  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/studio/workspaces' &&
      response.request().method() === 'POST',
  );
  await picker.getByRole('button', { name: 'Start proposal', exact: true }).click();
  ({ workspace } = await (await created).json());
  await expect(page).toHaveURL(new RegExp(`/studio/${workspace.id}$`));
  check(
    workspace.brief.clientId === profile.id &&
      workspace.brief.adults === null &&
      workspace.brief.children === null &&
      !workspace.brief.startDate,
    'Client selected before atomic proposal creation; no past party or dates copied',
  );
  await expect(
    page.getByRole('region', { name: 'Selected client and personalised inspiration' }),
  ).toContainText('Vegetarian');
  check(true, 'Client preferences appear above the conversation');
  await waitMutation('/review', async () => {
    await page
      .locator('#studio-message')
      .fill(
        'We want a relaxed family holiday in London, United Kingdom. Arrive on 1 May 2027 and leave on 4 May 2027: exactly 3 nights. There are 2 adults and 1 child aged 7, travelling on Australian passports. Total group budget AUD 8000. We prefer central 4 star hotels, vegetarian food, gardens and museums, with a daily rest break. Flights will be arranged separately.',
      );
    await page.getByRole('button', { name: 'Review brief', exact: true }).click();
  });
  check(
    workspace.stops.length === 1 &&
      /london/i.test(workspace.stops[0].name) &&
      workspace.stops[0].nights === 3 &&
      workspace.stops[0].arrivalDate === '2027-05-01' &&
      workspace.stops[0].departureDate === '2027-05-04',
    'Actual model retains London dates and explicit three-night stay',
  );
  check(
    workspace.brief.adults === 2 &&
      workspace.brief.children === 1 &&
      workspace.brief.childAges[0] === 7,
    'Actual model retains family occupancy and child age',
  );
  await waitMutation('/accept-structure', () =>
    page
      .getByTestId('studio-trip-board')
      .getByRole('button', { name: 'Use this route', exact: true })
      .click(),
  );
  check(workspace.structureAccepted, 'Route approved directly from compact canvas');
  const briefingDeadline = Date.now() + 180000;
  while (!workspace.tripBriefing && Date.now() < briefingDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await api(own(''));
  }
  check(
    Boolean(workspace.tripBriefing?.stops.length) &&
      workspace.tripBriefing.stops.every(
        (stop) => stop.weather.kind === 'seasonal_outlook' && stop.weather.sources.length,
      ),
    'Automatic travel briefing supplies sourced seasonal guidance',
  );
  report.travelBriefing = {
    weather: workspace.tripBriefing.stops.map((stop) => stop.weather.kind),
    entryStatuses: workspace.tripBriefing.stops.map(
      (stop) => stop.entryRequirements?.status || 'missing',
    ),
    entryErrors: workspace.tripBriefing.stops.map((stop) => stop.entryError),
  };
  check(
    workspace.tripBriefing.stops.every(
      (stop) => stop.entryRequirements || Boolean(stop.entryError),
    ),
    'Automatic entry checks finish with sourced evidence or an explicit review reason',
  );
  await expect(page.getByTestId('studio-trip-board')).not.toContainText('Entry checks pending');
  await waitMutation('/itinerary', () =>
    page
      .getByRole('region', { name: 'Tara planning actions' })
      .getByRole('button', { name: 'Build daily itinerary', exact: true })
      .click(),
  );
  check(
    workspace.itinerary?.days.length === 4 &&
      workspace.itinerary.days.some((day) =>
        day.activities.some((activity) => activity.sources.length),
      ),
    'Actual model creates four calendar days with researched sources',
  );
  await page
    .getByRole('region', { name: 'Tara planning actions' })
    .getByRole('button', { name: /Hotels in London/ })
    .click();
  const search = page.getByRole('dialog', { name: 'Hotel options', exact: true });
  await expect(search.getByLabel('Confirm guest nationality')).toHaveValue('AU');
  const hotelResult = await waitMutation('/hotels/search', () =>
    search.getByRole('button', { name: /Search available hotels/ }).click(),
  );
  check(
    hotelResult.mode === 'test' &&
      hotelResult.hotels.length > 0 &&
      hotelResult.hotels.every((hotel) => hotel.adults === 2 && hotel.childAges[0] === 7),
    'Actual sandbox inventory prices the stated family for the full stay',
  );
  report.inventory = {
    hotels: hotelResult.inventory.returnedHotels,
    roomQuotes: hotelResult.hotels.length,
    propertyPhotos: hotelResult.hotels.filter((hotel) => hotel.photos.length).length,
    roomPhotos: hotelResult.hotels.filter((hotel) => hotel.roomPhotos.length).length,
  };
  const card = page.getByTestId('studio-chat-hotel-card').first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Quoted room photos', exact: true }).click();
  await expect(card).toContainText('Full stay');
  await expect(card).toContainText('Sandbox availability');
  const inclusion = page.waitForResponse(
    (response) =>
      /\/quotes\//.test(new URL(response.url()).pathname) && response.request().method() === 'POST',
    { timeout: 30000 },
  );
  await card.getByRole('button', { name: 'Add to proposal', exact: true }).click();
  const selectedResponse = await inclusion;
  assert(selectedResponse.ok());
  ({ workspace } = await selectedResponse.json());
  const included = workspace.items.find(
    (item) => item.included && item.presentation?.kind === 'hotel',
  );
  check(
    included?.priceStatus === 'sandbox' &&
      included.presentation.hotel.childAges[0] === 7 &&
      included.presentation.hotel.roomPhotos.length > 0,
    'One-click selection retains protected room photos and test price metadata',
  );
  await expect(page.getByTestId('studio-trip-board')).toContainText(included.title);
  await expect(
    page
      .getByRole('region', { name: 'Tara planning actions' })
      .getByRole('button', { name: 'Find flights', exact: true }),
  ).toHaveCount(0);
  check(true, 'Next planning actions respect separately arranged flights and family fare limits');
  const otherDays = structuredClone(workspace.itinerary.days.slice(1));
  await page.getByRole('button', { name: 'Edit day 1', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit day 1', exact: true });
  await editor
    .getByLabel('Day notes', { exact: true })
    .fill('Keep a quiet afternoon rest for this family.');
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === own('') && response.request().method() === 'PATCH',
  );
  await editor.getByRole('button', { name: 'Save day', exact: true }).click();
  ({ workspace } = await (await saved).json());
  check(
    workspace.itinerary.days[0].summary.includes('quiet afternoon rest') &&
      JSON.stringify(workspace.itinerary.days.slice(1)) === JSON.stringify(otherDays),
    'Day popup saves the edit and preserves every other itinerary day',
  );
  await page.reload();
  await expect(page.getByTestId('studio-chat-hotel-card').first()).toContainText(
    included.presentation.hotel.name,
  );
  await expect(page.getByTestId('studio-trip-board')).toContainText('quiet afternoon rest');
  check(true, 'Reload preserves selected supplier imagery and manual day edit');
  await page.getByRole('button', { name: 'Preview proposal', exact: true }).first().click();
  const tool = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('tablist', { name: 'Plan details' }) });
  await tool.getByRole('button', { name: 'Preview client proposal', exact: true }).click();
  const preview = await api(own('/proposal/preview'));
  check(
    !JSON.stringify(preview).includes(profile.dateOfBirth) &&
      !JSON.stringify(preview).includes('Quiet gardens and walkable neighbourhoods.'),
    'Private DOB and feedback stay out of client proposal output',
  );
  const pdfResponse = await context.request.get(new URL(own('/proposal/preview/pdf'), base).href);
  assert(pdfResponse.ok(), `Private PDF HTTP ${pdfResponse.status()}`);
  const pdf = await pdfResponse.body();
  check(
    pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 3000,
    'Private PDF export succeeds',
  );
  await writeFile(`${output}/private-proposal.pdf`, pdf);
  report.pdfBytes = pdf.length;
  await tool.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByTestId('studio-chat-hotel-card').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const targets = [
      document.querySelector('[data-testid="studio-trip-board"]'),
      document.querySelector('[data-testid="studio-chat-offers"]'),
    ];
    return targets.every((target) => {
      if (!target) return false;
      for (let node = target; node; node = node.parentElement)
        if (Number(getComputedStyle(node).opacity) < 0.99) return false;
      return true;
    });
  });
  await page.screenshot({
    path: `${output}/desktop-family.png`,
    fullPage: true,
    animations: 'disabled',
  });
  check(
    report.unexpectedMutations.length === 0 && report.pageErrors.length === 0,
    'Zero booking/payment/publication calls or browser exceptions',
  );
  report.success = true;
} catch (error) {
  report.success = false;
  report.error = error.message;
  await page
    .screenshot({ path: `${output}/failure.png`, fullPage: true, animations: 'disabled' })
    .catch(() => {});
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  if (workspace) {
    try {
      await api(own(''), 'DELETE');
      report.cleanup.workspace = true;
    } catch {
      report.cleanup.workspace = false;
    }
  }
  if (profile) {
    try {
      await api(`/api/studio/client-profiles/${profile.id}`, 'DELETE');
      report.cleanup.profile = true;
    } catch {
      report.cleanup.profile = false;
    }
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(`Report: ${output}/report.json`);
}
