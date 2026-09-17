import { test, expect } from '@playwright/test';
import { newStudioWorkspace } from '../server/studio-store';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import { defaultStudioAgency } from '../shared/studio';

test('home sends explicit trip details unchanged and uses form details only when missing', async ({
  page,
}) => {
  const workspaceId = '7b1f2c3d-4e5a-4b6c-8d9e-0f1a2b3c4d5e';
  const workspace = { ...newStudioWorkspace(), id: workspaceId, revision: 0 };
  /* Submitting the composer creates the workspace and hands the brief to it through `?q=`; the
     workspace is what posts /review, so the composer no longer waits out the model. That makes
     what the app "did with the prompt" a request body from the destination rather than a query
     string — the workspace has to be fetchable for it to get there at all. Every /review body is
     kept so the assertions below can read the message the app actually sent, and check that it
     sent exactly one. */
  const reviews: { message?: string }[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    // Path alone no longer identifies a fixture: /studio/workspaces is a list on GET and a
    // creation on POST, and the two return different shapes.
    if (method === 'POST' && path === '/api/studio/workspaces')
      return route.fulfill({ status: 201, json: { workspace } });
    if (method === 'GET' && path === `/api/studio/workspaces/${workspaceId}`)
      return route.fulfill({ status: 200, json: { workspace } });
    if (method === 'POST' && path === `/api/studio/workspaces/${workspaceId}/review`) {
      reviews.push(request.postDataJSON() as { message?: string });
      return route.fulfill({ status: 200, json: { workspace } });
    }
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
    reviews.length = 0;
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
    /* The carried brief is dropped from the URL once the workspace has sent it, so settling on
       the bare path is also the signal that the hand-off completed exactly once. */
    await expect(page).toHaveURL(new RegExp(`/studio/${workspaceId}$`));
    /* The assertion the whole spec exists for: an explicitly detailed brief is sent to the server
       word for word, and the chips' answers are folded in only where the brief left a gap. Read
       off the request body rather than the URL, so it is what was sent that is checked and not
       what happened to be displayed on the way. */
    await expect.poll(() => reviews.length).toBe(1);
    expect(reviews[0].message).toBe(expected);
  }
});
