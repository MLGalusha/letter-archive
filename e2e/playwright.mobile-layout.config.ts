import { defineConfig, devices } from '@playwright/test';
import mocked from './playwright.mocked.config';

// Engine/geometry coverage; these projects do not emulate Safari's native UI.
export default defineConfig({
  ...mocked,
  testMatch: 'public-mobile-layout.mocked.spec.ts',
  workers: 2,
  projects: [
    { name: 'chromium-phone', use: { ...devices['iPhone 13'], browserName: 'chromium', viewport: { width: 390, height: 844 } } },
    { name: 'webkit-phone', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
});
