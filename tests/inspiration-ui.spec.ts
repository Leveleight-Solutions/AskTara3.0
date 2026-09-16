import { test, expect } from '@playwright/test';
import type { Trip } from '../shared/types';
import { choose } from './ui-helpers';

test('an inspiration idea becomes a protected stop in the selected existing trip', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Tell Tara about your trip' })
    .fill('Plan a 1 day trip to Kyoto starting 2027-04-10 for 2 adults with a budget of $1000.');
  await page.getByRole('button', { name: 'Start planning your trip' }).click();
  await expect(page).toHaveURL(/\/chat\/[a-f0-9-]+$/);
  if ((page.viewportSize()?.width ?? 1440) <= 600) {
    await page.getByRole('button', { name: 'Your itinerary 1', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Edit trip details', exact: true })).toBeEnabled();
  const tripUrl = page.url();
  const tripId = new URL(tripUrl).pathname.split('/').pop()!;
  const tripResponse = await page.request.get(`/api/trips/${tripId}`);
  expect(tripResponse.ok()).toBeTruthy();
  const original = (await tripResponse.json()).trip as Trip;
  expect(original.itinerary).toHaveLength(1);

  // Reserve a known free day so this checks adding an idea, independently of planner choices.
  const fixtureResponse = await page.request.patch(`/api/trips/${tripId}`, {
    data: {
      revision: original.revision,
      itinerary: original.itinerary.map((day) => ({ ...day, items: [] })),
    },
  });
  expect(fixtureResponse.ok()).toBeTruthy();
  const before = (await fixtureResponse.json()).trip as Trip;

  await page.goto('/experiences?destination=kyoto');
  await page.getByRole('button', { name: 'View A slow morning in old Kyoto', exact: true }).click();
  const listing = page.getByRole('dialog', { name: 'A slow morning in old Kyoto', exact: true });
  await expect(listing).toContainText('curated itinerary idea');
  await listing.getByRole('button', { name: 'Add to an existing trip', exact: true }).click();
  const adding = page.getByRole('dialog', { name: 'Make room for this idea', exact: true });
  // Radix Select exposes its selection as trigger text, not as a form value.
  await expect(adding.getByRole('combobox', { name: 'Choose a trip', exact: true })).toBeVisible();
  await choose(
    page,
    adding.getByRole('combobox', { name: 'Choose a day', exact: true }),
    /^Day 1 /,
  );
  await adding.getByLabel('Start time', { exact: true }).fill('10:00');

  // The same addition flow must remain usable in a narrow viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(adding.getByRole('button', { name: 'Add to this trip', exact: true })).toBeVisible();
  const layout = await adding.evaluate((dialog) => ({
    viewport: window.innerWidth,
    width: dialog.getBoundingClientRect().width,
    left: dialog.getBoundingClientRect().left,
    content: dialog.scrollWidth,
    inner: dialog.clientWidth,
  }));
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.width).toBeLessThanOrEqual(layout.viewport);
  expect(layout.content).toBeLessThanOrEqual(layout.inner + 1);

  const additionResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/trips/${tripId}/items` &&
      response.request().method() === 'POST',
  );
  await adding.getByRole('button', { name: 'Add to this trip', exact: true }).click();
  expect((await additionResponse).status()).toBe(201);
  await expect(page).toHaveURL(tripUrl);
  await expect(adding).not.toBeVisible();
  await page.getByRole('button', { name: 'Your itinerary 1', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A slow morning in old Kyoto', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Unlock stop: A slow morning in old Kyoto', exact: true }),
  ).toBeVisible();

  const savedResponse = await page.request.get(`/api/trips/${tripId}`);
  expect(savedResponse.ok()).toBeTruthy();
  const saved = (await savedResponse.json()).trip as Trip;
  expect(saved.id).toBe(original.id);
  expect(saved.revision).toBe((before.revision ?? 0) + 1);
  expect(saved.messages).toEqual(original.messages);
  expect(saved.itinerary[0].items).toHaveLength(1);
  expect(saved.itinerary[0].items[0]).toMatchObject({
    title: 'A slow morning in old Kyoto',
    placeId: 'experience-kyoto',
    time: '10:00',
    category: 'experience',
    durationMinutes: 180,
    cost: 45,
    locked: true,
    completed: false,
  });
  expect(saved.planning?.budget.activities).toBe(90);
  const tripsResponse = await page.request.get('/api/trips');
  expect(tripsResponse.ok()).toBeTruthy();
  expect((await tripsResponse.json()).trips.map((trip: Trip) => trip.id)).toEqual([tripId]);

  await page.reload();
  await page.getByRole('button', { name: 'Your itinerary 1', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Unlock stop: A slow morning in old Kyoto', exact: true }),
  ).toBeVisible();
});
