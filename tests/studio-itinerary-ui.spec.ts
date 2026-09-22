import { test, expect, type Page } from '@playwright/test';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import { defaultStudioAgency, type StudioWorkspace } from '../shared/studio';
import type { StudioItinerary } from '../shared/studio-itinerary';
import type { StudioClientProposal } from '../shared/studio-proposals';
import { newStudioWorkspace } from '../server/studio-store';

const stopId = 'london-itinerary-stop';
const now = '2026-09-22T12:00:00.000Z';
function fixture(): StudioWorkspace {
  const workspace = newStudioWorkspace();
  workspace.title = 'Synthetic London itinerary';
  workspace.stage = 'itinerary';
  workspace.structureAccepted = true;
  workspace.stops = [
    {
      id: stopId,
      name: 'London',
      country: 'United Kingdom',
      nights: 3,
      arrivalDate: '2027-06-01',
      departureDate: '2027-06-04',
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
  return workspace;
}
function itinerary(): StudioItinerary {
  return {
    generatedAt: now,
    days: [1, 2, 3, 4].map((day) => ({
      day,
      date: `2027-06-0${day}`,
      stopIds: [stopId],
      title: `London day ${day}`,
      summary: day === 4 ? 'A relaxed departure day.' : 'Leave time between visits.',
      activities: [
        {
          period: 'flexible',
          title: day === 4 ? 'Prepare for departure' : `London visit ${day}`,
          description: 'A suggested visit with time to travel and rest.',
          sources: [
            {
              label: 'Official visitor guide',
              url: 'https://visit.example.test/london',
              checkedAt: now,
            },
          ],
        },
      ],
    })),
    notes: ['Check opening times before travelling.'],
  };
}
async function mockWorkspace(
  page: Page,
  workspace: StudioWorkspace,
  reviewBehavior: 'refine' | 'change-route' = 'refine',
) {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (value: unknown) => route.fulfill({ json: value });
    if (path === '/api/session') return json({ user: null });
    if (path === '/api/catalog') return json(catalog);
    if (path === '/api/profile') return json({ profile: defaultTravelProfile });
    if (path === '/api/saved') return json({ items: [] });
    if (path === '/api/integrations')
      return json({ ai: true, hotels: true, flights: true, activities: false, mode: 'live' });
    if (path === '/api/studio/agency') return json({ agency: defaultStudioAgency() });
    if (path === '/api/studio/clients') return json({ clients: [] });
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'GET')
      return json({ workspace });
    if (method === 'POST') writes.push({ path, body: route.request().postDataJSON() });
    if (path === `/api/studio/workspaces/${workspace.id}/itinerary`) {
      workspace.itinerary = itinerary();
      workspace.revision++;
      return json({ workspace, nextAction: 'itinerary' });
    }
    if (path === `/api/studio/workspaces/${workspace.id}/review`) {
      if (reviewBehavior === 'change-route') {
        workspace.structureAccepted = false;
        workspace.itinerary = null;
        workspace.stops[0].nights = 4;
      } else {
        workspace.itinerary!.days[1].title = 'A quieter second day';
      }
      workspace.messages.push(
        {
          id: 'user-change',
          role: 'user',
          content: route.request().postDataJSON().message,
          createdAt: now,
        },
        {
          id: 'assistant-change',
          role: 'assistant',
          content: 'I adjusted the second day to allow more rest.',
          createdAt: now,
        },
      );
      workspace.revision++;
      return json({ workspace, nextAction: 'itinerary' });
    }
    await route.fulfill({ status: 500, json: { error: `Unexpected request ${method} ${path}` } });
  });
  return writes;
}

