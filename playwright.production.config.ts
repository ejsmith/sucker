import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-production',
  outputDir: 'test-results/production',
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/production-timings.json' }]],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 393, height: 852 },
    baseURL: 'http://127.0.0.1:8099',
    trace: 'retain-on-failure',
  },
  webServer: { command: 'node scripts/serve-web-export.cjs', url: 'http://127.0.0.1:8099', reuseExistingServer: false },
});
