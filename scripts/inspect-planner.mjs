import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(
    `${process.env.ASKTARA_PREVIEW_URL || 'http://localhost:5173'}/chat?q=` +
      encodeURIComponent(
        'Plan 5 days in Kyoto for 2 travelers starting 2027-04-12 with a $2500 budget. I enjoy food and culture.',
      ),
  );
  await expect(page.getByRole('group', { name: 'Itinerary days' }).getByRole('button')).toHaveCount(
    5,
  );
  await expect(page.getByRole('button', { name: 'Edit trip details' })).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/screenshots/planner-agents-desktop.png' });
  const map = page.getByRole('region', { name: 'Your day, on the map' });
  await map.scrollIntoViewIfNeeded();
  await map.getByLabel('Getting around').click();
  await page.getByRole('option', { name: 'Walking', exact: true }).click();
  await expect(map.getByRole('link', { name: 'Open itinerary in Google Maps' })).toHaveAttribute(
    'href',
    /travelmode=walking/,
  );
  await page.screenshot({ path: 'docs/screenshots/planner-map-desktop.png' });
  await page.getByRole('tab', { name: 'Stays & details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your trip, considered' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/planner-review-desktop.png' });
  await page.getByText('Assumptions & sources', { exact: true }).click();
  await page
    .getByText('Asktara curated destination ideas', { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/planner-sources-desktop.png' });
  await page.getByRole('tab', { name: 'Itinerary', exact: true }).click();
  await page.locator('[aria-label="Your trip itinerary"]').evaluate((el) => (el.scrollTop = 0));
  const placeButtons = page.getByRole('button', { name: 'Place details', exact: true });
  const placeCount = await placeButtons.count();
  if (!placeCount) throw new Error('The itinerary has no place details to inspect');
  await placeButtons.nth(0).click();
  await expect(page.getByRole('link', { name: 'Open in Google Maps' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/planner-place-desktop.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: /Your itinerary/ }).click();
  await page.screenshot({ path: 'docs/screenshots/planner-agents-mobile.png' });
  await page.getByRole('tab', { name: 'Stays & details', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/planner-review-mobile.png' });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  console.log(JSON.stringify({ javascriptErrors: errors, mobileOverflow: overflow }));
  if (errors.length || overflow) process.exitCode = 1;
} finally {
  await browser.close();
}
