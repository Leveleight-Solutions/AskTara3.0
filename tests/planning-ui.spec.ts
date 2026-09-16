import { test, expect, type Locator, type Page } from '@playwright/test';
import type { Trip } from '../shared/types';
import type { PlanningRun } from '../shared/planning';

/** Radix Select has no native <select>: open the trigger, then pick the option by its label. */
async function choose(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(trigger).toHaveText(option);
}
const dayTabs = (page: Page) => page.getByRole('group', { name: 'Itinerary days' });
/** The planning report groups its sections in <details> blocks keyed by their summary. */
const disclosure = (page: Page, summary: string) =>
  page.locator('details').filter({ has: page.getByText(summary, { exact: true }) });

async function savedTrip(page: Page, tripId?: string): Promise<Trip> {
  const id = tripId || new URL(page.url()).pathname.split('/').pop();
  const response = await page.request.get(`/api/trips/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).trip as Trip;
}

async function beginKyoto(page: Page) {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Tell Tara about your trip' })
    .fill(
      'Plan a 5 day trip to Kyoto starting 2027-04-10 for 2 adults with a budget of $2500. We enjoy food and culture.',
    );
  await page.getByRole('button', { name: 'Start planning your trip' }).click();
  await expect(page).toHaveURL(/\/chat\/[a-f0-9-]+$/);
}

async function planKyoto(page: Page) {
  await beginKyoto(page);
  await expect(dayTabs(page).getByRole('button')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Edit trip details' })).toBeEnabled();
  return savedTrip(page);
}

async function followUp(page: Page, message: string) {
  await page.getByRole('textbox', { name: 'Message Tara' }).fill(message);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByTestId('chat-messages')).toContainText(message);
  await expect(page.getByRole('textbox', { name: 'Message Tara' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Edit trip details' })).toBeEnabled();
}

test('a protected stop survives conversational changes, and restoring history recovers an earlier plan', async ({
  page,
}) => {
  const original = await planKyoto(page);
  const firstStop = original.itinerary[0].items[0];
  expect(firstStop).toBeDefined();
  const originalVersion = original.revision;
  expect(originalVersion).toBeGreaterThan(0);
  const customTitle = 'A leisurely breakfast by the Kyoto river';

  const originalCard = page.getByRole('article').filter({
    has: page.getByRole('heading', { name: firstStop.title, exact: true }),
  });
  await originalCard.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'A moment in your journey' });
  await editor.getByLabel('What’s the plan?', { exact: true }).fill(customTitle);
  await editor.getByLabel('Duration (minutes)', { exact: true }).fill('90');
  await editor
    .getByLabel('A little more detail')
    .fill('Keep ninety minutes for breakfast and a quiet river walk.');
  await editor.getByRole('button', { name: 'Save this moment' }).click();
  await expect(editor).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: `Unlock stop: ${customTitle}`, exact: true }),
  ).toBeVisible();

  await followUp(page, 'Make it slower and more relaxing');
  await expect(page.getByRole('heading', { name: customTitle, exact: true })).toBeVisible();
  const updated = await savedTrip(page);
  const protectedStop = updated.itinerary
    .flatMap((day) => day.items)
    .find((item) => item.id === firstStop.id);
  expect(protectedStop).toMatchObject({ title: customTitle, durationMinutes: 90, locked: true });
  expect(updated.brief?.pace).toBe('relaxed');
  expect(updated.revision).toBeGreaterThan(originalVersion!);

  await page.reload();
  await expect(page.getByRole('heading', { name: customTitle, exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Stays & details', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your trip, considered', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Your estimated group spend', exact: true }),
  ).toBeVisible();
  await page.getByText('Assumptions & sources', { exact: true }).click();
  await expect(disclosure(page, 'Assumptions & sources')).toBeVisible();

  await page.getByRole('button', { name: 'Itinerary history', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'Every version of your journey' });
  const originalEntry = history
    .getByRole('article')
    .filter({ hasText: new RegExp(`Version ${originalVersion}\\b`) });
  await expect(originalEntry).toHaveCount(1);
  await originalEntry.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(history).not.toBeVisible();
  await page.getByRole('tab', { name: 'Itinerary', exact: true }).click();
  await expect(page.getByRole('heading', { name: firstStop.title, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: customTitle, exact: true })).toHaveCount(0);
  const restored = await savedTrip(page);
  expect(restored.itinerary).toEqual(original.itinerary);
  expect(restored.messages).toEqual(updated.messages);
  expect(restored.revision).toBeGreaterThan(updated.revision!);
  await page.reload();
  await expect(page.getByRole('heading', { name: firstStop.title, exact: true })).toBeVisible();
});

test('destination allocations remain aligned across settings, regeneration and day views', async ({
  page,
}) => {
  await planKyoto(page);
  await page.getByRole('button', { name: 'Edit trip details', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Make it your kind of trip' });
  await settings.getByLabel('Number of days', { exact: true }).fill('4');
  await choose(
    page,
    settings.getByRole('combobox', { name: 'Your pace', exact: true }),
    'Slow & spacious',
  );
  await settings.getByText('Plan more than one destination', { exact: true }).click();
  // A new single-destination trip may already have its first route stop populated.
  if (!(await settings.getByRole('combobox', { name: 'Destination 1', exact: true }).count())) {
    await settings.getByRole('button', { name: 'Add destination', exact: true }).click();
  }
  await choose(
    page,
    settings.getByRole('combobox', { name: 'Destination 1', exact: true }),
    'Kyoto',
  );
  await settings.getByRole('spinbutton', { name: 'Days in stop 1', exact: true }).fill('2');
  await settings.getByRole('button', { name: 'Add destination', exact: true }).click();
  await choose(
    page,
    settings.getByRole('combobox', { name: 'Destination 2', exact: true }),
    'Lisbon',
  );
  await settings.getByRole('spinbutton', { name: 'Days in stop 2', exact: true }).fill('2');
  await expect(settings.getByText('4 of 4 days allocated', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: 'Save trip details', exact: true }).click();
  await expect(settings).not.toBeVisible();

  await followUp(page, 'Rebuild the itinerary using my saved destinations and pace.');
  await expect(dayTabs(page).getByRole('button')).toHaveCount(4);
  const planned = await savedTrip(page);
  expect(planned.days).toBe(4);
  expect(planned.brief?.destinationStops).toEqual([
    { destinationId: 'kyoto', days: 2 },
    { destinationId: 'lisbon', days: 2 },
  ]);
  expect(planned.itinerary.map((day) => day.destinationId)).toEqual([
    'kyoto',
    'kyoto',
    'lisbon',
    'lisbon',
  ]);
  expect(planned.brief?.pace).toBe('relaxed');

  for (const [number, city] of [
    [1, 'Kyoto'],
    [3, 'Lisbon'],
  ] as const) {
    const day = planned.itinerary[number - 1];
    await dayTabs(page)
      .getByRole('button', { name: `Day ${number}`, exact: false })
      .click();
    await expect(page.getByTestId('day-intro')).toContainText(city);
    await expect(page.getByRole('heading', { name: day.title, exact: true })).toBeVisible();
    const stop = day.items[0];
    await expect(page.getByRole('heading', { name: stop.title, exact: true })).toBeVisible();
  }
  await page.reload();
  await expect(dayTabs(page).getByRole('button')).toHaveCount(4);
  expect((await savedTrip(page)).brief?.destinationStops).toEqual(planned.brief?.destinationStops);
});

test('refresh while planning resumes the saved run without duplicating the request', async ({
  page,
}) => {
  let postedRuns = 0;
  let heldPolls = 0;
  let releasePolls!: () => void;
  const holdPolls = new Promise<void>((resolve) => {
    releasePolls = resolve;
  });
  let released = false;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/planning/runs')
      postedRuns++;
  });
  // Delay only delivery to the browser; the real server still runs and persists the plan.
  await page.route(/\/api\/planning\/runs\/[^/]+$/, async (route) => {
    if (route.request().method() !== 'GET' || released) return route.continue();
    heldPolls++;
    await holdPolls;
    try {
      await route.continue();
    } catch {
      /* The pre-refresh request may have been cancelled. */
    }
  });
  try {
    await beginKyoto(page);
    await expect.poll(() => heldPolls).toBeGreaterThan(0);
    await expect(page.getByText('Your journey is taking shape', { exact: true })).toBeVisible();
    const tripId = new URL(page.url()).pathname.split('/').pop()!;
    await page.reload();
    released = true;
    releasePolls();
    await expect(dayTabs(page).getByRole('button')).toHaveCount(5);
    await expect(page.getByRole('textbox', { name: 'Message Tara' })).toBeEnabled();
    expect(postedRuns).toBe(1);
    const trip = await savedTrip(page, tripId);
    expect(trip.messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(trip.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
    const response = await page.request.get(`/api/trips/${tripId}/runs`);
    expect(response.ok()).toBeTruthy();
    const { runs } = (await response.json()) as { runs: PlanningRun[] };
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ tripId, status: 'completed' });
  } finally {
    released = true;
    releasePolls();
  }
});

test('retry after three polling failures recovers the original run without another POST', async ({
  page,
}) => {
  let postedRuns = 0;
  let failedPolls = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/planning/runs')
      postedRuns++;
  });
  await page.route(/\/api\/planning\/runs\/[^/]+$/, async (route) => {
    if (route.request().method() === 'GET' && failedPolls < 3) {
      failedPolls++;
      return route.abort('failed');
    }
    return route.continue();
  });
  await beginKyoto(page);
  const tripId = new URL(page.url()).pathname.split('/').pop()!;
  await expect(page.getByRole('button', { name: 'Try again', exact: false })).toBeVisible();
  expect(failedPolls).toBe(3);
  expect(postedRuns).toBe(1);
  await page.getByRole('button', { name: 'Try again', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Try again', exact: false })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message Tara' })).toBeEnabled();
  await expect(dayTabs(page).getByRole('button')).toHaveCount(5);
  expect(postedRuns).toBe(1);
  const trip = await savedTrip(page, tripId);
  expect(trip.messages.filter((message) => message.role === 'user')).toHaveLength(1);
  expect(trip.messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
  const response = await page.request.get(`/api/trips/${tripId}/runs`);
  expect(response.ok()).toBeTruthy();
  const { runs } = (await response.json()) as { runs: PlanningRun[] };
  expect(runs).toHaveLength(1);
  expect(runs[0].status).toBe('completed');
});

test('Back and Forward during a delayed run keep each chat aligned with its own trip', async ({
  page,
}) => {
  const kyoto = await planKyoto(page);
  const kyotoUrl = page.url();
  await page.getByRole('link', { name: 'Start a new conversation', exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await followUp(
    page,
    'Plan a 3 day trip to Lisbon starting 2027-06-12 for 2 adults with a budget of $1600.',
  );
  await expect(dayTabs(page).getByRole('button')).toHaveCount(3);
  const lisbon = await savedTrip(page);
  const lisbonUrl = page.url();
  expect(lisbon.destinationId).toBe('lisbon');
  expect(lisbon.id).not.toBe(kyoto.id);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let heldPolls = 0;
  let abortedPolls = 0;
  let holding = true;
  const runPoll = /\/api\/planning\/runs\/[^/]+$/;
  page.on('requestfailed', (request) => {
    if (
      runPoll.test(new URL(request.url()).pathname) &&
      request.failure()?.errorText.includes('ABORTED')
    )
      abortedPolls++;
  });
  await page.route(runPoll, async (route) => {
    if (route.request().method() !== 'GET' || !holding) return route.continue();
    heldPolls++;
    await hold;
    try {
      await route.continue();
    } catch {
      /* Navigation cancels the abandoned observer. */
    }
  });
  try {
    await page
      .getByRole('textbox', { name: 'Message Tara' })
      .fill('Make it slower and more relaxing');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(() => heldPolls).toBeGreaterThan(0);
    await expect(page.getByText('Your journey is taking shape', { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(kyotoUrl);
    await expect(page.getByRole('heading', { name: kyoto.title, exact: true })).toBeVisible();
    await expect.poll(() => abortedPolls).toBeGreaterThan(0);
    holding = false;
    release();
    await expect(page.getByRole('textbox', { name: 'Message Tara' })).toBeEnabled();
    await expect(dayTabs(page).getByRole('button')).toHaveCount(5);
    await expect(page.getByRole('heading', { name: lisbon.title, exact: true })).toHaveCount(0);

    await page.goForward();
    await expect(page).toHaveURL(lisbonUrl);
    await expect(page.getByRole('heading', { name: lisbon.title, exact: true })).toBeVisible();
    await expect(dayTabs(page).getByRole('button')).toHaveCount(3);
    await expect(page.getByRole('textbox', { name: 'Message Tara' })).toBeEnabled();
    expect((await savedTrip(page)).brief?.pace).toBe('relaxed');
    await page.goBack();
    await expect(page).toHaveURL(kyotoUrl);
    await expect(page.getByRole('heading', { name: kyoto.title, exact: true })).toBeVisible();
    await expect(dayTabs(page).getByRole('button')).toHaveCount(5);
    expect((await savedTrip(page)).itinerary).toEqual(kyoto.itinerary);
  } finally {
    holding = false;
    release();
  }
});
