import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { destinations } from '../shared/catalog';

async function capture(page: Page, name: string) {
  if (process.env.CAPTURE_SCREENSHOTS === '1') {
    await page.evaluate(() => document.fonts.ready);
    // Full-page captures include images normally deferred below the viewport.
    await page.locator('img').evaluateAll((elements) => {
      for (const image of elements as HTMLImageElement[]) image.loading = 'eager';
    });
    await expect
      .poll(
        () =>
          page
            .locator('img')
            .evaluateAll((elements) =>
              (elements as HTMLImageElement[])
                .filter((image) => !image.complete || image.naturalWidth === 0)
                .map((image) => ({ src: image.getAttribute('src'), alt: image.alt })),
            ),
        { message: 'Images finish loading before capture' },
      )
      .toEqual([]);
    await page.screenshot({
      path: `docs/screenshots/${name}.png`,
      fullPage: name !== 'planner-desktop',
      animations: 'disabled',
    });
  }
}
async function home(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Less searching.');
  await expect(page.getByRole('textbox', { name: 'Tell Tara about your trip' })).toBeVisible();
}
async function planKyoto(page: Page) {
  await home(page);
  await page
    .getByRole('textbox', { name: 'Tell Tara about your trip' })
    .fill('Plan a 3 day trip to Kyoto starting 2027-04-12 with a budget of $1800');
  await page.getByRole('button', { name: 'Start planning your trip' }).click();
  await expect(page).toHaveURL(/\/chat\/[a-f0-9-]+$/);
  await expect(page.getByRole('group', { name: 'Itinerary days' }).getByRole('button')).toHaveCount(
    3,
  );
  await expect(page.getByRole('button', { name: 'Edit trip details' })).toBeEnabled();
  return page.url();
}
async function noHorizontalOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.viewport + 1);
}

