import {
  openStudioClientDesk,
  openStudioClientProfiles,
  openStudioDestinationResearch,
} from './ui-helpers';
import { test, expect, type Page } from '@playwright/test';
import { catalog } from '../shared/catalog';
import { defaultStudioAgency, type StudioWorkspace } from '../shared/studio';
import type { StudioClientProfile } from '../shared/studio-clients';
import type {
  StudioDestinationResearch,
  StudioEntryRequirements,
} from '../shared/studio-travel-research';
import { newStudioWorkspace } from '../server/studio-store';
import { fulfilSyntheticTripBriefing } from './studio-trip-briefing-fixture';

const photo =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6N3VEAAAAASUVORK5CYII=';
const profile = (id: string, destination: string): StudioClientProfile => ({
  id,
  name: 'John Example',
  context: 'Enjoys art and gardens.',
  passportNationality: 'PK',
  photoDataUrl: photo,
  interests: ['Culture'],
  foodPreferences: ['Vegetarian'],
  history: [{ destination }],
  updatedAt: new Date().toISOString(),
});

async function mockBuilder(page: Page) {
  const workspace = newStudioWorkspace();
  workspace.brief.startDate = '2027-04-01';
  workspace.brief.endDate = '2027-04-10';
  let profiles = [profile('client-london', 'London'), profile('client-kyoto', 'Kyoto')];
  const writes: { path: string; body: Record<string, any> }[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === '/api/session') return json({ user: null });
    if (path === '/api/config') return json({});
    if (path === '/api/catalog') return json(catalog);
    if (path === '/api/profile') return json({ profile: null });
    if (path === '/api/saved') return json({ items: [] });
    if (path === '/api/integrations')
      return json({ ai: true, hotels: false, flights: false, activities: false, mode: 'live' });
    if (path === '/api/studio/agency') return json({ agency: defaultStudioAgency() });
    if (path === '/api/studio/clients') return json({ clients: [] });
    if (path === '/api/studio/client-profiles' && method === 'GET')
      return json({ clients: profiles });
    if (/\/api\/studio\/client-profiles\/[^/]+\/history$/.test(path) && method === 'GET')
      return json({
        history: profiles.find((client) => path.includes(`/${client.id}/`))?.history || [],
      });
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'GET')
      return json({ workspace });
    if (await fulfilSyntheticTripBriefing(route, workspace)) return;
    const body = route.request().postDataJSON() || {};
    writes.push({ path, body });
    if (path.includes('/workspaces/') && body.revision !== workspace.revision)
      return json({ error: 'Workspace revision changed.' }, 409);
    if (path === '/api/studio/client-profiles' && method === 'POST') {
      const client = { ...body, id: 'new-profile', updatedAt: new Date().toISOString() };
      profiles = [...profiles, client];
      return json({ client }, 201);
    }
    if (path === '/api/studio/client-profiles/new-profile' && method === 'DELETE') {
      profiles = profiles.filter((client) => client.id !== 'new-profile');
      workspace.brief.clientId = '';
      workspace.revision++;
      return route.fulfill({ status: 204, body: '' });
    }
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'PATCH') {
      Object.assign(workspace.brief, body.brief || {});
      if (body.stops) workspace.stops = body.stops;
      workspace.revision++;
      return json({ workspace });
    }
    if (path.endsWith('/destinations/research')) {
      const now = new Date().toISOString();
      const source = {
        label: 'Official travel advice',
        url: 'https://www.gov.uk/foreign-travel-advice/japan',
        checkedAt: now,
        kind: 'advisory' as const,
        publishedAt: now,
      };
      workspace.destinationResearch = {
        checkedAt: now,
        inputKey: JSON.stringify({
          startDate: workspace.brief.startDate,
          endDate: workspace.brief.endDate,
          preferredDestination: workspace.brief.preferredDestination || '',
          budget: workspace.brief.budget,
          currency: workspace.brief.currency,
          interests: workspace.brief.interests,
        }),
        historyUsed: true,
        candidates: [
          {
            destination: 'Tokyo',
            country: 'Japan',
            countryCode: 'JP',
            reason: 'Explore art after a previous visit to Kyoto.',
            suggestedDays: 8,
            thingsToDo: ['Public gardens'],
            conditions: 'Review current local notices.',
            seasonalGuidance: 'Mild spring conditions are usual.',
            status: 'checked',
            advisory: 'Current official advice checked.',
            recommendable: true,
            sources: [source],
          },
          {
            destination: 'Moscow',
            country: 'Russia',
            countryCode: 'RU',
            reason: 'Current advice prevents a holiday recommendation.',
            suggestedDays: 7,
            thingsToDo: [],
            conditions: 'Travel disruption requires review.',
            seasonalGuidance: '',
            status: 'blocked',
            advisory: 'Official advice warns against travel.',
            recommendable: false,
            sources: [{ ...source, url: 'https://www.gov.uk/foreign-travel-advice/russia' }],
          },
        ],
        notes: [],
      } satisfies StudioDestinationResearch;
      workspace.revision++;
      return json({ workspace, research: workspace.destinationResearch });
    }
    if (path.endsWith('/entry-requirements')) {
      const stop = workspace.stops.find((value) => value.id === body.stopId)!;
      const now = new Date().toISOString();
      const result: StudioEntryRequirements = {
        checkedAt: now,
        inputKey: JSON.stringify({
          startDate: stop.arrivalDate || workspace.brief.startDate,
          endDate: stop.departureDate || workspace.brief.endDate,
          arrivalTransport: 'undecided',
          departureTransport: 'undecided',
        }),
        stopId: stop.id,
        passportCountry: 'Pakistan',
        passportCountryCode: 'PK',
        destination: stop.name,
        destinationCountry: 'Japan',
        destinationCountryCode: 'JP',
        category: 'visa_required',
        status: 'corroborated',
        summary: 'Apply for a tourist visa before departure.',
        conditions: ['Confirm permitted stay.'],
        electronicAuthorisation: 'No separate authorisation established.',
        sources: [
          {
            label: 'Official immigration source',
            url: 'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html',
            checkedAt: now,
            kind: 'official_immigration',
            publishedAt: now,
          },
        ],
        observations: [],
        notes: [],
      };
      workspace.entryRequirements = [result];
      workspace.revision++;
      return json({ workspace, entryRequirements: result });
    }
    return json({ error: `Unexpected request ${method} ${path}` }, 500);
  });
  await page.goto(`/studio/${workspace.id}`);
  return { workspace, writes };
}

