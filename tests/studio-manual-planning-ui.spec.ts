import { test, expect, type Page } from '@playwright/test';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import { defaultStudioAgency, type StudioWorkspace } from '../shared/studio';
import { cruiseDraftToItinerary, type StudioCruiseDraft } from '../shared/studio-cruise';
import { sanitizeManualStudioItinerary } from '../shared/studio-itinerary';
import { fulfilSyntheticTripBriefing } from './studio-trip-briefing-fixture';
import { openStudioCruiseImport, openStudioTool } from './ui-helpers';
import { newStudioWorkspace } from '../server/studio-store';

const now = '2026-10-01T12:00:00.000Z';
function fixture(): StudioWorkspace {
  const workspace = newStudioWorkspace();
  workspace.title = 'Manual planning test';
  workspace.stage = 'itinerary';
  workspace.structureAccepted = true;
  workspace.brief.startDate = '2027-10-01';
  workspace.stops = [
    {
      id: 'london',
      name: 'London',
      country: 'United Kingdom',
      nights: 1,
      arrivalDate: '2027-10-01',
      departureDate: '2027-10-02',
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
  return workspace;
}
function cruise(): StudioCruiseDraft {
  return {
    id: 'test-cruise',
    name: 'Pacific sailing',
    ship: 'Example ship',
    sourceName: 'Cruise source',
    sourceUrl: 'https://cruise.example/itinerary',
    extractedAt: now,
    currency: 'USD',
    fullFare: 4500,
    disembarkAfterDay: null,
    onwardTransport: 'undecided',
    returnTransport: 'undecided',
    days: ['Hong Kong', 'At sea', 'Taipei', 'Shanghai'].map((port, index) => ({
      day: index + 1,
      date: `2027-10-0${index + 1}`,
      port,
      arrival: '',
      departure: '',
      details: '',
    })),
    warnings: ['Review imported days before applying.'],
  };
}
async function mockWorkspace(page: Page, workspace: StudioWorkspace) {
  const writes: { path: string; body: Record<string, any> }[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (value: unknown) => route.fulfill({ json: value });
    if (path === '/api/session') return json({ user: null });
    if (path === '/api/config') return json({});
    if (path === '/api/catalog') return json(catalog);
    if (path === '/api/profile') return json({ profile: defaultTravelProfile });
    if (path === '/api/saved') return json({ items: [] });
    if (path === '/api/integrations')
      return json({ ai: false, hotels: false, flights: false, activities: false, mode: 'live' });
    if (path === '/api/studio/agency') return json({ agency: defaultStudioAgency() });
    if (path === '/api/studio/clients') return json({ clients: [] });
    if (path === '/api/studio/client-profiles') return json({ clients: [] });
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'GET')
      return json({ workspace });
    if (await fulfilSyntheticTripBriefing(route, workspace)) return;
    const body = route.request().postDataJSON();
    writes.push({ path, body });
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'PATCH') {
      workspace.itinerary = body.itinerary
        ? sanitizeManualStudioItinerary(body.itinerary, workspace.itinerary)
        : null;
      workspace.revision++;
      return json({ workspace });
    }
    if (path.endsWith('/cruises/preview'))
      return json({
        cruise: workspace.cruises?.length
          ? { ...cruise(), id: 'second-cruise', name: 'Second reviewed cruise' }
          : cruise(),
        workspace,
      });
    if (path.endsWith('/cruises/apply')) {
      workspace.itinerary = cruiseDraftToItinerary(body.cruise);
      workspace.cruises = [body.cruise];
      workspace.revision++;
      return json({ workspace });
    }
    return route.fulfill({ status: 500, json: { error: `Unexpected request ${method} ${path}` } });
  });
  return writes;
}

