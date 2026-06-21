import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
    },
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  testDir: './e2e',
  timeout: 60_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8081',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { height: 852, width: 393 },
  },
  workers: 1,
});
