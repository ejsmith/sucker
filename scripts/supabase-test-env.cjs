const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const envFilePath = path.resolve(__dirname, '..', 'supabase', '.temp', 'e2e.env');
const expoEnvFilePath = path.resolve(__dirname, '..', '.env.local');
const supabaseCliPath = path.resolve(__dirname, '..', 'node_modules', 'supabase', 'dist', 'supabase.js');
const supabaseConfigPath = path.resolve(__dirname, '..', 'supabase', 'config.toml');
const ciDisabledSupabaseConfigSections = new Set(['inbucket', 'realtime', 'studio']);
const ciSupabasePortSections = new Map([
  ['api', new Map([['port', 0]])],
  [
    'db',
    new Map([
      ['port', 1],
      ['shadow_port', 2],
    ]),
  ],
  ['db.pooler', new Map([['port', 7]])],
  ['studio', new Map([['port', 3]])],
  [
    'inbucket',
    new Map([
      ['port', 4],
      ['smtp_port', 5],
      ['pop3_port', 6],
    ]),
  ],
  ['edge_runtime', new Map([['inspector_port', 8]])],
]);
const minimalSupabaseStartExclude = [
  'studio',
  'mailpit',
  'realtime',
  'logflare',
  'vector',
  'postgres-meta',
  'edge-runtime',
  'supavisor',
];
let originalCiSupabaseConfig = null;
let didRegisterCiConfigRestore = false;

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
    SUCKER_E2E_NUDGE_COOLDOWN_MS: '1000',
    SUCKER_E2E_NUDGE_WAIT_MS: '1000',
    SUCKER_E2E_SUCKER_PUNCH_DIE: '6',
    SUCKER_E2E_SUCKER_PUNCH_ROLL: '1',
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

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function getCiSupabasePortBase() {
  const explicitBase = Number(process.env.SUCKER_SUPABASE_PORT_BASE);
  if (Number.isInteger(explicitBase) && explicitBase >= 10_000 && explicitBase <= 65_000) {
    return explicitBase;
  }

  const portSeed = [process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT, process.env.GITHUB_JOB, process.pid]
    .filter(Boolean)
    .join(':');

  return 54_000 + (hashString(portSeed) % 1_000) * 10;
}

function assignCiSupabasePorts(config) {
  const portBase = getCiSupabasePortBase();
  let section = '';

  return config
    .split(/\r?\n/)
    .map((line) => {
      const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
      if (sectionMatch) {
        section = sectionMatch[1];
        return line;
      }

      const sectionPorts = ciSupabasePortSections.get(section);
      if (!sectionPorts) {
        return line;
      }

      const portMatch = /^(\s*)([a-z_]+)(\s*=\s*)\d+(\s*)$/.exec(line);
      if (!portMatch) {
        return line;
      }

      const portOffset = sectionPorts.get(portMatch[2]);
      return portOffset === undefined
        ? line
        : `${portMatch[1]}${portMatch[2]}${portMatch[3]}${portBase + portOffset}${portMatch[4]}`;
    })
    .join('\n');
}

function prepareCiSupabaseConfig(config) {
  return assignCiSupabasePorts(disableSupabaseConfigSections(config));
}

function restoreCiSupabaseConfig() {
  if (originalCiSupabaseConfig === null) {
    return;
  }

  fs.writeFileSync(supabaseConfigPath, originalCiSupabaseConfig, 'utf8');
  originalCiSupabaseConfig = null;
}

function registerCiConfigRestore() {
  if (didRegisterCiConfigRestore) {
    return;
  }

  didRegisterCiConfigRestore = true;
  process.once('exit', restoreCiSupabaseConfig);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      restoreCiSupabaseConfig();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }
}

function useCiMinimalSupabaseConfig() {
  if (process.env.CI !== 'true') {
    return;
  }

  if (originalCiSupabaseConfig === null) {
    originalCiSupabaseConfig = fs.readFileSync(supabaseConfigPath, 'utf8');
    fs.writeFileSync(supabaseConfigPath, `${prepareCiSupabaseConfig(originalCiSupabaseConfig)}\n`, 'utf8');
    registerCiConfigRestore();
  }
}

function stopSupabaseIfCi() {
  if (process.env.CI !== 'true') {
    return;
  }

  try {
    runSupabase(['stop', '--no-backup']);
  } catch {
    console.warn('Unable to stop an existing Supabase stack before CI startup; continuing.');
  }
}

function startMinimalSupabase() {
  stopSupabaseIfCi();
  useCiMinimalSupabaseConfig();
  runSupabase(['start', '--exclude', minimalSupabaseStartExclude.join(',')]);
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
