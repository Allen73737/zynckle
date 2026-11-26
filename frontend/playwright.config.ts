import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of the main flows plus axe accessibility checks.
 *
 * Expects the API on ZYNCKLE_API (default http://localhost:8080; CI starts it). The Vite dev server is
 * started here and proxies /api, /ws and /collab to it, exactly as in local development.
 * Locally, set E2E_PORT (and ZYNCKLE_API) to run beside your own dev servers without touching them,
 * and PW_CHROMIUM to reuse an installed Chromium instead of downloading Playwright's.
 */
const port = Number(process.env.E2E_PORT || 5173);
const api = process.env.ZYNCKLE_API || 'http://localhost:8080';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@phone/ },
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /@phone/ },
  ],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    env: { ZYNCKLE_API: api },
    reuseExistingServer: !process.env.CI && !process.env.E2E_PORT,
    timeout: 120_000,
  },
});
