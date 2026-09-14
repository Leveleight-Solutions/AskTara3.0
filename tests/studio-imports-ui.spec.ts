import { test, expect, type Page } from '@playwright/test';
import { newStudioWorkspace } from '../server/studio-store';
import { defaultStudioAgency, type StudioImport } from '../shared/studio';
import { catalog } from '../shared/catalog';

async function mockStudioImports(page: Page, accepted = false) {
  const workspace = newStudioWorkspace();
  workspace.structureAccepted = accepted;
  const previews: Record<string, unknown>[] = [];
  const saves: Record<string, unknown>[] = [];
  const arrangements: Record<string, unknown>[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/api/session') return json({ user: null });
    if (path === '/api/config') return json({});
    if (path === '/api/catalog') return json(catalog);
    if (path === '/api/profile') return json({ profile: null });
    if (path === '/api/saved') return json({ items: [] });
    if (path === '/api/trips') return json({ trips: [] });
    if (path === '/api/integrations')
      return json({ ai: true, flights: false, hotels: false, activities: false, mode: 'live' });
    if (path === '/api/studio/agency') return json({ agency: defaultStudioAgency() });
    if (path === '/api/studio/clients') return json({ clients: [] });
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'GET')
      return json({ workspace });
    if (path === '/api/studio/import/preview') {
      const body = route.request().postDataJSON();
      previews.push(body);
      return json({
        import: {
          id: '11111111-0000-4000-8000-000000000001',
          kind: body.kind,
          name: body.name,
          text: body.text || 'Paris 3 nights; year unclear.',
          sourceUrl: body.url || '',
          createdAt: new Date().toISOString(),
          warnings: ['Review the source before use.'],
        },
      });
    }
    if (path === `/api/studio/workspaces/${workspace.id}/import`) {
      const body = route.request().postDataJSON();
      saves.push(body);
      const source: StudioImport = {
        id: '11111111-0000-4000-8000-000000000001',
        kind: body.kind,
        name: body.name,
        text: body.text,
        sourceUrl: body.sourceUrl || '',
        warnings: [],
        createdAt: new Date().toISOString(),
      };
      workspace.imports.push(source);
      workspace.revision++;
      return json({ workspace, import: source });
    }
    if (
      path ===
      `/api/studio/workspaces/${workspace.id}/imports/11111111-0000-4000-8000-000000000001/extract`
    ) {
      arrangements.push(route.request().postDataJSON());
      workspace.revision++;
      return json({ workspace });
    }
    return json({ error: `Unexpected mock request ${method} ${path}` }, 500);
  });
  await page.goto(`/studio/${workspace.id}`);
  await expect(page.getByRole('region', { name: 'Import client information' })).toBeVisible();
  return { workspace, previews, saves, arrangements };
}

test('pasted email or PNR is editable before private save and never auto-extracts arrangements', async ({
  page,
}) => {
  const { workspace, previews, saves, arrangements } = await mockStudioImports(page);
  await page.getByRole('button', { name: 'Paste email / PNR' }).click();
  await page
    .getByLabel('Client email, PNR or travel notes')
    .fill('PNR ABC123\nParis 3 nights, year to confirm.');
  await page.getByRole('button', { name: 'Preview source' }).click();
  await expect(page.getByText('Check the extracted text')).toBeVisible();
  expect(previews).toHaveLength(1);
  expect(saves).toHaveLength(0);
  await page
    .getByRole('textbox', { name: 'Review and edit', exact: true })
    .fill('Paris 3 nights, 18 November 2026.');
  await page.getByRole('button', { name: 'Save reviewed source' }).click();
  await expect(page.getByText('Source saved privately.', { exact: false })).toBeVisible();
  expect(saves).toHaveLength(1);
  expect(saves[0].text).toBe('Paris 3 nights, 18 November 2026.');
  expect(saves[0].data).toBeUndefined();
  expect(workspace.stops).toHaveLength(0);
  expect(arrangements).toHaveLength(0);
  await page.getByText('Client notes / PNR', { exact: false }).click();
  await expect(
    page.getByText('Accept the trip structure before extracting arrangement candidates.'),
  ).toBeVisible();
});

test('screenshot extraction keeps a review gate and extracts candidates only on explicit request', async ({
  page,
}) => {
  const { previews, saves, arrangements } = await mockStudioImports(page, true);
  await page.getByLabel('Upload screenshot, PDF or audio').setInputFiles({
    name: 'fictional-pnr.png',
    mimeType: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a00000000', 'hex'),
  });
  await expect(page.getByText('Check the extracted text')).toBeVisible();
  expect(previews[0].kind).toBe('image');
  expect(String(previews[0].data)).toMatch(/^data:image\/png;base64,/);
  expect(saves).toHaveLength(0);
  await page
    .getByRole('textbox', { name: 'Review and edit', exact: true })
    .fill('Fictional flight SYD-LHR on 18 November 2026, booking status to check.');
  await page.getByRole('button', { name: 'Save reviewed source' }).click();
  await expect(page.getByText('Source saved privately.', { exact: false })).toBeVisible();
  expect(saves[0].kind).toBe('image');
  expect(saves[0].data).toBeUndefined();
  expect(arrangements).toHaveLength(0);
  await page.getByText('fictional-pnr.png', { exact: false }).click();
  await page.getByRole('button', { name: 'Extract arrangements', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Candidates added for review' })).toBeDisabled();
  expect(arrangements).toHaveLength(1);
  expect(arrangements[0].requestId).toMatch(/^[a-f0-9-]{36}$/);
});

test('microphone denial leaves the typed brief available and sends no audio', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
      },
    });
  });
  const { previews, saves } = await mockStudioImports(page);
  await page.getByRole('button', { name: 'Dictate', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Microphone access was not available');
  await expect(page.getByRole('button', { name: 'Paste email / PNR' })).toBeEnabled();
  expect(previews).toHaveLength(0);
  expect(saves).toHaveLength(0);
});
