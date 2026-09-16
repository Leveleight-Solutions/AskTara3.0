import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

// The dev server reads WEB_PORT from .env, so the suite must follow it. Without this the
// default 5173 can silently hit an unrelated Vite server and test the wrong application,
// because reuseExistingServer treats whatever answers on that port as ours.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${process.env.WEB_PORT || 5173}`;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
