import { test, expect, type Page } from '@playwright/test';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import {
  defaultStudioAgency,
  type StudioClient,
  type StudioItem,
  type StudioStop,
  type StudioWorkspace,
} from '../shared/studio';
import { choose } from './ui-helpers';

const workspaceId = '60000000-0000-4000-8000-000000000001';
const now = '2026-09-14T12:00:00Z';
function stops(): StudioStop[] {
  return [
    {
      id: '60000000-0000-4000-8000-000000000002',
      name: 'Paris',
      country: 'France',
      nights: 3,
      arrivalDate: '2027-06-01',
      departureDate: '2027-06-04',
      arrivalFixed: false,
      onwardTransport: 'train',
      neighbourhood: 'Near Gare du Nord',
      notes: '',
    },
    {
      id: '60000000-0000-4000-8000-000000000003',
      name: 'Amsterdam',
      country: 'Netherlands',
      nights: 3,
      arrivalDate: '2027-06-04',
      departureDate: '2027-06-07',
      arrivalFixed: false,
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
}
function fixtureWorkspace(accepted = false): StudioWorkspace {
  return {
    id: workspaceId,
    revision: 1,
    title: 'Hendersons in Europe',
    stage: accepted ? 'services' : 'brief',
    brief: {
      clientName: 'Henderson',
      context: 'They enjoyed a previous architecture trip.',
      request: accepted ? 'Paris and Amsterdam, 6 nights from June 1, 2027.' : '',
      startDate: '2027-06-01',
      endDate: '',
      datesFlexible: false,
      adults: 2,
      children: 0,
      childAges: [],
      budget: null,
      currency: 'AUD',
      origin: 'Sydney',
      hotelStandard: 'Boutique four star',
      hotelLocation: 'Near railway stations',
      cabin: 'Business',
      interests: ['Architecture'],
      requirements: [],
      output: 'structure',
    },
    qualification: {
      score: 55,
      known: [
        { id: 'adults', label: 'Adults', value: '2' },
        { id: 'dates', label: 'Start date', value: '1 June 2027' },
      ],
      questions: [
        {
          id: 'return',
          label: 'When do they need to return?',
          reason: 'Keep the length of the route aligned.',
          required: false,
        },
      ],
      skipped: false,
    },
    stops: accepted ? stops() : [],
    structureAccepted: accepted,
    items: [],
    recommendations: [],
    imports: [],
    messages: [],
    pricing: { mode: 'itemised', packagePrice: null, currency: 'AUD', notes: '', marginPercent: 0 },
    proposal: null,
    createdAt: now,
    updatedAt: now,
  };
}
async function mockStudio(
  page: Page,
  workspace: StudioWorkspace,
  options: { failPatch?: boolean; clients?: StudioClient[] } = {},
) {
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const unexpected: string[] = [];
  let agency = defaultStudioAgency();
  const quote: StudioItem = {
    id: '60000000-0000-4000-8000-000000000010',
    kind: 'hotel',
    title: 'Example station hotel',
    description: 'Three nights in a double room.',
    stopId: stops()[0].id,
    startDate: '2027-06-01',
    endDate: '2027-06-04',
    status: 'suggested',
    source: 'liteapi',
    sourceUrl: '',
    supplier: 'LiteAPI',
    privateReference: '',
    price: 900,
    currency: 'AUD',
    priceStatus: 'sandbox',
    quotedAt: now,
    included: true,
    needsReview: false,
    cost: null,
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    const body = method === 'GET' ? {} : route.request().postDataJSON() || {};
    const json = (value: unknown, status = 200) => route.fulfill({ status, json: value });
    if (path === '/api/session') return json({ user: null });
    if (path === '/api/catalog') return json(catalog);
    if (path === '/api/profile') return json({ profile: defaultTravelProfile });
    if (path === '/api/saved') return json({ items: [] });
    if (path === '/api/integrations')
      return json({ ai: true, flights: true, hotels: true, activities: false, mode: 'live' });
    if (!path.startsWith('/api/studio/')) {
      unexpected.push(`${method} ${path}`);
      return json({ error: 'Unexpected legacy or supplier mutation' }, 500);
    }
    requests.push({ method, path, body });
    if (path === '/api/studio/agency') {
      if (method === 'PATCH') agency = { ...agency, ...body.agency };
      return json({ agency });
    }
    if (path === '/api/studio/clients') return json({ clients: options.clients || [] });
    if (path === '/api/studio/workspaces')
      return method === 'POST' ? json({ workspace }, 201) : json({ workspaces: [workspace] });
    if (path === `/api/studio/workspaces/${workspaceId}`) {
      if (method === 'GET') return json({ workspace });
      if (method === 'PATCH') {
        if (options.failPatch)
          return json({ error: 'The workspace could not be saved. Please try again.' }, 503);
        expect(body.revision).toBe(workspace.revision);
        if (body.brief) workspace.brief = { ...workspace.brief, ...body.brief };
        for (const field of ['stops', 'items', 'recommendations', 'pricing', 'title'] as const)
          if (field in body) (workspace as unknown as Record<string, unknown>)[field] = body[field];
        if (body.stops) {
          workspace.structureAccepted = false;
          workspace.stage = 'structure';
        }
        workspace.revision++;
        return json({ workspace });
      }
    }
    if (path === `/api/studio/workspaces/${workspaceId}/review`) {
      expect(body.revision).toBe(workspace.revision);
      workspace.brief.request = String(body.message);
      if (!workspace.stops.length) workspace.stops = stops();
      workspace.messages.push(
        { id: crypto.randomUUID(), role: 'user', content: String(body.message), createdAt: now },
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            'I have the starting point. Confirm the return date, or we can sketch the route with that still open.',
          createdAt: now,
        },
      );
      workspace.revision++;
      return json({ workspace });
    }
    if (path === `/api/studio/workspaces/${workspaceId}/structure`) {
      workspace.stops = stops();
      workspace.stage = 'structure';
      workspace.qualification.skipped = body.skipQualification === true;
      workspace.revision++;
      return json({ workspace });
    }
    if (path === `/api/studio/workspaces/${workspaceId}/accept-structure`) {
      workspace.structureAccepted = true;
      workspace.stage = 'services';
      workspace.revision++;
      return json({ workspace });
    }
    if (path.endsWith('/hotels/search') || path.endsWith('/flights/search'))
      return json({
        quotes: [{ ...quote, kind: path.endsWith('/flights/search') ? 'flight' : 'hotel' }],
        mode: 'sandbox',
        warning: 'Sandbox quotes are simulated examples.',
      });
    if (path === `/api/studio/workspaces/${workspaceId}/quotes/${quote.id}`) {
      workspace.items.push(quote);
      workspace.revision++;
      return json({ workspace });
    }
    if (path === `/api/studio/workspaces/${workspaceId}/recommendations`) {
      workspace.recommendations = [
        {
          id: crypto.randomUUID(),
          stopId: String((body.stopIds as string[])[0]),
          name: 'Example vegetarian café',
          category: 'food',
          description: 'A relaxed lunch option. Dietary requests should be checked directly.',
          sources: [
            { label: 'Official café website', url: 'https://example.com/cafe', checkedAt: now },
          ],
          included: false,
        },
      ];
      workspace.stage = 'recommendations';
      workspace.revision++;
      return json({ workspace });
    }
    unexpected.push(`${method} ${path}`);
    return json({ error: 'Unexpected Studio request' }, 500);
  });
  return { requests, unexpected };
}

