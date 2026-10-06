import { expect, test, type Page } from '@playwright/test';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import { defaultStudioAgency } from '../shared/studio';
import type { StudioClientProfile } from '../shared/studio-clients';
import { newStudioWorkspace } from '../server/studio-store';
import { qualifyStudio } from '../server/studio-domain';

const initialClient: StudioClientProfile = {
  id: 'a3000000-0000-4000-8000-000000000001',
  name: 'Fictional Noor',
  country: 'AU',
  nationality: 'CA',
  passportNationality: 'NZ',
  dateOfBirth: '1988-07-12',
  photoDataUrl: '',
  context: 'Quiet journeys.',
  interests: ['Gardens'],
  foodPreferences: ['Vegetarian'],
  history: [
    {
      destination: 'Kyoto',
      country: 'JP',
      experience: 'visited',
      feedback: 'liked',
      notes: 'Quiet gardens.',
    },
  ],
  updatedAt: new Date().toISOString(),
};
async function mockClients(
  page: Page,
  initial = [initialClient],
  options: { signedIn?: boolean } = {},
) {
  let clients = structuredClone(initial);
  let agency = defaultStudioAgency();
  const writes: { path: string; method: string; body: any }[] = [];
  const unexpected: string[] = [];
  let workspace = newStudioWorkspace();
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === '/api/session')
      return json({
        user: options.signedIn
          ? {
              id: 'fictional-agency-owner',
              name: 'Fictional Agency Owner',
              email: 'fictional@example.test',
            }
          : null,
      });
    if (path === '/api/catalog') return json(catalog);
    if (path === '/api/profile') return json({ profile: defaultTravelProfile });
    if (path === '/api/saved') return json({ items: [] });
    if (path === '/api/integrations')
      return json({ ai: false, hotels: false, flights: false, activities: false, mode: 'local' });
    if (path === '/api/studio/agency' && method === 'GET') return json({ agency });
    if (path === '/api/studio/clients') return json({ clients: [] });
    if (path === '/api/studio/client-profiles' && method === 'GET') return json({ clients });
    const historyClient = clients.find(
      (client) => path === `/api/studio/client-profiles/${client.id}/history`,
    );
    if (historyClient) return json({ history: historyClient.history });
    if (path === '/api/studio/workspaces' && method === 'GET') return json({ workspaces: [] });
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'GET')
      return json({ workspace });
    const body = route.request().postDataJSON() || {};
    writes.push({ path, method, body });
    if (path === '/api/studio/agency' && method === 'PATCH') {
      agency = body.agency;
      return json({ agency });
    }
    if (path === '/api/studio/client-profiles' && method === 'POST') {
      const client = {
        ...body,
        id: 'a3000000-0000-4000-8000-000000000002',
        updatedAt: new Date().toISOString(),
      };
      clients = [client, ...clients];
      return json({ client }, 201);
    }
    const existing = clients.find((client) => path === `/api/studio/client-profiles/${client.id}`);
    if (existing && method === 'PATCH') {
      const client = { ...body, id: existing.id, updatedAt: new Date().toISOString() };
      clients = clients.map((item) => (item.id === client.id ? client : item));
      return json({ client });
    }
    if (existing && method === 'DELETE') {
      clients = clients.filter((item) => item.id !== existing.id);
      return route.fulfill({ status: 204, body: '' });
    }
    if (path === '/api/studio/workspaces' && method === 'POST') {
      const client = clients.find((item) => item.id === body.clientId);
      if (!client) return json({ error: 'Client profile not found.' }, 404);
      workspace = newStudioWorkspace();
      workspace.title = body.title || 'New client proposal';
      Object.assign(workspace.brief, {
        clientId: client.id,
        clientName: client.name,
        context: client.context,
        passportNationality: client.passportNationality,
        interests: client.interests,
        foodPreferences: client.foodPreferences,
      });
      workspace.qualification = qualifyStudio(workspace, defaultStudioAgency());
      return json({ workspace, assistantActions: [] }, 201);
    }
    if (path === `/api/studio/workspaces/${workspace.id}/review`) return json({ workspace });
    unexpected.push(`${method} ${path}`);
    return json({ error: 'Unexpected synthetic request' }, 500);
  });
  return { writes, unexpected, clients: () => clients, workspace: () => workspace };
}

