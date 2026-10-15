#!/usr/bin/env node

// Save infrastructure metadata only. Never persist raw logs, request URLs,
// request bodies, container environment, or health-check output as artifacts.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results', 'supabase');
const gatewayErrors = {
  prematureClose: 'upstream prematurely closed connection',
  connectionReset: 'Connection reset by peer',
  connectionRefused: 'Connection refused',
  timeout: 'upstream timed out',
  dnsFailure: 'DNS resolution failed',
};

try {
  fs.mkdirSync(output, { recursive: true });
  const config = fs.readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8');
  const project = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  if (!project) throw new Error('Missing local project ID');
  const options = { encoding: 'utf8', timeout: 15_000, maxBuffer: 32 * 1024 * 1024 };
  const names = execFileSync(
    'docker',
    ['ps', '-a', '--filter', `label=com.supabase.cli.project=${project}`, '--format', '{{.Names}}'],
    options,
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  const diagnostics = names.map((name) => {
    const state = JSON.parse(
      execFileSync(
        'docker',
        [
          'inspect',
          '--format',
          '{"image":{{json .Config.Image}},"status":{{json .State.Status}},"exitCode":{{.State.ExitCode}},"oomKilled":{{.State.OOMKilled}}}',
          name,
        ],
        options,
      ),
    );
    if (name.startsWith('supabase_kong_')) {
      const logs = spawnSync('docker', ['logs', name], options);
      const text = `${logs.stdout || ''}\n${logs.stderr || ''}`;
      state.gatewayErrorCounts = Object.fromEntries(
        Object.entries(gatewayErrors).map(([key, message]) => [key, text.split(message).length - 1]),
      );
      state.logReadSucceeded = logs.status === 0;
    }
    return { name, ...state };
  });
  fs.writeFileSync(path.join(output, 'infrastructure.json'), `${JSON.stringify(diagnostics, null, 2)}\n`);
  console.log('Saved sanitized Supabase infrastructure diagnostics.');
} catch {
  // Error objects from child_process may themselves contain raw command output.
  console.error('Unable to collect Supabase infrastructure diagnostics.');
}