test('accepted route generates daily activities and chat refinements return to the itinerary', async ({
  page,
}) => {
  const workspace = fixture();
  const writes = await mockWorkspace(page, workspace);
  await page.goto(`/studio/${workspace.id}`);
  await expect(page.getByRole('tab', { name: 'Itinerary', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page
    .getByLabel('Itinerary instructions · optional')
    .fill('A relaxed pace with time to rest.');
  await page.getByRole('button', { name: 'Build day-by-day itinerary', exact: true }).click();
  const plan = page.getByRole('region', { name: 'Day-by-day itinerary', exact: true });
  await expect(plan.getByRole('heading', { name: 'London day 4', exact: true })).toBeVisible();
  await expect(plan.getByRole('link', { name: 'Official visitor guide' })).toHaveCount(4);
  expect(writes[0]).toMatchObject({
    path: `/api/studio/workspaces/${workspace.id}/itinerary`,
    body: { revision: 1, instructions: 'A relaxed pace with time to rest.' },
  });
  expect(writes[0].body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Refine in chat', exact: true }).click();
  const composer = page
    .getByRole('region', { name: 'Import client information' })
    .getByRole('textbox');
  await expect(composer).toHaveValue('Refine the day-by-day itinerary: ');
  await page.getByRole('tab', { name: 'Services', exact: true }).click();
  await composer.fill('Make day 2 quieter with more rest.');
  await page.getByRole('button', { name: 'Review brief', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Itinerary', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    plan.getByRole('heading', { name: 'A quieter second day', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Review proposal', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Proposal', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(writes.map(({ path }) => path)).toEqual([
    `/api/studio/workspaces/${workspace.id}/itinerary`,
    `/api/studio/workspaces/${workspace.id}/review`,
  ]);
});

test('the daily plan waits for each destination stay length', async ({ page }) => {
  const workspace = fixture();
  workspace.stops[0].nights = null;
  const writes = await mockWorkspace(page, workspace);
  await page.goto(`/studio/${workspace.id}`);
  await expect(
    page.getByRole('button', { name: 'Build day-by-day itinerary', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Day-by-day itinerary' })).toContainText(
    'Set the number of nights in every destination',
  );
  expect(writes).toEqual([]);
});

test('fixed arrival gaps count toward the daily itinerary limit', async ({ page }) => {
  const workspace = fixture();
  workspace.brief.startDate = '2027-06-01';
  workspace.stops.push({
    ...workspace.stops[0],
    id: 'bath-stop',
    name: 'Bath',
    nights: 1,
    arrivalFixed: true,
    arrivalDate: '2027-07-05',
    departureDate: '2027-07-06',
  });
  const writes = await mockWorkspace(page, workspace);
  await page.goto(`/studio/${workspace.id}`);
  await expect(
    page.getByRole('button', { name: 'Build day-by-day itinerary', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Day-by-day itinerary' })).toContainText(
    'Generate an itinerary of up to 35 days',
  );
  expect(writes).toEqual([]);
});

test('a chat route change returns an open itinerary to structure approval', async ({ page }) => {
  const workspace = fixture();
  workspace.itinerary = itinerary();
  await mockWorkspace(page, workspace, 'change-route');
  await page.goto(`/studio/${workspace.id}`);
  await expect(page.getByRole('tab', { name: 'Itinerary', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const composer = page
    .getByRole('region', { name: 'Import client information' })
    .getByRole('textbox');
  await composer.fill('Make London four nights.');
  await page.getByRole('button', { name: 'Review brief', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Structure', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: 'Itinerary', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Day-by-day itinerary' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Accept structure', exact: true })).toBeVisible();
});

test('the client proposal displays the saved daily itinerary and source links on mobile', async ({
  page,
}) => {
  const workspace = fixture();
  const proposal: StudioClientProposal = {
    version: 1,
    title: workspace.title,
    clientName: '',
    publishedAt: now,
    validUntil: '2099-06-01T00:00:00.000Z',
    revision: 2,
    agency: { ...defaultStudioAgency(), slug: 'synthetic' },
    trip: { startDate: '2027-06-01', endDate: '2027-06-04', adults: 2, children: 0 },
    stops: workspace.stops,
    items: [],
    recommendations: [],
    itinerary: itinerary(),
    pricing: { ...workspace.pricing, totals: [], unpricedCount: 0, sandboxCount: 0 },
    notice: 'A synthetic test proposal.',
  };
  await page.route('**/api/studio/proposals/synthetic-itinerary', (route) =>
    route.fulfill({ json: { proposal } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/proposal/synthetic-itinerary');
  const publicDocument = page.getByTestId('client-proposal');
  await expect(
    publicDocument.getByRole('heading', { name: 'Your day-by-day itinerary', exact: true }),
  ).toBeVisible();
  await expect(
    publicDocument.getByRole('heading', { name: 'London day 4', exact: true }),
  ).toBeVisible();
  await expect(publicDocument.getByRole('link', { name: 'Official visitor guide' })).toHaveCount(4);
  await expect(publicDocument).toContainText('Check opening times before travelling.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
