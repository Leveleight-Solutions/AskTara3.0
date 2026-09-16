import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto('https://odessia.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.screenshot({ path: 'docs/screenshots/reference.png', fullPage: false });
  console.log((await page.locator('body').innerText()).slice(0, 9000));
} finally {
  await browser.close();
}
