#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

// Opt-in, real-provider check with a new fictional client only. Does not select
// suppliers, book, pay or publish. The browser must trigger both research stages.
assert.equal(process.env.STUDIO_CANDIDATE_ENTRY_SMOKE, '1', 'Set STUDIO_CANDIDATE_ENTRY_SMOKE=1.');
const base = new URL(process.argv[2] || 'http://localhost:3018');
assert(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password);
const output =
  process.env.STUDIO_CANDIDATE_ENTRY_OUT || `/private/tmp/asktara-candidate-entry-${randomUUID()}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
const page = await context.newPage();
const report = {
  target: base.origin,
  checks: [],
  requests: [],
  responses: [],
  forbidden: [],
  pageErrors: [],
  cleanup: {},
};
let workspace, profile;
const check = (condition, label) => {
  assert(condition, label);
  report.checks.push(label);
  console.log(`PASS ${label}`);
};
page.on('pageerror', (error) => report.pageErrors.push(error.message));
page.on('request', (request) => {
  const path = new URL(request.url()).pathname;
  if (request.method() !== 'GET') {
    report.requests.push(path.replace(/workspaces\/[^/]+/, 'workspaces/<id>'));
    if (
      /\/(?:hotels|flights|cruises)\/|\/(?:bookings?|orders?|payments?|prebook)(?:\/|$)|\/proposal$/.test(
        path,
      )
    )
      report.forbidden.push(path);
  }
});
page.on('response', async (response) => {
  const path = new URL(response.url()).pathname;
  if (!/\/destinations\//.test(path) || response.request().method() !== 'POST') return;
  const result = await response.json().catch(() => ({}));
  report.responses.push({
    path: path.replace(/workspaces\/[^/]+/, 'workspaces/<id>'),
    status: response.status(),
    ...(response.ok() ? {} : { error: result.error, code: result.code }),
  });
});
async function api(path, method = 'GET', body) {
  const response = await context.request.fetch(new URL(path, base).href, {
    method,
    headers: { Origin: base.origin },
    ...(body ? { data: body } : {}),
    timeout: 300000,
  });
  assert(response.ok(), `${method} ${path}: HTTP ${response.status()}`);
  if (response.status() === 204) return;
  const data = await response.json();
  if (data.workspace) workspace = data.workspace;
  return data;
}
const own = (suffix = '') => `/api/studio/workspaces/${workspace.id}${suffix}`;
async function awaitEntries(passport) {
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const failed = report.responses.find(
      (response) => response.status >= 400 && response.status !== 409,
    );
    if (failed)
      throw new Error(
        `${failed.path}: HTTP ${failed.status}: ${failed.code || ''} ${failed.error || ''}`,
      );
    await api(own());
    const candidates = workspace.destinationResearch?.candidates;
    if (
      candidates?.length &&
      candidates.every((candidate) => {
        const entry = candidate.entryRequirements;
        return (
          entry &&
          entry.status !== 'pending' &&
          entry.status !== 'missing_passport' &&
          entry.passportCountryCode === passport
        );
      })
    )
      return candidates;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Automatic candidate entry checks did not finish for ${passport}.`);
}
try {
  check((await api('/api/integrations')).ai, 'Actual AI configured');
  ({ client: profile } = await api('/api/studio/client-profiles', 'POST', {
    name: 'Fictional Kyoto Suggestion Tester',
    country: 'AU',
    nationality: 'AU',
    passportNationality: 'AU',
    dateOfBirth: '1988-07-12',
    photoDataUrl: '',
    context: 'Fictional customer used only to verify automatic checks.',
    interests: ['Gardens', 'Culture'],
    foodPreferences: ['Vegetarian'],
    history: [],
  }));
  await api('/api/studio/workspaces', 'POST', { clientId: profile.id });
  await api(own(), 'PATCH', {
    revision: workspace.revision,
    brief: { preferredDestination: 'Kyoto', tripPurpose: 'tourism' },
  });
  await page.goto(new URL(`/studio/${workspace.id}`, base).href);
  await page.locator('#studio-message').fill('I am still comparing destinations.');
  const candidates = await awaitEntries('AU');
  check(
    report.requests.some((path) => path.endsWith('/destinations/research')),
    'Browser automatically researched suggestions',
  );
  check(
    report.requests.some((path) => path.endsWith('/destinations/entry-requirements')),
    'Browser automatically checked candidate entry rules without a visa click',
  );
  check(
    workspace.stops.length === 0 && !workspace.structureAccepted,
    'Entry checks completed before any route was selected',
  );
  const kyoto = candidates.find(
    (candidate) => /kyoto/i.test(candidate.destination) && candidate.countryCode === 'JP',
  );
  check(Boolean(kyoto), 'Requested Kyoto appears in actual researched suggestions');
  check(
    kyoto.entryRequirements.passportCountryCode === 'AU',
    'Kyoto check uses declared Australian passport',
  );
  check(
    candidates.every(
      (candidate) =>
        candidate.entryRequirements.scope === 'destination_shortlist' &&
        candidate.entryRequirements.missingFacts.length > 0,
    ),
    'Undeclared dates remain missing and advice is preliminary',
  );
  check(
    candidates.every(
      (candidate) =>
        candidate.entryRequirements.status !== 'preliminary' ||
        candidate.entryRequirements.sources.some(
          (source) => source.kind === 'official_immigration',
        ),
    ),
    'Any positive preliminary category has a searched official immigration source',
  );
  const guidance = page
    .getByLabel(`Entry guidance for ${kyoto.destination}`, { exact: true })
    .first();
  await expect(guidance).toBeVisible();
  await guidance.locator('summary').click();
  await expect(guidance).toContainText('Australia passport');
  await expect(guidance).toContainText('Preliminary guidance');
  await expect(page.locator('#studio-message')).toHaveValue('I am still comparing destinations.');
  check(true, 'Passport guidance renders beside suggestions and preserves an unsent chat draft');
  report.firstPass = candidates;
  const shortlistStamp = workspace.destinationResearch.checkedAt;
  const shortlistNames = candidates.map((candidate) => candidate.destination);
  const requestsBeforeCorrection = report.requests.filter((path) =>
    path.endsWith('/destinations/research'),
  ).length;
  await api(own(), 'PATCH', { revision: workspace.revision, brief: { passportNationality: 'GB' } });
  await page.reload();
  const corrected = await awaitEntries('GB');
  check(
    workspace.destinationResearch.checkedAt === shortlistStamp &&
      JSON.stringify(corrected.map((candidate) => candidate.destination)) ===
        JSON.stringify(shortlistNames),
    'Passport correction retains the researched shortlist',
  );
  check(
    report.requests.filter((path) => path.endsWith('/destinations/research')).length ===
      requestsBeforeCorrection,
    'Passport correction rechecks entry rules without repeating destination research',
  );
  report.correctedPass = corrected;
  const correctedKyoto = corrected.find((candidate) => /kyoto/i.test(candidate.destination));
  const correctedGuidance = page
    .getByLabel(`Entry guidance for ${correctedKyoto.destination}`, { exact: true })
    .first();
  await correctedGuidance.locator('summary').click();
  await expect(correctedGuidance).toContainText('United Kingdom passport');
  await expect(correctedGuidance).not.toContainText('Australia passport');
  check(true, 'Corrected passport replaces old advice in the visible suggestion');
  const stage2Count = report.requests.filter((path) =>
    path.endsWith('/destinations/entry-requirements'),
  ).length;
  await page.reload();
  await page.waitForTimeout(2000);
  check(
    report.requests.filter((path) => path.endsWith('/destinations/entry-requirements')).length ===
      stage2Count,
    'Reload reuses current entry evidence without a retry loop',
  );
  check(
    workspace.items.length === 0 && workspace.proposal === null && report.forbidden.length === 0,
    'No supplier search, reservation, payment or publication',
  );
  check(report.pageErrors.length === 0, 'No browser runtime errors');
  await page.screenshot({
    path: `${output}/kyoto-guidance.png`,
    fullPage: true,
    animations: 'disabled',
  });
} catch (error) {
  report.error = String(error.message).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
  process.exitCode = 1;
  console.error(report.error);
} finally {
  if (workspace) {
    try {
      await api(own(), 'DELETE');
      report.cleanup.workspace = true;
    } catch {
      report.cleanup.workspace = false;
      process.exitCode = 1;
    }
  }
  if (profile) {
    try {
      await api(`/api/studio/client-profiles/${profile.id}`, 'DELETE');
      report.cleanup.client = true;
    } catch {
      report.cleanup.client = false;
      process.exitCode = 1;
    }
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(`Report: ${output}/report.json`);
}
