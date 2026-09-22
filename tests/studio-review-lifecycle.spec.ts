import { test, expect, type Page, type Route } from '@playwright/test';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import { defaultStudioAgency, type StudioWorkspace } from '../shared/studio';
import { newStudioWorkspace } from '../server/studio-store';

function workspace(title: string) {
  const value = newStudioWorkspace();
  value.title = title;
  value.brief.clientName = 'Fictional lifecycle client';
  return value;
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
const composer = (page: Page) =>
  page.getByRole('region', { name: 'Import client information' }).getByRole('textbox');
async function bootstrap(
  page: Page,
  workspaces: StudioWorkspace[],
  studio: (route: Route, path: string, method: string) => Promise<boolean>,
) {
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
    if (await studio(route, path, method)) return;
    if (path === '/api/studio/agency') return json({ agency: defaultStudioAgency() });
    if (path === '/api/studio/clients')
      return json({
        clients: [
          {
            name: workspaces[0].brief.clientName,
            context: '',
            previousWorkspaces: workspaces.map(({ id, title, updatedAt }) => ({
              id,
              title,
              updatedAt,
            })),
          },
        ],
      });
    const current = workspaces.find((item) => path === `/api/studio/workspaces/${item.id}`);
    if (current && method === 'GET') return json({ workspace: current });
    await route.fulfill({ status: 500, json: { error: `Unexpected request: ${method} ${path}` } });
  });
}
function completeReview(current: StudioWorkspace, content: string) {
  current.revision++;
  current.messages.push(
    { id: crypto.randomUUID(), role: 'user', content, createdAt: current.updatedAt },
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: `Review completed for ${current.title}.`,
      createdAt: current.updatedAt,
    },
  );
  return { workspace: current };
}
async function openOtherProposal(page: Page, title: string) {
  await page.getByText('Background', { exact: true }).click();
  await page.getByRole('link', { name: title, exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('a pending review in a previous proposal does not block or unlock the current review', async ({
  page,
}) => {
  const first = workspace('First synthetic proposal');
  const second = workspace('Second synthetic proposal');
  const firstGate = gate();
  const secondGate = gate();
  const reviews: string[] = [];
  await bootstrap(page, [first, second], async (route, path, method) => {
    const current = [first, second].find(
      (item) => path === `/api/studio/workspaces/${item.id}/review`,
    );
    if (!current || method !== 'POST') return false;
    reviews.push(current.id);
    await (current === first ? firstGate.promise : secondGate.promise);
    await route.fulfill({
      json: completeReview(current, route.request().postDataJSON().message),
    });
    return true;
  });
  try {
    await page.goto(`/studio/${first.id}`);
    await composer(page).fill('to london');
    await page.getByRole('button', { name: 'Review brief', exact: true }).click();
    await expect.poll(() => reviews).toEqual([first.id]);
    await openOtherProposal(page, second.title);
    await expect(page.getByRole('log')).not.toContainText('to london');
    await composer(page).fill('Paris for 3 nights');
    await page.getByRole('button', { name: 'Review brief', exact: true }).click();
    await expect.poll(() => reviews).toEqual([first.id, second.id]);
    const oldResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/studio/workspaces/${first.id}/review`,
    );
    firstGate.release();
    await oldResponse;
    await expect(page.getByRole('heading', { name: second.title, exact: true })).toBeVisible();
    await expect(composer(page)).toBeDisabled();
    await expect(page.getByRole('log')).toContainText('Paris for 3 nights');
    await expect(page.getByRole('log')).not.toContainText(`Review completed for ${first.title}`);
    secondGate.release();
    await expect(page.getByRole('log')).toContainText(`Review completed for ${second.title}`);
    await expect(composer(page)).toBeEnabled();
    expect(reviews).toEqual([first.id, second.id]);
  } finally {
    firstGate.release();
    secondGate.release();
  }
});

test('a delayed conflict recovery cannot replace the proposal opened afterwards', async ({
  page,
}) => {
  const first = workspace('Conflicted synthetic proposal');
  const second = workspace('Current synthetic proposal');
  const recovery = gate();
  const recoveryStarted = gate();
  let recovering = false;
  await bootstrap(page, [first, second], async (route, path, method) => {
    if (path === `/api/studio/workspaces/${first.id}` && method === 'GET' && recovering) {
      recoveryStarted.release();
      await recovery.promise;
      await route.fulfill({ json: { workspace: first } });
      return true;
    }
    if (path === `/api/studio/workspaces/${first.id}/review`) {
      recovering = true;
      await route.fulfill({ status: 409, json: { error: 'This proposal was updated elsewhere.' } });
      return true;
    }
    if (path === `/api/studio/workspaces/${second.id}/review`) {
      await route.fulfill({
        json: completeReview(second, route.request().postDataJSON().message),
      });
      return true;
    }
    return false;
  });
  try {
    await page.goto(`/studio/${first.id}`);
    await composer(page).fill('to london');
    await page.getByRole('button', { name: 'Review brief', exact: true }).click();
    await recoveryStarted.promise;
    await openOtherProposal(page, second.title);
    const oldResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/studio/workspaces/${first.id}`,
    );
    recovery.release();
    await oldResponse;
    await composer(page).fill('Paris for 3 nights');
    await page.getByRole('button', { name: 'Review brief', exact: true }).click();
    await expect(page.getByRole('log')).toContainText(`Review completed for ${second.title}`);
    await expect(page.getByRole('heading', { name: second.title, exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(second.messages[0].content).toBe('Paris for 3 nights');
  } finally {
    recovery.release();
  }
});