test('discovery filters and wishlist survive a reload and can be undone', async ({ page }) => {
  await home(page);
  await capture(page, 'home-desktop');
  await page.getByRole('link', { name: 'Explore all destinations' }).click();
  await expect(page.getByRole('heading', { name: 'Your next somewhere.' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search destinations' }).fill('Kyoto');
  await expect(page.locator('.destination-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Kyoto', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save Kyoto', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unsave Kyoto', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto('/saved');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Unsave Kyoto', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unsave Kyoto', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'A blank page, full of possibility.' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('.destination-card')).toHaveCount(0);
  await page.goto('/explore');
  await page
    .getByRole('group', { name: 'Travel style', exact: true })
    .getByRole('button', { name: 'By the water' })
    .click();
  await expect(page).toHaveURL(/vibe=By\+the\+water/);
  await expect(page.getByRole('button', { name: 'By the water', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.destination-card')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Search destinations' }).fill('no-such-place-9483');
  await expect(page.getByRole('heading', { name: 'A little further off the map.' })).toBeVisible();
  await page.getByRole('button', { name: 'Show all destinations' }).click();
  await expect(page.locator('.destination-card')).toHaveCount(destinations.length);
});

test('a conversation creates an editable, persistent trip with calendar and revocable sharing', async ({
  page,
  browser,
}) => {
  const tripUrl = await planKyoto(page);
  await capture(page, 'planner-desktop');
  const firstStop = page.locator('.timeline-item').first();
  await expect(firstStop).toBeVisible();
  await firstStop.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'A moment in your journey' });
  await expect(editor).toBeVisible();
  await editor
    .getByLabel('What’s the plan?', { exact: true })
    .fill('A very unhurried Kyoto breakfast');
  await editor
    .getByLabel('A little more detail')
    .fill('Leave time for a second coffee and a walk by the river.');
  await editor.getByRole('button', { name: 'Save this moment' }).click();
  await expect(editor).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'A very unhurried Kyoto breakfast' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Mark complete: A very unhurried Kyoto breakfast', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Mark incomplete: A very unhurried Kyoto breakfast',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'This is my kind of trip' }).click();
  await expect(page.getByRole('button', { name: 'Back to draft', exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to calendar' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('asktara-kyoto.ics');
  const calendarPath = await download.path();
  expect(calendarPath).not.toBeNull();
  const calendar = await readFile(calendarPath!, 'utf8');
  expect(calendar).toContain('BEGIN:VCALENDAR');
  expect(calendar).toContain('SUMMARY:A very unhurried Kyoto breakfast');
  expect(calendar).toContain('DTSTART:20270412');

  await page.getByRole('button', { name: 'Share trip', exact: true }).click();
  const sharing = page.getByRole('dialog', { name: 'Good trips are better shared.' });
  await sharing.getByRole('button', { name: 'Create a share link' }).click();
  const publicUrl = await sharing.getByRole('textbox', { name: 'Your trip link' }).inputValue();
  expect(publicUrl).toContain('/shared/');
  const visitor = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const publicPage = await visitor.newPage();
    await publicPage.goto(publicUrl);
    await expect(
      publicPage.getByRole('heading', { name: 'A little travel inspiration, for you.' }),
    ).toBeVisible();
    await expect(
      publicPage.getByRole('heading', { name: 'A very unhurried Kyoto breakfast' }),
    ).toBeVisible();
    await expect(publicPage.getByRole('button', { name: 'Edit trip details' })).toHaveCount(0);
    await expect(publicPage.getByRole('textbox', { name: 'Message Tara' })).toHaveCount(0);
    await publicPage.getByRole('button', { name: 'Make this trip mine', exact: true }).click();
    await expect(publicPage).toHaveURL(/\/chat\/[a-f0-9-]+$/);
    expect(publicPage.url()).not.toBe(tripUrl);
    await expect(
      publicPage.getByRole('heading', { name: 'A very unhurried Kyoto breakfast' }),
    ).toBeVisible();
    await expect(publicPage.getByRole('button', { name: 'Edit trip details' })).toBeEnabled();
    await publicPage.goto(publicUrl);
    await expect(
      publicPage.getByRole('heading', { name: 'A little travel inspiration, for you.' }),
    ).toBeVisible();
    await sharing.getByRole('button', { name: 'Turn off sharing' }).click();
    await expect(sharing.getByRole('button', { name: 'Create a share link' })).toBeVisible();
    await publicPage.reload();
    await expect(publicPage.getByRole('heading', { name: 'This story isn’t here.' })).toBeVisible();
  } finally {
    await visitor.close();
  }
  await sharing.getByRole('button', { name: 'Close dialog' }).click();
  await page.goto('/trips');
  await page.getByRole('button', { name: 'Ready to go', exact: true }).click();
  await expect(page.locator('.trip-card')).toHaveCount(1);
  await page.getByRole('link', { name: 'Keep dreaming' }).click();
  await expect(page).toHaveURL(tripUrl);
  await expect(
    page.getByRole('button', { name: 'Mark incomplete: A very unhurried Kyoto breakfast' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('registering transfers guest trip and wishlist, and login restores them', async ({ page }) => {
  const email = `journey-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = 'Only-a-local-test-password!37';
  await page.goto('/explore?q=Kyoto');
  await page.getByRole('button', { name: 'Save Kyoto', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unsave Kyoto', exact: true })).toBeVisible();
  const tripUrl = await planKyoto(page);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Create an account', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Your next chapter starts here.' });
  await dialog.getByLabel('Your name').fill('Journey Tester');
  await dialog.getByLabel('Email address').fill(email);
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Create your account' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.goto('/saved');
  await expect(page.getByRole('button', { name: 'Unsave Kyoto', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Less searching.');
  await page.goto('/saved');
  await expect(
    page.getByRole('heading', { name: 'A blank page, full of possibility.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Welcome back, wanderer.' });
  await dialog.getByLabel('Email address').fill(email);
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Unsave Kyoto', exact: true })).toBeVisible();
  await page.goto(tripUrl);
  await expect(page.getByRole('group', { name: 'Itinerary days' }).getByRole('button')).toHaveCount(
    3,
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit trip details' })).toBeVisible();
});

test('public routes render without JavaScript crashes and disconnected suppliers stay honest', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const pages: [string, string][] = [
    ['/explore', 'Your next somewhere.'],
    ['/destinations/kyoto', 'Kyoto'],
    ['/saved', 'Your someday starts here.'],
    ['/trips', 'Places to go. Stories to tell.'],
    ['/chat', 'Where are we'],
    ['/not-a-real-route', 'A little off the beaten path.'],
  ];
  for (const [path, heading] of pages) {
    await page.goto(path);
    await expect(page.getByRole('heading').filter({ hasText: heading })).toBeVisible();
    await noHorizontalOverflow(page);
  }
  await page.goto('/stays');
  await expect(page.getByRole('heading', { name: 'A stay for your dates' })).toBeVisible();
  const integrations = (await (await page.request.get('/api/integrations')).json()) as {
    flights: boolean;
    hotels: boolean;
  };
  if (!integrations.hotels) {
    await expect(
      page.getByText('Live rates aren’t connected yet.', { exact: false }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'View search options' }).click();
    await expect(page.getByRole('button', { name: 'Rates not connected' })).toBeDisabled();
  }
  await page.goto('/experiences');
  await expect(page.locator('.experience-card')).toHaveCount(12);
  await page.goto('/flights');
  await expect(page.getByRole('heading', { name: 'Find your flight' })).toBeVisible();
  if (!integrations.flights) {
    await page.getByLabel('From', { exact: true }).fill('JFK');
    await page.getByLabel('To', { exact: true }).fill('LHR');
    await page.getByRole('button', { name: 'Search flights', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Flight search is not available yet.');
    await expect(page.locator('.flight-offer')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('navigation, discovery and itinerary work at 390px without horizontal overflow', async ({
    page,
  }) => {
    await home(page);
    await noHorizontalOverflow(page);
    await capture(page, 'home-mobile');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const navigation = page.getByRole('navigation', { name: 'Mobile navigation' });
    await expect(navigation).toBeVisible();
    await navigation.getByRole('link', { name: 'Discover', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your next somewhere.' })).toBeVisible();
    await expect(navigation).not.toBeVisible();
    await noHorizontalOverflow(page);
    await page.getByRole('textbox', { name: 'Search destinations' }).fill('Kyoto');
    await expect(page.locator('.destination-card')).toHaveCount(1);
    await page.getByRole('heading', { name: 'Kyoto', exact: true }).click();
    await expect(page).toHaveURL('/destinations/kyoto');
    await noHorizontalOverflow(page);
    await home(page);
    await page
      .getByRole('textbox', { name: 'Tell Tara about your trip' })
      .fill('Plan a 3 day trip to Kyoto');
    await page.getByRole('button', { name: 'Start planning your trip' }).click();
    await expect(page).toHaveURL(/\/chat\/[a-f0-9-]+$/);
    await page.getByRole('button', { name: 'Your itinerary 3', exact: true }).click();
    await expect(
      page.getByRole('group', { name: 'Itinerary days' }).getByRole('button'),
    ).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Day 3', exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
