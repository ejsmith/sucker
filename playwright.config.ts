import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

function readEnvFile(path: string) {
  const env: Record<string, string> = {};

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) {
      env[match[1]] = match[2];
    }
  }

  return env;
}

const localEnvFile = 'supabase/.temp/e2e.env';
const localTestEnv = readEnvFile(localEnvFile);
Object.assign(process.env, localTestEnv);
const e2eBaseUrl = localTestEnv.E2E_BASE_URL ?? 'http://127.0.0.1:8081';

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
    baseURL: e2eBaseUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { height: 852, width: 393 },
  },
  webServer: [
    {
      command: `supabase functions serve game-action --no-verify-jwt --env-file ${localEnvFile}`,
      env: localTestEnv,
      name: 'Supabase functions',
      reuseExistingServer: false,
      timeout: 60_000,
      wait: {
        stdout: /Serving functions on|Using supabase-edge-runtime/,
        stderr: /Serving functions on|Using supabase-edge-runtime/,
      },
    },
    {
      command: 'npm run web -- --port 8081',
      env: { ...localTestEnv, BROWSER: 'none' },
      name: 'Expo web',
      reuseExistingServer: false,
      timeout: 90_000,
      url: e2eBaseUrl,
    },
  ],
  workers: 1,
});
