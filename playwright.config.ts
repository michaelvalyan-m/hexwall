import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.HEXWALL_E2E_PORT ?? 8123);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node_modules/.bin/tsx packages/server/src/index.ts`,
    url: `${BASE}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      HEXWALL_TEST_HOOKS: '1',
      HEXWALL_SERVE_WEB: '1',
      HEXWALL_PROVIDER: 'mock',
    },
  },
});