test('returning profile identity and history guide research, with visa check only after choosing a destination', async ({
  page,
}) => {
  const { workspace, writes } = await mockBuilder(page);
  await openStudioClientDesk(page);
  await openStudioClientProfiles(page, 'Client profiles · new or returning');
  await page
    .getByRole('combobox', { name: 'Saved client', exact: true })
    .selectOption('client-kyoto');
  await expect.poll(() => workspace.brief.clientId).toBe('client-kyoto');
  await expect
    .poll(() => writes.filter(({ path }) => path.endsWith('/destinations/research')).length)
    .toBe(1);
  await openStudioClientDesk(page);
  await openStudioClientProfiles(page, 'Client profiles · John Example');
  await expect(page.getByRole('img', { name: 'John Example profile' })).toBeVisible();
  await expect(page.getByText('Travel history: Kyoto', { exact: true })).toBeVisible();
  expect(workspace.brief.clientId).toBe('client-kyoto');
  expect(workspace.brief.passportNationality).toBe('PK');
  const detailedResearch = await openStudioDestinationResearch(page);
  await expect(
    page.getByRole('button', { name: 'Check entry requirements', exact: true }),
  ).toBeDisabled();
  await expect(page.getByText('Based on previous travel', { exact: false })).toBeVisible();
  expect(writes.filter(({ path }) => path.endsWith('/destinations/research'))).toHaveLength(1);
  await expect(
    page.getByRole('button', { name: 'Choose with warning', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText('Official advice warns against travel.', { exact: true }),
  ).toBeVisible();
  expect(workspace.stops).toHaveLength(0);
  await page.getByRole('button', { name: 'Let’s go', exact: true }).click();
  await openStudioDestinationResearch(page);
  await expect(
    page.getByRole('button', { name: 'Check entry requirements', exact: true }),
  ).toBeEnabled();
  expect(workspace.stops[0].name).toBe('Tokyo');
  await page.getByRole('button', { name: 'Check entry requirements', exact: true }).click();
  await expect(detailedResearch.getByText('Visa required', { exact: true })).toBeVisible();
  await page.getByText('Compare evidence and sources', { exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Official immigration source', exact: true }),
  ).toBeVisible();
  expect(
    writes.filter(({ path }) => /destinations\/research|entry-requirements/.test(path)),
  ).toHaveLength(2);
  expect(JSON.stringify(writes)).not.toContain('photoDataUrl');
});

test('new client profile keeps the optional photo in the profile and links the trip by stable id', async ({
  page,
}) => {
  const { workspace, writes } = await mockBuilder(page);
  await openStudioClientDesk(page);
  await openStudioClientProfiles(page, 'Client profiles · new or returning');
  await page.getByRole('button', { name: 'New client profile', exact: true }).click();
  await page.getByRole('textbox', { name: 'Profile name', exact: true }).fill('Alex Example');
  await page
    .getByRole('combobox', { name: 'Profile passport nationality', exact: true })
    .selectOption('PK');
  await page.getByRole('button', { name: 'Add past trip', exact: true }).click();
  await page.getByRole('textbox', { name: 'Past trip 1 destination', exact: true }).fill('Paris');
  await page.getByRole('button', { name: 'Add past trip', exact: true }).click();
  await page.getByRole('textbox', { name: 'Past trip 2 destination', exact: true }).fill('Kyoto');
  await page.getByLabel('Client photo', { exact: true }).setInputFiles({
    name: 'synthetic-profile.png',
    mimeType: 'image/png',
    buffer: Buffer.from(photo.split(',')[1], 'base64'),
  });
  await expect(page.getByRole('img', { name: 'Client photo preview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save client profile', exact: true }).click();
  await expect.poll(() => workspace.brief.clientId).toBe('new-profile');
  await expect
    .poll(() => writes.filter(({ path }) => path.endsWith('/destinations/research')).length)
    .toBe(1);
  await openStudioClientDesk(page);
  await openStudioClientProfiles(page, 'Client profiles · Alex Example');
  await expect(page.getByRole('combobox', { name: 'Saved client', exact: true })).toHaveValue(
    'new-profile',
  );
  expect(workspace.brief.clientId).toBe('new-profile');
  expect(workspace.brief.clientName).toBe('Alex Example');
  const saved = writes.find(({ path }) => path === '/api/studio/client-profiles')!;
  expect(saved.body.photoDataUrl).toBe(photo);
  expect(saved.body.history.map((value: { destination: string }) => value.destination)).toEqual([
    'Paris',
    'Kyoto',
  ]);
  expect(writes.filter(({ path }) => path.endsWith('/destinations/research'))).toHaveLength(1);
  expect(writes.filter(({ path }) => path.endsWith('/entry-requirements'))).toHaveLength(0);
  expect(JSON.stringify(writes.filter(({ path }) => path.includes('/workspaces/')))).not.toContain(
    'photoDataUrl',
  );
  const beforeDelete = writes.length;
  await page.getByRole('button', { name: 'Delete profile', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Saved client', exact: true })).toHaveValue('');
  expect(workspace.brief.clientId).toBe('');
  expect(writes.slice(beforeDelete).map(({ path }) => path)).toEqual([
    '/api/studio/client-profiles/new-profile',
  ]);
});
