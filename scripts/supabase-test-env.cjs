const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const envFilePath = path.resolve(__dirname, '..', '.env.e2e.local');
const supabaseCliPath = path.resolve(__dirname, '..', 'node_modules', 'supabase', 'dist', 'supabase.js');

function parseEnv(output) {
  const values = {};

  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) {
      continue;
    }

    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    values[match[1]] = value;
  }

  return values;
}

function readSupabaseStatusEnv() {
  const output = execFileSync(process.execPath, [supabaseCliPath, 'status', '-o', 'env'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  return parseEnv(output);
}

function buildLocalTestEnv(statusEnv = readSupabaseStatusEnv()) {
  const supabaseUrl = process.env.SUPABASE_URL || statusEnv.API_URL || 'http://127.0.0.1:54321';
  const anonKey = process.env.SUPABASE_ANON_KEY || statusEnv.ANON_KEY || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || statusEnv.SERVICE_ROLE_KEY || '';

  if (!anonKey || !serviceRoleKey) {
    throw new Error("Unable to read local Supabase keys from 'supabase status -o env'.");
  }

  return {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    EXPO_PUBLIC_SUPABASE_URL: supabaseUrl,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    EXPO_PUBLIC_E2E_DISABLE_ANIMATIONS: '1',
    SUCKER_E2E_FIXED_DIE: '1',
    E2E_BASE_URL: process.env.E2E_BASE_URL || 'http://127.0.0.1:8081',
  };
}

function readEnvFile(filePath = envFilePath) {
  return parseEnv(fs.readFileSync(filePath, 'utf8'));
}

function writeLocalTestEnvFile(filePath = envFilePath) {
  const env = buildLocalTestEnv();
  const contents = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  fs.writeFileSync(filePath, `${contents}\n`, 'utf8');
  return env;
}

module.exports = {
  buildLocalTestEnv,
  envFilePath,
  readEnvFile,
  supabaseCliPath,
  writeLocalTestEnvFile,
};

if (require.main === module) {
  writeLocalTestEnvFile();
  console.log('Wrote .env.e2e.local');
}

