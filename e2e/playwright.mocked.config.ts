import { defineConfig, devices } from '@playwright/test';

const MOCKED_BASE_URL = process.env.E2E_MOCKED_BASE_URL || 'http://127.0.0.1:4174';
const MOCKED_API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://localhost:3002';

export default defineConfig({
  testDir: './tests',
  grep: /@mocked/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: MOCKED_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174',
    url: MOCKED_BASE_URL,
    cwd: '../frontend',
    env: {
      ...process.env,
      VITE_API_URL: MOCKED_API_BASE_URL,
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
