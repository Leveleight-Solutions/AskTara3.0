import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';

// Public reference research only. Uses an isolated browser with no user account.
// Additional observed interactions can be replayed after the initial snapshot.
const output = 'docs/screenshots/odessia-itinerary';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(10000);
  const guideMode = process.argv.includes('--guide');
  await page.goto(
    guideMode ? 'https://odessia.com/destinations/japan/kyoto' : 'https://odessia.com/',
    { waitUntil: 'domcontentloaded', timeout: 60000 },
  );
  if (!guideMode)
    await page.getByRole('heading', { name: 'Odessia Travel Concierge', exact: true }).waitFor();
  const initialName = guideMode ? '00-guide' : '01-home';
  await page.screenshot({ path: `${output}/${initialName}.png`, fullPage: false });
  const snapshot = await page.locator('body').ariaSnapshot();
  await writeFile(`${output}/${initialName}.yml`, snapshot);
  console.log(guideMode ? snapshot : snapshot.split('\n').slice(0, 55).join('\n'));
  if (!guideMode && !process.argv.includes('--home')) {
    const composer = page.getByRole('textbox', { name: 'Message Odessia', exact: true });
    await composer.fill(
      'Please create a 5-day Kyoto itinerary for 2 adults, April 10–14, 2027. We enjoy food and culture, want a relaxed pace, and have a $2,500 total budget excluding flights. Include day-by-day activities and practical transport.',
    );
    try {
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
    } catch (error) {
      console.log('Send unavailable; inspecting resulting state:', error.message.split('\n')[0]);
    }
    const afterRequest = await page.locator('body').ariaSnapshot();
    await writeFile(`${output}/02-prompt-readiness.yml`, afterRequest);
    await page.screenshot({ path: `${output}/02-prompt-readiness.png`, fullPage: false });
    console.log('AFTER REQUEST ATTEMPT', afterRequest);
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  for await (const line of terminal) {
    if (!line.trim()) continue;
    const action = JSON.parse(line);
    if (action.type === 'stop') break;
    if (action.type === 'snapshot') {
      const state = await page.locator('body').ariaSnapshot();
      await writeFile(`${output}/${action.name}.yml`, state);
      await page.screenshot({ path: `${output}/${action.name}.png`, fullPage: false });
      console.log('URL', page.url(), '\n', state);
    } else if (action.type === 'click') {
      const locator = page.getByRole(action.role, { name: action.name, exact: true });
      const count = await locator.count();
      if (count !== 1) {
        console.log(
          `Observed control matched ${count} elements; no click made.`,
          await page.locator('body').ariaSnapshot(),
        );
        continue;
      }
      await locator.click();
      console.log(await page.locator('body').ariaSnapshot());
    } else if (action.type === 'prompt') {
      const locator = page.getByRole('textbox', { name: 'Message Odessia', exact: true });
      if ((await locator.count()) !== 1) throw new Error('Ambiguous observed composer');
      await locator.fill(action.text);
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      console.log(await page.locator('body').ariaSnapshot());
    }
  }
  terminal.close();
} finally {
  await browser.close();
}
