#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const args = process.argv.slice(2);
const devServerFile = path.resolve(process.cwd(), process.env.SUCKER_DEV_SERVER_FILE || '.build/dev-server.json');
const ansiPattern = /\u001b\[[0-9;]*m/g;
const localUrlPattern = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)(?:\/[^\s"'`<]*)?/g;
const defaultPortStart = Number(process.env.SUCKER_WEB_PORT_START || 8200);
const defaultPortEnd = Number(process.env.SUCKER_WEB_PORT_END || 8999);
let outputBuffer = '';
let latestServer = null;
let child = null;
let forwardedArgs = [...args];

function hasPortArg(values) {
  return values.some((value) => value === '--port' || value === '-p' || value.startsWith('--port='));
}

function getProvidedPort(values) {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value === '--port' || value === '-p') {
      return values[index + 1] || null;
    }

    if (value.startsWith('--port=')) {
      return value.slice('--port='.length);
    }
  }

  return null;
}

function getExpoCliPath() {
  const expoCliPath = path.resolve(process.cwd(), 'node_modules/expo/bin/cli');

  if (!fs.existsSync(expoCliPath)) {
    throw new Error('Could not resolve Expo CLI. Run npm install before npm run web.');
  }

  return expoCliPath;
}

function isLinkedGitWorktree() {
  try {
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const commonGitDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    return path.resolve(process.cwd(), gitDir) !== path.resolve(process.cwd(), commonGitDir);
  } catch {
    return false;
  }
}

function getStandardPort() {
  return Number(process.env.SUCKER_STANDARD_WEB_PORT || 8081);
}
function getPreferredPort() {
  const portCount = defaultPortEnd - defaultPortStart + 1;
  if (!Number.isInteger(defaultPortStart) || !Number.isInteger(defaultPortEnd) || portCount < 1) {
    throw new Error('Invalid SUCKER_WEB_PORT_START/SUCKER_WEB_PORT_END range.');
  }

  const hash = crypto.createHash('sha256').update(process.cwd().toLowerCase()).digest();
  const offset = hash.readUInt32BE(0) % portCount;
  return defaultPortStart + offset;
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort() {
  const portCount = defaultPortEnd - defaultPortStart + 1;
  const preferredPort = getPreferredPort();
  const preferredOffset = preferredPort - defaultPortStart;

  for (let attempts = 0; attempts < portCount; attempts += 1) {
    const port = defaultPortStart + ((preferredOffset + attempts) % portCount);
    if (await canListenOnPort(port)) {
      return port;
    }
  }

  throw new Error(`Could not find an open port between ${defaultPortStart} and ${defaultPortEnd}.`);
}

function writeDevServerFile(server) {
  fs.mkdirSync(path.dirname(devServerFile), { recursive: true });

  const payload = {
    ...server,
    file: devServerFile,
    updatedAt: new Date().toISOString(),
  };
  const tempFile = `${devServerFile}.${process.pid}.tmp`;

  fs.writeFileSync(tempFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tempFile, devServerFile);
}

function rememberServer(url, port, status = 'running') {
  const server = {
    url,
    port: Number(port),
    status,
    pid: child?.pid ?? process.pid,
    cwd: process.cwd(),
    command: ['expo', 'start', '--web', ...forwardedArgs].join(' '),
  };

  if (latestServer?.url === server.url && latestServer?.status === server.status) {
    return;
  }

  latestServer = server;
  writeDevServerFile(server);
}

function inspectOutput(chunk) {
  outputBuffer = `${outputBuffer}${chunk.toString().replace(ansiPattern, '')}`;
  outputBuffer = outputBuffer.slice(-4000);

  for (const match of outputBuffer.matchAll(localUrlPattern)) {
    rememberServer(match[0], match[1]);
  }
}

function stopChild() {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
}

async function main() {
  const providedPort = getProvidedPort(forwardedArgs);

  if (!hasPortArg(forwardedArgs)) {
    const port = isLinkedGitWorktree() ? await findAvailablePort() : getStandardPort();
    forwardedArgs.push('--port', String(port));
    rememberServer(`http://localhost:${port}`, port, 'starting');
  } else if (providedPort && providedPort !== '0') {
    rememberServer(`http://localhost:${providedPort}`, providedPort, 'starting');
  }

  try {
    child = spawn(process.execPath, [getExpoCliPath(), 'start', '--web', ...forwardedArgs], {
      stdio: ['inherit', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    inspectOutput(chunk);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    inspectOutput(chunk);
  });

  child.on('error', (error) => {
    console.error(error.message);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (latestServer) {
      writeDevServerFile({
        ...latestServer,
        status: 'stopped',
        stoppedAt: new Date().toISOString(),
      });
    }

    if (signal) {
      process.exit(1);
      return;
    }

    process.exit(code ?? 0);
  });

  process.on('SIGINT', stopChild);
  process.on('SIGTERM', stopChild);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});