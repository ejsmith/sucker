const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const envFilePath = path.resolve(__dirname, '..', 'supabase', '.temp', 'e2e.env');
const expoEnvFilePath = path.resolve(__dirname, '..', '.env.local');
const supabaseCliPath = path.resolve(__dirname, '..', 'node_modules', 'supabase', 'dist', 'supabase.js');
const supabaseConfigPath = path.resolve(__dirname, '..', 'supabase', 'config.toml');
const ciDisabledSupabaseConfigSections = new Set(['inbucket', 'realtime', 'storage', 'studio']);
const minimalSupabaseStartExclude = [
  'studio',
  'storage-api',
  'imgproxy',
  'mailpit',
  'realtime',
  'logflare',
  'vector',
  'postgres-meta',
  'edge-runtime',
  'supavisor',
];

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

function runSupabase(args) {
  execFileSync(process.execPath, [supabaseCliPath, ...args], { stdio: 'inherit' });
}

function disableSupabaseConfigSections(config) {
  let section = '';

  return config
    .split(/\r?\n/)
    .map((line) => {
      const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
      if (sectionMatch) {
        section = sectionMatch[1];
      }

      if (ciDisabledSupabaseConfigSections.has(section) && /^\s*enabled\s*=\s*true\s*$/.test(line)) {
        return line.replace('true', 'false');
      }

      return line;
    })
    .join('\n');
}

function withCiMinimalSupabaseConfig(callback) {
  if (process.env.CI !== 'true') {
    callback();
    return;
  }

  const originalConfig = fs.readFileSync(supabaseConfigPath, 'utf8');
  fs.writeFileSync(supabaseConfigPath, `${disableSupabaseConfigSections(originalConfig)}\n`, 'utf8');

  try {
    callback();
  } finally {
    fs.writeFileSync(supabaseConfigPath, originalConfig, 'utf8');
  }
}

function startMinimalSupabase() {
  withCiMinimalSupabaseConfig(() => {
    runSupabase(['start', '--exclude', minimalSupabaseStartExclude.join(',')]);
  });
}

function shouldResetSupabaseDatabase() {
  return process.env.CI !== 'true' && process.env.SUPABASE_SKIP_DB_RESET !== '1';
}

function resetSupabaseDatabaseIfNeeded() {
  if (!shouldResetSupabaseDatabase()) {
    console.log('Skipping Supabase db reset; startup already applies migrations in CI.');
    return;
  }

  runSupabase(['db', 'reset', '--no-seed']);
}

function writeLocalTestEnvFile(filePath = envFilePath) {
  const env = buildLocalTestEnv();
  const contents = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  fs.writeFileSync(filePath, `${contents}\n`, 'utf8');
  fs.writeFileSync(expoEnvFilePath, `${contents}\n`, 'utf8');
  return env;
}

module.exports = {
  buildLocalTestEnv,
  envFilePath,
  expoEnvFilePath,
  minimalSupabaseStartExclude,
  readEnvFile,
  resetSupabaseDatabaseIfNeeded,
  runSupabase,
  shouldResetSupabaseDatabase,
  startMinimalSupabase,
  supabaseCliPath,
  writeLocalTestEnvFile,
};

if (require.main === module) {
  writeLocalTestEnvFile();
  console.log('Wrote supabase/.temp/e2e.env and .env.local');
}
