import { expect, test } from '@playwright/test';
import type { StudioWorkspace } from '../shared/studio';
import { closeStudioTool, openStudioTool } from './ui-helpers';

test('short honeymoon answers complete a saved manual proposal when AI is unavailable', async ({
  page,
}) => {
  const status = await page.request.get('/api/integrations');
  expect(status.ok()).toBeTruthy();
  test.skip((await status.json()).ai, 'Exercises an actual no-key server.');
  let workspace: StudioWorkspace | undefined;
  const backgroundResearch: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && /destinations\/|trip-briefing/.test(path))
      backgroundResearch.push(path);
  });
  try {
    const created = await page.request.post('/api/studio/workspaces', { data: {} });
    expect(created.status()).toBe(201);
    workspace = (await created.json()).workspace;
    await page.goto(`/studio/${workspace!.id}`);
    await expect(page.getByRole('note', { name: 'Basic planning mode' })).toBeVisible();
    for (const message of [
      'Kyoto, Japan',
      'honeymoon',
      '3 nights',
      '2 adults',
      'no children',
      'arrive 18 November 2026',
      'leave 21 November 2026',
      'Australian passport',
      'AUD 5000 total',
    ]) {
      const response = page.waitForResponse(
        (value) =>
          new URL(value.url()).pathname === `/api/studio/workspaces/${workspace!.id}/review` &&
          value.request().method() === 'POST',
      );
      await page.locator('#studio-message').fill(message);
      await page
        .locator('form')
        .filter({ has: page.locator('#studio-message') })
        .locator('button[type="submit"]')
        .click();
      const reviewed = await response;
      expect(reviewed.status()).toBe(200);
      const result = await reviewed.json();
      expect(result.mode).toBe('local');
      workspace = result.workspace;
    }
    expect(workspace!.brief).toMatchObject({
      adults: 2,
      children: 0,
      passportNationality: 'AU',
      tripPurpose: 'tourism',
      startDate: '2026-11-18',
      endDate: '2026-11-21',
      budget: 5000,
      currency: 'AUD',
    });
    expect(workspace!.stops).toHaveLength(1);
    expect(workspace!.stops[0]).toMatchObject({
      name: 'Kyoto',
      nights: 3,
      arrivalDate: '2026-11-18',
      departureDate: '2026-11-21',
    });
    const accepted = page.waitForResponse((value) => value.url().endsWith('/accept-structure'));
    await page
      .getByTestId('studio-trip-board')
      .getByRole('button', { name: 'Use this route', exact: true })
      .click();
    expect((await accepted).ok()).toBeTruthy();
    await openStudioTool(page, 'Daily activities');
    await page.getByRole('button', { name: 'Start daily plan manually', exact: true }).click();
    const editor = page.getByRole('form', { name: 'Edit daily itinerary' });
    await editor.getByLabel('Day 1 title', { exact: true }).fill('Kyoto arrival and rest');
    const saved = page.waitForResponse(
      (value) =>
        value.request().method() === 'PATCH' &&
        value.url().endsWith(`/workspaces/${workspace!.id}`),
    );
    await editor.getByRole('button', { name: 'Save daily plan', exact: true }).click();
    expect((await saved).ok()).toBeTruthy();
    await closeStudioTool(page);
    await page.reload();
    await expect(page.getByTestId('studio-trip-board')).toContainText('Kyoto arrival and rest');
    const reloaded = await page.request.get(`/api/studio/workspaces/${workspace!.id}`);
    workspace = (await reloaded.json()).workspace;
    expect(workspace!.itinerary?.days).toHaveLength(4);
    expect(
      workspace!.itinerary?.days
        .flatMap((day) => day.activities)
        .every((activity) => activity.sources.length === 0),
    ).toBeTruthy();
    expect(workspace!.destinationResearch).toBeFalsy();
    expect(workspace!.tripBriefing).toBeFalsy();
    expect(backgroundResearch).toEqual([]);
    const pdf = await page.request.get(
      `/api/studio/workspaces/${workspace!.id}/proposal/preview/pdf`,
    );
    expect(pdf.ok()).toBeTruthy();
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    expect(workspace!.items).toEqual([]);
    expect(workspace!.proposal).toBeNull();
  } finally {
    if (workspace)
      expect((await page.request.delete(`/api/studio/workspaces/${workspace.id}`)).status()).toBe(
        204,
      );
  }
});
