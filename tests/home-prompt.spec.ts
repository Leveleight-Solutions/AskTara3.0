import { test, expect } from '@playwright/test';
import { newStudioWorkspace } from '../server/studio-store';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import { defaultStudioAgency } from '../shared/studio';
import { readDay } from '../shared/trip-details';

/* The calendar names each day the way TripDatePanel does, so the spec builds the same string
   rather than hunting for a bare numeral that repeats across two visible months. */
function describeDay(day: string): string {
  const date = readDay(day);
  const weekday = date.toLocaleDateString('en-AU', { weekday: 'long' });
  const rest = date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${weekday}, ${rest}`;
}

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
      expected: `A food trip to London for 5 adults starting ${selectedDate}`,
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
      /* Each chip answers itself in its own panel now, so the details are two short exchanges
         rather than one modal: pick the party size, then pick the date. */
      await page.getByRole('button', { name: 'Who’s travelling?', exact: true }).click();
      const party = page.getByRole('dialog');
      /* Four presses from the panel's opening party of one. Counting up rather than typing is the
         point of the stepper, so the test presses it the way a user would. */
      for (let press = 0; press < 4; press += 1)
        await party.getByRole('button', { name: 'Add an adult' }).click();
      await party.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(party).toHaveCount(0);
      await expect(page.getByRole('button', { name: '5 adults', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Add dates', exact: true }).click();
      const dates = page.getByRole('dialog');
      /* The calendar opens on this month and shows two, so the chosen day may be a window or two
         ahead. Walk forward until its cell is on screen rather than computing the number of
         presses, which would encode how many months the panel happens to show. */
      const day = dates.getByRole('button', { name: describeDay(selectedDate), exact: true });
      for (let look = 0; look < 12 && !(await day.isVisible()); look += 1)
        await dates.getByRole('button', { name: 'Next month' }).click();
      await day.click();
      await dates.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(dates).toHaveCount(0);
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
