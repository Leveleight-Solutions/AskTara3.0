import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function loadImages(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = Array.from(document.images);
    for (const img of images) {
      img.loading = 'eager';
    }
    await Promise.all(
      images.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.onload = resolve;
              img.onerror = resolve;
            }),
      ),
    );
  });
}
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).filter({ hasText: 'Less searching.' }).waitFor();
  await loadImages(page);
  await page.screenshot({ path: 'docs/screenshots/home-desktop.png', fullPage: true });
  await page.screenshot({ path: 'docs/screenshots/home-viewport.png', fullPage: false });
  const failed = await page
    .locator('img')
    .evaluateAll((els) => els.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
  console.log('Failed images:', JSON.stringify(failed));
  await page.setViewportSize({ width: 390, height: 844 });
  await loadImages(page);
  await page.screenshot({ path: 'docs/screenshots/home-mobile.png', fullPage: true });
  await page.screenshot({ path: 'docs/screenshots/mobile-viewport.png', fullPage: false });
  console.log(
    'Mobile horizontal overflow:',
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:3001/', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).filter({ hasText: 'Less searching.' }).waitFor();
  await loadImages(page);
  console.log('Built application home:', await page.title());
  await page.getByRole('link', { name: 'Explore all destinations' }).click();
  await page.getByRole('heading', { name: 'Your next somewhere.' }).waitFor();
  console.log('Built discover cards:', await page.locator('.destination-card').count());
  console.log('JavaScript errors:', JSON.stringify(errors));
  if (failed.length || errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
