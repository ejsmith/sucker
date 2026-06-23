#!/usr/bin/env node

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  resetSupabaseDatabaseIfNeeded,
  startMinimalSupabase,
  writeLocalTestEnvFile,
} = require('./supabase-test-env.cjs');

const playwrightCliPath = path.resolve(__dirname, '..', 'node_modules', '@playwright', 'test', 'cli.js');

function main() {
  console.log('Starting minimal local Supabase stack...');
  startMinimalSupabase();

  console.log('Preparing local Supabase database...');
  resetSupabaseDatabaseIfNeeded();

  console.log('Writing local test environment...');
  writeLocalTestEnvFile();

  console.log('Running Playwright web E2E tests...');
  execFileSync(process.execPath, [playwrightCliPath, 'test'], { stdio: 'inherit' });
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
