import { defineConfig, devices } from '@playwright/test';
import mocked from './playwright.mocked.config';

export default defineConfig({
  ...mocked,
  workers: 1,
  retries: 0,
  projects: [{
    name: 'native-webkit-scroll',
    testMatch: ['scan-reading-scroll.mocked.spec.ts'],
    use: { ...devices['Desktop Safari'] },
  }],
});
