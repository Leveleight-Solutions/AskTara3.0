import { openStudioTool } from './ui-helpers';
import { test, expect, type Page } from '@playwright/test';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import { defaultStudioAgency, type StudioWorkspace } from '../shared/studio';
import { newStudioWorkspace } from '../server/studio-store';
import { fulfilSyntheticTripBriefing } from './studio-trip-briefing-fixture';

function pendingDates() {
  const workspace = newStudioWorkspace();
  workspace.brief.clientName = 'Fictional date clarification client';
  workspace.brief.origin = 'Sydney';
  workspace.brief.departureDate = '2026-10-03';
  workspace.brief.startDate = '2026-10-03';
  workspace.stops = [
    {
      id: crypto.randomUUID(),
      name: 'London',
      country: 'United Kingdom',
      nights: 3,
      arrivalDate: '2026-10-03',
      arrivalFixed: true,
      departureDate: '2026-10-06',
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
  workspace.clarification = {
    kind: 'stay_dates',
    stopId: workspace.stops[0].id,
    arrivalDate: '2026-10-03',
    departureDate: '2026-10-08',
    statedNights: 3,
    proposedNights: 5,
  };
  workspace.messages = [
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '3–8 October is five nights. Shall I use those dates for London?',
      createdAt: workspace.updatedAt,
    },
  ];
  return workspace;
}

async function bootstrap(
  page: Page,
  workspace: StudioWorkspace,
  review: (message: string) => Promise<void>,
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
    if (path === '/api/studio/agency') return json({ agency: defaultStudioAgency() });
    if (path === '/api/studio/clients' || path === '/api/studio/client-profiles')
      return json({ clients: [] });
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'GET')
      return json({ workspace });
    if (await fulfilSyntheticTripBriefing(route, workspace)) return;
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'PATCH') {
      const body = route.request().postDataJSON();
      workspace.brief = { ...workspace.brief, ...body.brief };
      workspace.revision++;
      return json({ workspace });
    }
    if (path === `/api/studio/workspaces/${workspace.id}/review` && method === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.revision).toBe(workspace.revision);
      expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
      await review(body.message);
      return json({ workspace });
    }
    await route.fulfill({ status: 500, json: { error: `Unexpected request: ${method} ${path}` } });
  });
}

for (const choice of [
  { label: 'Use 5 nights · 3–8 Oct', nights: 5, end: '2026-10-08' },
  { label: 'Keep 3 nights · leave 6 Oct', nights: 3, end: '2026-10-06' },
]) {
  test(`a date clarification can ${choice.label} without typing or duplicate submission`, async ({
    page,
  }) => {
    const workspace = pendingDates();
    const messages: string[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const expectedMessage = `Use arrival 2026-10-03 and return ${choice.end} for ${choice.nights} nights in London.`;
    await bootstrap(page, workspace, async (message) => {
      messages.push(message);
      await pending;
      workspace.clarification = null;
      workspace.brief.endDate = choice.end;
      workspace.stops[0].nights = choice.nights;
      workspace.stops[0].departureDate = choice.end;
      workspace.revision++;
      workspace.messages.push(
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: message,
          createdAt: workspace.updatedAt,
        },
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Confirmed ${choice.nights} nights in London. How many adults are travelling?`,
          createdAt: workspace.updatedAt,
        },
      );
    });
    try {
      await page.goto(`/studio/${workspace.id}`);
      const options = page.getByRole('group', { name: 'Resolve trip dates' });
      await expect(options).toBeVisible();
      await options.getByRole('button', { name: choice.label, exact: true }).click();
      await expect.poll(() => messages).toEqual([expectedMessage]);
      await expect(options.getByRole('button', { name: /^Use 5 nights/ })).toBeDisabled();
      await expect(options.getByRole('button', { name: /^Keep 3 nights/ })).toBeDisabled();
      await expect(page.getByRole('textbox', { name: 'Reply or refine the route' })).toBeDisabled();
      await expect(page.getByRole('log')).toContainText(expectedMessage);
      release();
      await expect(options).toHaveCount(0);
      await expect(page.getByRole('log')).toContainText(
        `Confirmed ${choice.nights} nights in London.`,
      );
      await openStudioTool(page, 'Route');
      await expect(page.getByLabel('Nights in London', { exact: true })).toHaveValue(
        String(choice.nights),
      );
      await page.reload();
      await expect(page.getByRole('log')).toContainText(expectedMessage);
      await expect(options).toHaveCount(0);
      expect(messages).toEqual([expectedMessage]);
    } finally {
      release();
    }
  });
}

test('origin departure can be edited without changing arrival at the first destination', async ({
  page,
}) => {
  const workspace = pendingDates();
  workspace.clarification = null;
  await bootstrap(page, workspace, async () => {
    throw new Error('Editing the brief must not send a chat message.');
  });
  await page.goto(`/studio/${workspace.id}`);
  await page.getByRole('button', { name: 'Trip details', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Client brief' });
  await expect(dialog.getByLabel('Departure from origin', { exact: true })).toHaveValue(
    '2026-10-03',
  );
  await expect(dialog.getByLabel('Arrival at first destination', { exact: true })).toHaveValue(
    '2026-10-03',
  );
  await dialog.getByLabel('Departure from origin', { exact: true }).fill('2026-10-02');
  await dialog.getByRole('button', { name: 'Save brief', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Trip details', exact: true }).click();
  await expect(dialog.getByLabel('Departure from origin', { exact: true })).toHaveValue(
    '2026-10-02',
  );
  await expect(dialog.getByLabel('Arrival at first destination', { exact: true })).toHaveValue(
    '2026-10-03',
  );
});
