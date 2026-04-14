import { defineConfig, devices } from '@playwright/test';

/**
 * Baseline Playwright config for the nimbus-gantt visual-regression harness.
 *
 * The harness scripts (capture.ts, compare.ts, report.ts, run.ts) drive Playwright
 * directly rather than running through the test runner, so this config is mostly
 * informational — but it pins the viewport + browser so anyone who wants to use
 * `npx playwright test` later gets the same defaults.
 */
export default defineConfig({
  testDir: './',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
});
