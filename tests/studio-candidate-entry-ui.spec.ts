import { expect, test, type Page } from '@playwright/test';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import { defaultStudioAgency, type StudioWorkspace } from '../shared/studio';
import type { StudioClientProfile } from '../shared/studio-clients';
import { studioCandidateEntryFresh } from '../shared/studio-travel-research';
import { newStudioWorkspace } from '../server/studio-store';
import { applyStudioPatch } from '../server/studio-domain';
import { seedSyntheticCandidateEntries } from './studio-candidate-entry-fixture';
import { openStudioDestinationResearch } from './ui-helpers';

const profile: StudioClientProfile = {
  id: 'visa-fixture-client',
  name: 'Fictional Kyoto Traveller',
  passportNationality: 'AU',
  nationality: 'CA',
  country: 'NZ',
  photoDataUrl: '',
  context: '',
  interests: ['Gardens'],
  foodPreferences: [],
  history: [{ destination: 'Kyoto', country: 'JP', feedback: 'liked' }],
  updatedAt: new Date().toISOString(),
};
function fixture(passport = 'AU') {
  const workspace = newStudioWorkspace();
  Object.assign(workspace.brief, {
    clientId: profile.id,
    clientName: profile.name,
    passportNationality: passport,
    interests: ['Gardens'],
  });
  return workspace;
}
function shortlist(workspace: StudioWorkspace, checkedAt = new Date().toISOString()) {
  workspace.destinationResearch = {
    checkedAt,
    inputKey: 'synthetic-shortlist-hash',
    historyUsed: true,
    notes: [],
    candidates: [
      {
        destination: 'Kyoto',
        country: 'Japan',
        countryCode: 'JP',
        reason: 'Quiet gardens fit the preferences.',
        suggestedDays: 5,
        thingsToDo: ['Gardens'],
        conditions: 'Synthetic conditions.',
        seasonalGuidance: 'Confirm travel dates.',
        status: 'checked',
        recommendable: true,
        advisory: 'Synthetic advice checked.',
        sources: [],
      },
    ],
  };
}
async function mock(
  page: Page,
  workspace: StudioWorkspace,
  options: {
    entryGate?: Promise<void>;
    failEntry?: boolean;
    conflictEntry?: boolean;
    futurePhase?: 'research' | 'entry';
  } = {},
) {
  const writes: { path: string; body: any }[] = [],
    unexpected: string[] = [];
  let conflicted = false;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === '/api/session') return json({ user: null });
    if (path === '/api/catalog') return json(catalog);
    if (path === '/api/config') return json({});
    if (path === '/api/profile') return json({ profile: defaultTravelProfile });
    if (path === '/api/saved') return json({ items: [] });
    if (path === '/api/integrations')
      return json({ ai: true, hotels: false, flights: false, activities: false, mode: 'live' });
    if (path === '/api/studio/agency') return json({ agency: defaultStudioAgency() });
    if (path === '/api/studio/clients') return json({ clients: [] });
    if (path === '/api/studio/client-profiles') return json({ clients: [profile] });
    if (path.endsWith(`/client-profiles/${profile.id}/history`))
      return json({ history: profile.history });
    if (path === '/api/studio/workspaces') return json({ workspaces: [workspace] });
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'GET')
      return json({ workspace });
    const body = route.request().postDataJSON() || {};
    writes.push({ path, body });
    if (body.revision !== workspace.revision)
      return json({ error: 'Workspace revision changed.' }, 409);
    if (path.endsWith('/destinations/research')) {
      shortlist(workspace);
      seedSyntheticCandidateEntries(workspace, 'unknown', { status: 'pending' });
      if (options.futurePhase === 'research')
        workspace.destinationResearch!.checkedAt = new Date(Date.now() + 60000).toISOString();
      workspace.revision++;
      return json({ workspace, research: workspace.destinationResearch });
    }
    if (path.endsWith('/destinations/entry-requirements')) {
      if (options.entryGate) await options.entryGate;
      if (options.conflictEntry && !conflicted) {
        conflicted = true;
        workspace.revision++;
        return json({ error: 'Workspace revision changed.' }, 409);
      }
      if (options.failEntry)
        return json({ error: 'Synthetic visa provider temporarily unavailable.' }, 503);
      seedSyntheticCandidateEntries(
        workspace,
        workspace.brief.passportNationality === 'PK' ? 'visa_required' : 'visa_free',
        options.futurePhase === 'entry'
          ? { checkedAt: new Date(Date.now() + 60000).toISOString() }
          : {},
      );
      workspace.revision++;
      return json({ workspace, research: workspace.destinationResearch });
    }
    if (path.endsWith('/review')) {
      const patch =
        body.message === 'PK'
          ? { passportNationality: 'PK' }
          : body.message === 'business'
            ? { tripPurpose: 'business' as const }
            : {};
      applyStudioPatch(
        workspace,
        { revision: workspace.revision, brief: patch },
        defaultStudioAgency(),
      );
      workspace.messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: body.message,
        createdAt: new Date().toISOString(),
      });
      workspace.messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Details noted. What else would you like to plan?',
        createdAt: new Date().toISOString(),
      });
      workspace.revision++;
      return json({ workspace, reply: 'Details noted.' });
    }
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'PATCH') {
      applyStudioPatch(workspace, body, defaultStudioAgency());
      workspace.revision++;
      return json({ workspace });
    }
    unexpected.push(`${method} ${path}`);
    return json({ error: 'Unexpected synthetic request' }, 500);
  });
  await page.goto(`/studio/${workspace.id}`);
  return { writes, unexpected };
}
const inspiration = (page: Page) =>
  page.getByRole('region', { name: 'Selected client and personalised inspiration' });