test('manual daily plan can add edit delete and reorder content without AI', async ({ page }) => {
  const workspace = fixture();
  const writes = await mockWorkspace(page, workspace);
  await page.goto(`/studio/${workspace.id}`);
  await openStudioTool(page, 'Daily activities');
  await expect(
    page.getByRole('button', { name: 'Build day-by-day itinerary', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Start daily plan manually', exact: true }).click();
  const editor = page.getByRole('form', { name: 'Edit daily itinerary' });
  await editor.getByLabel('Day 1 title', { exact: true }).fill('My London recommendations');
  await editor.getByRole('button', { name: 'Add activity to day 1', exact: true }).click();
  await editor.getByLabel('Day 1 activity 1 title', { exact: true }).fill('Neighbourhood walk');
  await editor
    .getByLabel('Day 1 activity 1 details', { exact: true })
    .fill('My favourite walk along the river.');
  await editor.getByRole('button', { name: 'Add activity to day 1', exact: true }).click();
  await editor.getByLabel('Day 1 activity 2 title', { exact: true }).fill('Lunch with a view');
  await editor.getByRole('button', { name: 'Move day 1 activity 2 up', exact: true }).click();
  await expect(editor.getByLabel('Day 1 activity 1 title', { exact: true })).toHaveValue(
    'Lunch with a view',
  );
  await editor.getByRole('button', { name: 'Delete day 1 activity 2', exact: true }).click();
  await editor.getByRole('button', { name: 'Add day', exact: true }).click();
  await editor.getByLabel('Day 3 title', { exact: true }).fill('Extra free day');
  await editor.getByRole('button', { name: 'Move day 3 up', exact: true }).click();
  await editor.getByRole('button', { name: 'Delete day 3', exact: true }).click();
  await editor
    .getByLabel('Planning notes · one per line')
    .fill('Check weather.\nBring comfortable shoes.');
  expect(writes).toHaveLength(0);
  await editor.getByRole('button', { name: 'Save daily plan', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(writes[0].body.itinerary.days.map((day: { title: string }) => day.title)).toEqual([
    'My London recommendations',
    'Extra free day',
  ]);
  expect(workspace.itinerary?.days[0].activities).toHaveLength(1);
  expect(workspace.itinerary?.days[0].activities[0].title).toBe('Lunch with a view');
  expect(workspace.itinerary?.notes).toEqual(['Check weather.', 'Bring comfortable shoes.']);
});

test('changing a researched activity removes its source claim when manually saved', async ({
  page,
}) => {
  const workspace = fixture();
  workspace.itinerary = {
    generatedAt: now,
    days: [
      {
        day: 1,
        date: '2027-10-01',
        stopIds: ['london'],
        title: 'London',
        summary: '',
        activities: [
          {
            period: 'morning',
            title: 'Original source activity',
            description: 'Original description',
            sources: [
              {
                label: 'Original visitor guide',
                url: 'https://tourism.example/london',
                checkedAt: now,
              },
            ],
          },
        ],
      },
    ],
    notes: [],
  };
  await mockWorkspace(page, workspace);
  await page.goto(`/studio/${workspace.id}`);
  await openStudioTool(page, 'Daily activities');
  await page.getByRole('button', { name: 'Edit daily plan', exact: true }).click();
  const editor = page.getByRole('form', { name: 'Edit daily itinerary' });
  await editor
    .getByRole('textbox', { name: 'Day 1 activity 1 details', exact: true })
    .fill('A personal restaurant recommendation.');
  await editor.getByRole('button', { name: 'Save daily plan', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Original visitor guide' })).toHaveCount(0);
  expect(workspace.itinerary?.days[0].activities[0].sources).toEqual([]);
});

test('cruise preview needs explicit review, supports early Taipei exit and keeps full fare', async ({
  page,
}) => {
  const workspace = fixture();
  workspace.stage = 'structure';
  const writes = await mockWorkspace(page, workspace);
  await page.goto(`/studio/${workspace.id}`);
  await openStudioCruiseImport(page);
  const importer = page.getByRole('region', { name: 'Cruise itinerary import' });
  await importer.getByLabel('Cruise line itinerary URL').fill('https://cruise.example/itinerary');
  await importer.getByRole('button', { name: 'Preview cruise days', exact: true }).click();
  await expect(importer.getByLabel('Port or sea day · day 3')).toHaveValue('Taipei');
  expect(writes.filter(({ path }) => path.endsWith('/cruises/apply'))).toHaveLength(0);
  await importer
    .getByLabel('Cruise details · day 3')
    .fill('Disembark in Taipei and stay overnight.');
  await importer.getByRole('combobox', { name: 'Leave the cruise', exact: true }).click();
  await page.getByRole('option', { name: 'Day 3: Taipei', exact: true }).click();
  await importer.getByRole('combobox', { name: 'Onward travel after cruise', exact: true }).click();
  await page.getByRole('option', { name: 'Flight', exact: true }).click();
  await importer.getByRole('combobox', { name: 'Return travel', exact: true }).click();
  await page.getByRole('option', { name: 'Another cruise', exact: true }).click();
  await expect(importer.getByLabel('Full cruise fare', { exact: true })).toHaveValue('4500');
  await importer.getByRole('button', { name: 'Apply reviewed cruise', exact: true }).click();
  await expect
    .poll(() => writes.filter(({ path }) => path.endsWith('/cruises/apply')).length)
    .toBe(1);
  expect(workspace.cruises?.[0]).toMatchObject({
    fullFare: 4500,
    disembarkAfterDay: 3,
    onwardTransport: 'flight',
    returnTransport: 'cruise',
  });
  expect(workspace.itinerary?.days).toHaveLength(3);
  // Refreshing the saved workspace while extracting a second source must not replace the preview.
  await importer.getByLabel('Cruise line itinerary URL').fill('https://cruise.example/second');
  await importer.getByRole('button', { name: 'Preview cruise days', exact: true }).click();
  await expect(importer.getByRole('textbox', { name: 'Cruise name', exact: true })).toHaveValue(
    'Second reviewed cruise',
  );
  expect(writes.filter(({ path }) => path.endsWith('/cruises/apply'))).toHaveLength(1);
});
