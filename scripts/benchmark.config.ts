import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'image-benchmark.ts',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BENCHMARK_BASE_URL || 'http://localhost:5174',
    ...devices['Desktop Chrome'],
    // No screenshots or traces — this is a benchmark, not a test
    screenshot: 'off',
    trace: 'off',
  },
});
