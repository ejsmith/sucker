#!/usr/bin/env node

const { execFileSync, spawn, spawnSync } = require('node:child_process');
const {
  envFilePath,
  readEnvFile,
  resetSupabaseDatabaseIfNeeded,
  startMinimalSupabase,
  supabaseCliPath,
  writeLocalTestEnvFile,
} = require('./supabase-test-env.cjs');

function waitForFunction(url, child) {
  const deadline = Date.now() + 60_000;

  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (child.exitCode !== null) {
        reject(new Error(`Supabase functions exited before ${url} was ready.`));
        return;
      }

      try {
        const response = await fetch(url, { method: 'OPTIONS' });
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // Keep polling until the deadline.
      }

      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${url}.`));
        return;
      }

      setTimeout(poll, 1_000);
    };

    poll();
  });
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }

  child.kill('SIGTERM');
}

async function main() {
  console.log('Starting minimal local Supabase stack...');
  startMinimalSupabase();

  console.log('Preparing local Supabase database...');
  resetSupabaseDatabaseIfNeeded();

  console.log('Writing local test environment...');
  writeLocalTestEnvFile();
  const env = { ...process.env, ...readEnvFile() };

  console.log('Serving game-action Edge Function...');
  const functions = spawn(
    process.execPath,
    [supabaseCliPath, 'functions', 'serve', 'game-action', '--no-verify-jwt', '--env-file', envFilePath],
    { env, stdio: 'inherit', windowsHide: true },
  );

  try {
    await waitForFunction(`${env.SUPABASE_URL}/functions/v1/game-action`, functions);

    console.log('Running Supabase integration tests...');
    execFileSync(
      'deno',
      [
        'test',
        `--env-file=${envFilePath}`,
        '--allow-env',
        '--allow-net',
        'supabase/tests/game-action.integration.test.ts',
      ],
      { env, stdio: 'inherit' },
    );
  } finally {
    stopProcess(functions);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