test('Studio starts with brief review and explicit structure acceptance before services', async ({
  page,
}) => {
  const workspace = fixtureWorkspace();
  const mocked = await mockStudio(page, workspace);
  // The composer that starts a workspace is the home hero now, not a /studio landing form.
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Tell Tara about your trip' })
    .fill('Plan a simple Paris and Amsterdam route for the Hendersons.');
  await page.getByRole('button', { name: 'Start planning your trip' }).click();
  await expect(page).toHaveURL(`/studio/${workspaceId}`);
  await expect(page.getByRole('region', { name: 'Brief review' })).toContainText(
    'When do they need to return?',
  );
  await expect(page.getByRole('tab', { name: 'Services', exact: true })).toBeDisabled();
  expect(mocked.requests.filter((r) => r.path.endsWith('/review'))).toHaveLength(1);
  expect(mocked.requests.some((r) => /structure|search|recommendations/.test(r.path))).toBe(false);
  await page.getByRole('button', { name: 'Skip questions and build structure' }).click();
  await expect(page.getByLabel('Destination 1', { exact: true })).toHaveValue('Paris');
  await page.getByRole('button', { name: 'Increase nights in Paris' }).click();
  await expect(page.getByLabel('Arrival in Amsterdam', { exact: true })).toHaveValue('2027-06-05');
  await expect(page.getByRole('button', { name: 'Accept structure', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send to Tara' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save route changes' }).click();
  await page.getByRole('button', { name: 'Accept structure', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What would you like help with?' })).toBeVisible();
  expect(workspace.structureAccepted).toBe(true);
  expect(
    mocked.requests.filter((r) => r.path.endsWith('/structure'))[0].body.skipQualification,
  ).toBe(true);
  expect(mocked.requests.some((r) => /search|recommendations/.test(r.path))).toBe(false);
  await page.reload();
  await page.getByRole('tab', { name: 'Structure', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Nights in Paris', exact: true })).toHaveValue(
    '4',
  );
  expect(mocked.unexpected).toEqual([]);
});

test('route reorder adjusts dates while explicitly fixed arrivals remain pinned on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const workspace = fixtureWorkspace();
  workspace.brief.request = 'Sketch the route';
  workspace.stops = stops();
  workspace.stage = 'structure';
  const mocked = await mockStudio(page, workspace);
  await page.goto(`/studio/${workspaceId}`);
  // Below the md breakpoint the workspace shows one pane at a time and opens on the
  // conversation, so the canvas has to be asked for before its controls exist.
  await expect(page.getByRole('tab', { name: 'Chat with Tara' })).toBeVisible();
  await page.getByRole('tab', { name: 'Working canvas' }).click();
  await page.getByRole('button', { name: 'Move Amsterdam up' }).click();
  await expect(page.getByLabel('Destination 1', { exact: true })).toHaveValue('Amsterdam');
  await expect(page.getByLabel('Arrival in Amsterdam', { exact: true })).toHaveValue('2027-06-01');
  await page.getByLabel('Arrival in Paris', { exact: true }).fill('2027-06-10');
  await expect(page.getByLabel('Keep arrival in Paris fixed')).toBeChecked();
  await page.getByRole('button', { name: 'Increase nights in Amsterdam' }).click();
  await expect(page.getByLabel('Arrival in Paris', { exact: true })).toHaveValue('2027-06-10');
  await page.getByRole('button', { name: 'Save route changes' }).click();
  await expect(page.getByRole('button', { name: 'Accept structure', exact: true })).toBeEnabled();
  expect(workspace.stops[1].arrivalFixed).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '/tmp/asktara-studio-mobile.png', fullPage: true });
  expect(mocked.unexpected).toEqual([]);
});

test('manual insurance estimate is reviewed and added without a booking request', async ({
  page,
}) => {
  const workspace = fixtureWorkspace(true);
  const mocked = await mockStudio(page, workspace);
  await page.goto(`/studio/${workspaceId}`);
  await page.getByRole('button', { name: 'Add a service', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a service to the proposal' });
  await choose(page, dialog.getByRole('combobox', { name: 'Service type' }), 'Insurance');
  await dialog.getByLabel('Service name').fill('Agent insurance estimate');
  await dialog.getByLabel('Client price', { exact: true }).fill('350');
  await dialog.getByLabel('Internal cost · private').fill('280');
  await dialog.getByLabel('Booking reference · private').fill('PRIVATE-REF');
  await expect(dialog).toContainText('no policy is issued here');
  await dialog.getByRole('button', { name: 'Save service' }).click();
  await expect(dialog).not.toBeVisible();
  const services = page.getByRole('region', { name: 'Proposal services', exact: true });
  await expect(services).toBeVisible();
  await expect(services).toContainText('Agent insurance estimate');
  expect(workspace.items[0]).toMatchObject({
    kind: 'insurance',
    price: 350,
    currency: 'AUD',
    cost: 280,
    priceStatus: 'agent_estimate',
    status: 'suggested',
    needsReview: false,
  });
  expect(mocked.requests.filter((r) => r.method !== 'GET').map((r) => r.path)).toEqual([
    `/api/studio/workspaces/${workspaceId}`,
  ]);
  expect(mocked.unexpected).toEqual([]);
});

test('hotel quote search asks nationality and adds an explicit quote without reservation', async ({
  page,
}) => {
  const workspace = fixtureWorkspace(true);
  const mocked = await mockStudio(page, workspace);
  await page.goto(`/studio/${workspaceId}`);
  await page.getByText('Find hotel or flight suggestions', { exact: true }).click();
  const nationality = page.getByLabel('Guest nationality · two-letter code');
  await expect(nationality).toHaveValue('');
  await nationality.fill('AU');
  await page.getByRole('button', { name: 'Search hotels quotes' }).click();
  await expect(
    page.getByText('Sandbox quotes are simulated examples.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Example station hotel' })).toBeVisible();
  expect(workspace.items).toHaveLength(0);
  await page.getByRole('button', { name: 'Add quote to proposal' }).click();
  await expect(page.getByRole('region', { name: 'Proposal services', exact: true })).toContainText(
    'Example station hotel',
  );
  const search = mocked.requests.find((r) => r.path.endsWith('/hotels/search'))!;
  expect(search.body).toEqual({ revision: 1, stopId: stops()[0].id, guestNationality: 'AU' });
  expect(workspace.items).toHaveLength(1);
  expect(mocked.unexpected).toEqual([]);
});

test('family supplier quotes remain blocked until a supported confirmed party is provided', async ({
  page,
}) => {
  const workspace = fixtureWorkspace(true);
  workspace.brief.children = 2;
  workspace.brief.childAges = [6, 10];
  const mocked = await mockStudio(page, workspace);
  await page.goto(`/studio/${workspaceId}`);
  await page.getByText('Find hotel or flight suggestions', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Search hotels quotes' })).toBeDisabled();
  await choose(page, page.getByRole('combobox', { name: 'Search for', exact: true }), 'Flights');
  await expect(page.getByRole('button', { name: 'Search flights quotes' })).toBeDisabled();
  await expect(page.getByLabel('Flight departure date')).toHaveValue('');
  await expect(page.getByLabel('Return date · optional')).toHaveValue('');
  expect(mocked.requests.some((r) => r.path.endsWith('/search'))).toBe(false);
});

test('recommendations are opt-in for selected destinations and never impose a daily schedule', async ({
  page,
}) => {
  const workspace = fixtureWorkspace(true);
  const mocked = await mockStudio(page, workspace);
  await page.goto(`/studio/${workspaceId}`);
  await page.getByRole('tab', { name: 'Recommendations', exact: true }).click();
  expect(mocked.requests.some((r) => r.path.endsWith('/recommendations'))).toBe(false);
  await page.getByRole('checkbox', { name: 'Amsterdam', exact: true }).uncheck();
  await choose(page, page.getByRole('combobox', { name: 'Recommendation type' }), 'Places to eat');
  await page.getByLabel('What would suit this client?').fill('Vegetarian, quiet, local food');
  await page.getByRole('button', { name: 'Research recommendations' }).click();
  await expect(page.getByRole('link', { name: 'Official café website' })).toHaveAttribute(
    'href',
    'https://example.com/cafe',
  );
  expect(mocked.requests.find((r) => r.path.endsWith('/recommendations'))?.body).toMatchObject({
    category: 'food',
    stopIds: [stops()[0].id],
    interests: 'Vegetarian, quiet, local food',
  });
  const recommendations = page.getByRole('region', {
    name: 'Recommendations',
    exact: true,
  });
  await expect(recommendations).toBeVisible();
  await expect(recommendations).not.toContainText('Morning');
  const inclusion = page.getByRole('checkbox', {
    name: 'Include Example vegetarian café in client proposal',
    exact: true,
  });
  await expect(page.getByRole('status')).toContainText('Ready to review');
  await expect(inclusion).not.toBeChecked();
  expect(workspace.recommendations[0].included).toBe(false);
  await inclusion.click();
  await expect(inclusion).toBeChecked();
  expect(workspace.recommendations[0].included).toBe(true);
  await page.screenshot({ path: '/tmp/asktara-studio-desktop.png', fullPage: true });
  expect(mocked.unexpected).toEqual([]);
});

test('client context reuse stays explicit and never restores a past travelling party', async ({
  page,
}) => {
  const workspace = fixtureWorkspace();
  workspace.brief.adults = null;
  workspace.brief.children = null;
  workspace.brief.context = '';
  const mocked = await mockStudio(page, workspace, {
    clients: [
      {
        name: 'Henderson',
        context: 'Past clients prefer architecture and small hotels.',
        previousWorkspaces: [{ id: 'old', title: 'Previous family holiday', updatedAt: now }],
      },
    ],
  });
  await page.goto(`/studio/${workspaceId}`);
  await page.getByRole('button', { name: 'Edit brief details' }).click();
  const dialog = page.getByRole('dialog', { name: 'Client brief' });
  await expect(dialog.getByLabel('Adults', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Children', { exact: true })).toHaveValue('');
  await dialog
    .getByRole('button', { name: 'Use this client’s previous background context' })
    .click();
  await expect(dialog.getByLabel('Adults', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Adults', { exact: true }).fill('2');
  await dialog.getByLabel('Children', { exact: true }).fill('2');
  await dialog.getByLabel('Children’s ages · comma separated').fill('6, 10');
  await dialog.getByRole('button', { name: 'Save brief' }).click();
  await expect(dialog).not.toBeVisible();
  expect(workspace.brief).toMatchObject({
    adults: 2,
    children: 2,
    childAges: [6, 10],
    context: 'Past clients prefer architecture and small hotels.',
  });
  expect(mocked.unexpected).toEqual([]);
});

test('failed service save keeps the entered details available for retry', async ({ page }) => {
  const workspace = fixtureWorkspace(true);
  await mockStudio(page, workspace, { failPatch: true });
  await page.goto(`/studio/${workspaceId}`);
  await page.getByRole('button', { name: 'Add a service', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a service to the proposal' });
  await dialog.getByLabel('Service name').fill('Keep this draft hotel');
  await dialog.getByRole('button', { name: 'Save service' }).click();
  await expect(dialog.getByRole('alert')).toContainText('could not be saved');
  await expect(dialog.getByLabel('Service name')).toHaveValue('Keep this draft hotel');
  await expect(dialog.getByRole('button', { name: 'Save service' })).toBeEnabled();
  expect(workspace.items).toHaveLength(0);
});