test('desktop addressbook saves private identity, preferences and travel feedback through popup editing', async ({
  page,
}) => {
  const mocked = await mockClients(page);
  await page.goto('/clients');
  await expect(page.getByRole('heading', { name: 'Existing clients', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Selected client' })).toContainText('Kyoto');
  await page.getByRole('textbox', { name: 'Search clients', exact: true }).fill('unmatched');
  await expect(page.getByText('No matching clients', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search clients', exact: true }).fill('');
  await page.getByRole('button', { name: 'New client', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New client', exact: true });
  await dialog.getByLabel('Client name', { exact: true }).fill('Fictional Addressbook Customer');
  await dialog.getByLabel('Country of residence', { exact: true }).selectOption('AU');
  await dialog.getByLabel('Nationality', { exact: true }).selectOption('CA');
  await dialog.getByLabel('Passport nationality', { exact: true }).selectOption('NZ');
  await dialog.getByLabel('Date of birth', { exact: true }).fill('1988-07-12');
  await dialog.getByLabel('Client photo', { exact: true }).setInputFiles({
    name: 'synthetic-client.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(dialog.getByRole('img', { name: 'Client photo preview' })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Preferences', exact: true }).click();
  await dialog.getByLabel('Interests', { exact: true }).fill('Gardens, galleries');
  await dialog.getByLabel('Food preferences', { exact: true }).fill('Vegetarian');
  await dialog.getByRole('tab', { name: 'Travel history', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add past trip', exact: true }).click();
  await dialog.getByLabel('Past trip 1 destination', { exact: true }).fill('Kyoto');
  await dialog.getByLabel('Past trip 1 country', { exact: true }).selectOption('JP');
  await dialog.getByLabel('Past trip 1 feedback', { exact: true }).selectOption('liked');
  await dialog
    .getByLabel('Past trip 1 notes', { exact: true })
    .fill('Quiet gardens and galleries.');
  await dialog.getByRole('button', { name: 'Save client', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const saved = mocked
    .clients()
    .find((client) => client.name === 'Fictional Addressbook Customer')!;
  expect(saved.photoDataUrl).toMatch(/^data:image\/jpeg;base64,/);
  expect(saved).toMatchObject({
    country: 'AU',
    nationality: 'CA',
    passportNationality: 'NZ',
    dateOfBirth: '1988-07-12',
    interests: ['Gardens', 'galleries'],
    history: [{ destination: 'Kyoto', feedback: 'liked' }],
  });
  await page.getByRole('button', { name: 'Edit client', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit client', exact: true });
  await expect(edit.getByLabel('Date of birth', { exact: true })).toHaveValue('1988-07-12');
  await edit.getByLabel('Country of residence', { exact: true }).selectOption('GB');
  await edit.getByRole('button', { name: 'Save client', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected client' })).toContainText(
    'United Kingdom',
  );
  await page.screenshot({ path: '/private/tmp/asktara-addressbook-desktop.png', fullPage: true });
  expect(mocked.unexpected).toEqual([]);
});

test('agency branding processes a logo inside production image policy and preserves it after saving and reload', async ({
  page,
}) => {
  const mocked = await mockClients(page, [initialClient], { signedIn: true });
  await page.goto('/settings/agency');
  await page
    .getByRole('textbox', { name: 'Agency name', exact: true })
    .fill('Fictional Garden Journeys');
  await page.getByLabel('Agency logo · PNG or JPEG', { exact: true }).setInputFiles({
    name: 'synthetic-agency-logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  const preview = page.getByRole('img', { name: 'Agency logo preview', exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await page.getByRole('button', { name: 'Save agency settings', exact: true }).click();
  await expect(page.getByText('Agency settings saved.', { exact: true })).toBeVisible();
  const saved = mocked.writes.find((write) => write.path === '/api/studio/agency')!.body.agency;
  expect(saved.name).toBe('Fictional Garden Journeys');
  expect(saved.logoDataUrl).toMatch(/^data:image\/jpeg;base64,/);
  await page.reload();
  await expect(preview).toHaveAttribute('src', saved.logoDataUrl);
  expect(mocked.unexpected).toEqual([]);
});

test('deleting a client requires confirmation and removes its private record from the addressbook', async ({
  page,
}) => {
  const mocked = await mockClients(page);
  await page.goto('/clients');
  await page.getByRole('button', { name: 'Delete client', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Existing proposals remain available');
  expect(mocked.writes).toEqual([]);
  await confirm.getByRole('button', { name: 'Delete client', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Start with someone you know', exact: true }),
  ).toBeVisible();
  expect(mocked.clients()).toEqual([]);
  expect(mocked.writes.map(({ method }) => method)).toEqual(['DELETE']);
});

test('sidebar creation chooses a client before any proposal write and creates a fresh trip without private identity', async ({
  page,
}) => {
  const mocked = await mockClients(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a proposal', exact: true }).click();
  expect(mocked.writes).toEqual([]);
  const picker = page.getByRole('dialog', { name: 'Who is this proposal for?', exact: true });
  await picker.getByRole('button', { name: /^Fictional Noor/ }).click();
  await picker.getByRole('button', { name: 'Start proposal', exact: true }).click();
  await expect(page).toHaveURL(/\/studio\//);
  const creation = mocked.writes.find((write) => write.path === '/api/studio/workspaces')!;
  expect(creation.body).toEqual({
    clientId: initialClient.id,
    title: 'Fictional Noor — new proposal',
  });
  expect(mocked.workspace().brief).toMatchObject({
    clientId: initialClient.id,
    clientName: 'Fictional Noor',
    adults: null,
    children: null,
    childAges: [],
    startDate: '',
    endDate: '',
    passportNationality: 'NZ',
  });
  expect(JSON.stringify(mocked.workspace().brief)).not.toContain('1988-07-12');
  expect('photoDataUrl' in mocked.workspace().brief).toBe(false);
  expect(mocked.unexpected).toEqual([]);
});

test('home composer retains its typed brief while client selection precedes atomic creation', async ({
  page,
}) => {
  const mocked = await mockClients(page);
  await page.goto('/');
  const message = page.getByRole('textbox', { name: 'Tell Tara about your trip', exact: true });
  await message.fill('A quiet garden holiday in Japan');
  await message.press('Enter');
  expect(mocked.writes).toEqual([]);
  const picker = page.getByRole('dialog', { name: 'Who is this proposal for?', exact: true });
  await picker.getByRole('button', { name: /^Fictional Noor/ }).click();
  await picker.getByRole('button', { name: 'Start proposal', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/${mocked.workspace().id}$`));
  await expect
    .poll(() => mocked.writes.filter((write) => write.path.endsWith('/review')).length)
    .toBe(1);
  expect(mocked.writes.find((write) => write.path.endsWith('/review'))!.body.message).toBe(
    'A quiet garden holiday in Japan',
  );
  expect(mocked.writes.find((write) => write.path === '/api/studio/workspaces')!.body).toEqual({
    clientId: initialClient.id,
  });
  expect(mocked.unexpected).toEqual([]);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Interactive itinerary' })).toBeVisible();
  expect(mocked.writes.filter((write) => write.path.endsWith('/review'))).toHaveLength(1);
});
