import { test, expect } from '@playwright/test';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import { defaultStudioAgency } from '../shared/studio';

test('home sends explicit trip details unchanged and uses form details only when missing', async ({
  page,
}) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data: Record<string, unknown> = {
      '/api/session': { user: null },
      '/api/catalog': catalog,
      '/api/saved': { items: [] },
      '/api/studio/workspaces': { workspaces: [] },
      '/api/studio/agency': { agency: defaultStudioAgency() },
      '/api/studio/clients': { clients: [] },
      '/api/profile': { profile: defaultTravelProfile },
      '/api/integrations': {
        ai: false,
        hotels: false,
        flights: false,
        activities: false,
        mode: 'local',
      },
    };
    await route.fulfill({
      json: data[path] || { error: 'Unexpected fixture request' },
      status: data[path] ? 200 : 500,
    });
  });
  const selectedDate = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const explicit = 'Plan 4 days in London starting 2027-05-10 for 2 adults and 1 child.';
  const cases = [
    { prompt: 'I’m thinking about Japan', expected: 'I’m thinking about Japan', details: false },
    { prompt: explicit, expected: explicit, details: true },
    {
      prompt: 'A food trip to London',
      expected: `A food trip to London for 5 travelers starting ${selectedDate}`,
      details: true,
    },
  ];
  for (const { prompt, expected, details: useDetails } of cases) {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Who’s travelling?', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add dates', exact: true })).toBeVisible();
    if (useDetails) {
      await page.getByRole('button', { name: 'Who’s travelling?', exact: true }).click();
      const details = page.getByRole('dialog', { name: 'A few little details' });
      await details.getByLabel('How many travelers?').fill('5');
      await details.getByLabel('When would you like to go?').fill(selectedDate);
      await details.getByRole('button', { name: 'Sounds good' }).click();
    }
    await page.getByRole('textbox', { name: 'Tell Tara about your trip' }).fill(prompt);
    await page.getByRole('button', { name: 'Start planning your trip' }).click();
    await expect(page).toHaveURL(new RegExp('/studio\\?q='));
    expect(new URL(page.url()).searchParams.get('q')).toBe(expected);
    await expect(page.getByLabel('Client request or planning notes')).toHaveValue(expected);
    await expect(
      page.getByRole('button', { name: 'Start a workspace', exact: true }),
    ).toBeEnabled();
  }
});