const visaChecks = (writes: { path: string }[]) =>
  writes.filter((write) => write.path.endsWith('/destinations/entry-requirements'));

test('Kyoto suggestions automatically check the declared passport before dates or route selection', async ({
  page,
}) => {
  const workspace = fixture(),
    { writes, unexpected } = await mock(page, workspace);
  await expect(
    inspiration(page).getByText('Visa-free · conditional', { exact: true }),
  ).toBeVisible();
  expect(workspace.stops).toHaveLength(0);
  expect(writes.map((write) => write.path.split('/destinations/')[1])).toEqual([
    'research',
    'entry-requirements',
  ]);
  await inspiration(page).getByText('Visa-free · conditional', { exact: true }).click();
  const guidance = inspiration(page).getByLabel('Entry guidance for Kyoto', { exact: true });
  await expect(guidance).toContainText('Australia passport → Japan');
  await expect(guidance).toContainText('purpose not declared');
  await expect(guidance).toContainText('Still needed: arrival date, return date, trip purpose.');
  await expect(
    guidance.getByRole('link', { name: 'Synthetic official Japan visa source' }),
  ).toBeVisible();
  await page.screenshot({
    path: '/private/tmp/asktara-kyoto-automatic-candidate-visa.png',
    fullPage: true,
  });
  const research = await openStudioDestinationResearch(page);
  await expect(research.getByText('Visa-free · conditional', { exact: true })).toBeVisible();
  expect(unexpected).toEqual([]);
});
test('a persisted legacy shortlist upgrades its visa checks without replacing suggestions', async ({
  page,
}) => {
  const workspace = fixture();
  shortlist(workspace);
  const before = structuredClone(workspace.destinationResearch!.candidates[0]);
  const { writes } = await mock(page, workspace);
  await expect(
    inspiration(page).getByText('Visa-free · conditional', { exact: true }),
  ).toBeVisible();
  expect(writes.map((write) => write.path.split('/destinations/')[1])).toEqual([
    'entry-requirements',
  ]);
  expect(workspace.destinationResearch!.candidates[0]).toMatchObject({ ...before });
  await page.reload();
  await expect(
    inspiration(page).getByText('Visa-free · conditional', { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1200);
  expect(visaChecks(writes)).toHaveLength(1);
});
test('short passport and purpose replies recheck the same shortlist and preserve unsent chat', async ({
  page,
}) => {
  const workspace = fixture();
  shortlist(workspace);
  seedSyntheticCandidateEntries(workspace);
  const { writes } = await mock(page, workspace);
  const chat = page.getByRole('textbox', {
    name: /^(Client request or planning notes|Reply or refine the route)$/,
  });
  await chat.fill('PK');
  await chat.press('Enter');
  await expect(
    inspiration(page).getByText('Visa required · conditional', { exact: true }),
  ).toBeVisible();
  await expect(inspiration(page).getByText('Visa-free · conditional', { exact: true })).toHaveCount(
    0,
  );
  await chat.fill('business');
  await chat.press('Enter');
  await expect.poll(() => visaChecks(writes).length).toBe(2);
  await chat.fill('two');
  await expect
    .poll(() => studioCandidateEntryFresh(workspace, workspace.destinationResearch!.candidates[0]))
    .toBe(true);
  await expect(chat).toHaveValue('two');
  expect(writes.filter((write) => write.path.endsWith('/destinations/research'))).toHaveLength(0);
  expect(workspace.destinationResearch!.candidates[0].destination).toBe('Kyoto');
  expect(workspace.brief.tripPurpose).toBe('business');
});
test('nationality and residence without declared passport show a prompt, not visa eligibility', async ({
  page,
}) => {
  const workspace = fixture('');
  const { writes } = await mock(page, workspace);
  await expect(
    inspiration(page).getByText('Add passport nationality for visa advice', { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1500);
  expect(visaChecks(writes)).toHaveLength(0);
  expect(workspace.brief.passportNationality).toBe('');
});
test('expired stored shortlist refreshes then checks visas once', async ({ page }) => {
  const workspace = fixture();
  shortlist(workspace, new Date(Date.now() - 21601000).toISOString());
  seedSyntheticCandidateEntries(workspace, 'visa_free', {
    checkedAt: workspace.destinationResearch!.checkedAt,
  });
  const { writes } = await mock(page, workspace);
  await expect(
    inspiration(page).getByText('Visa-free · conditional', { exact: true }),
  ).toBeVisible();
  expect(writes.map((write) => write.path.split('/destinations/')[1])).toEqual([
    'research',
    'entry-requirements',
  ]);
  await page.waitForTimeout(1500);
  expect(visaChecks(writes)).toHaveLength(1);
});
test('provider failure stays visible without retry loops or losing the draft', async ({ page }) => {
  const workspace = fixture();
  shortlist(workspace);
  const { writes } = await mock(page, workspace, { failEntry: true });
  const chat = page.getByRole('textbox', {
    name: /^(Client request or planning notes|Reply or refine the route)$/,
  });
  await chat.fill('a quiet honeymoon');
  await expect(
    page.getByText('Synthetic visa provider temporarily unavailable.', { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1800);
  expect(visaChecks(writes)).toHaveLength(1);
  await expect(chat).toHaveValue('a quiet honeymoon');
  await expect(inspiration(page).getByText('Visa check pending', { exact: true })).toBeVisible();
});
test('one concurrent revision conflict reloads safely then finishes without replacing chat text', async ({
  page,
}) => {
  const workspace = fixture();
  shortlist(workspace);
  const { writes } = await mock(page, workspace, { conflictEntry: true });
  const chat = page.getByRole('textbox', {
    name: /^(Client request or planning notes|Reply or refine the route)$/,
  });
  await chat.fill('five friends trekking in Nepal');
  await expect(
    inspiration(page).getByText('Visa-free · conditional', { exact: true }),
  ).toBeVisible();
  expect(visaChecks(writes)).toHaveLength(2);
  await expect(chat).toHaveValue('five friends trekking in Nepal');
});
test('a small server clock lead catches up without another research or entry request', async ({
  page,
}) => {
  const workspace = fixture();
  const checkedAt = new Date(Date.now() + 2500).toISOString();
  shortlist(workspace, checkedAt);
  seedSyntheticCandidateEntries(workspace, 'visa_free', { checkedAt });
  const { writes } = await mock(page, workspace);
  await expect(
    inspiration(page).getByText('Visa-free · conditional', { exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(0);
});
test('persisted checks expire while the desktop is idle and refresh without a new chat turn', async ({
  page,
}) => {
  const workspace = fixture();
  const checkedAt = new Date(Date.now() - 21600000 + 2500).toISOString();
  shortlist(workspace, checkedAt);
  seedSyntheticCandidateEntries(workspace, 'visa_free', { checkedAt });
  const { writes } = await mock(page, workspace);
  await expect.poll(() => visaChecks(writes).length).toBe(1);
  await expect(
    inspiration(page).getByText('Visa-free · conditional', { exact: true }),
  ).toBeVisible();
  expect(writes.filter((write) => write.path.endsWith('/destinations/research'))).toHaveLength(1);
  expect(workspace.messages).toHaveLength(0);
});
for (const phase of ['research', 'entry'] as const) {
  test(`large ${phase} server clock skew stops automatic retries and never shows positive visa evidence`, async ({
    page,
  }) => {
    const workspace = fixture();
    if (phase === 'entry') shortlist(workspace);
    const { writes } = await mock(page, workspace, { futurePhase: phase });
    const warning = page.getByText(
      'The destination checks are dated ahead of this browser. Check your device time, then use Find ideas to retry.',
      { exact: true },
    );
    await expect(warning).toBeVisible();
    await page.waitForTimeout(2000);
    expect(writes).toHaveLength(1);
    await expect(
      inspiration(page).getByText('Visa-free · conditional', { exact: true }),
    ).toHaveCount(0);
    await inspiration(page).getByRole('button', { name: 'Find ideas', exact: true }).click();
    await expect.poll(() => writes.length).toBe(phase === 'entry' ? 3 : 2);
    await expect(warning).toBeVisible();
    await page.waitForTimeout(1200);
    expect(writes).toHaveLength(phase === 'entry' ? 3 : 2);
  });
}
