#!/usr/bin/env node

// Reads Sucker! errors from Exceptionless.
//
//   npm run errors                       open error stacks seen in the last 7 days
//   npm run errors -- stacks --days 30   widen the window
//   npm run errors -- events <stackId>   recent occurrences of one stack
//   npm run errors -- event <eventId>    one occurrence as JSON
//   npm run errors -- login              sign in and save a read token
//
// Auth uses a user API token (project client keys can only submit events), read
// from EXCEPTIONLESS_API_TOKEN or the macOS keychain item "sucker-exceptionless".
// `login` exchanges your Exceptionless email and password for one and saves it.
// EXCEPTIONLESS_PROJECT_ID picks the project; otherwise the one named Sucker is used.

const { execFileSync } = require('node:child_process');
const readline = require('node:readline');

const apiUrl = (process.env.EXCEPTIONLESS_API_URL || 'https://api.exceptionless.io').replace(/\/$/, '');

async function main() {
  const [command = 'stacks', ...rest] = process.argv.slice(2);
  const options = parseOptions(rest);
  if (command === 'login') {
    await login();
    return;
  }

  const token = readToken();

  if (command === 'stacks') {
    const projectId = await resolveProjectId(token);
    const days = Number(options.days ?? 7);
    const stacks = await get(token, `/projects/${projectId}/events`, {
      filter: options.filter ?? 'type:error (status:open OR status:regressed)',
      limit: options.limit ?? 50,
      mode: 'stack_recent',
      time: `last ${days} days`,
    });
    printStacks(stacks);
  } else if (command === 'events') {
    const stackId = requireArgument(options._[0], 'stackId');
    const events = await get(token, `/stacks/${stackId}/events`, { limit: options.limit ?? 10 });
    for (const event of events) printEvent(event);
  } else if (command === 'event') {
    const eventId = requireArgument(options._[0], 'eventId');
    console.log(JSON.stringify(await get(token, `/events/${eventId}`), null, 2));
  } else if (command === 'projects') {
    for (const project of await get(token, '/projects', { limit: 1000 })) console.log(`${project.id}  ${project.name}`);
  } else {
    throw new Error(`Unknown command "${command}". Use stacks, events, event, projects, or login.`);
  }
}

function printStacks(stacks) {
  if (!stacks.length) {
    console.log('No matching error stacks.');
    return;
  }

  for (const stack of stacks) {
    const tags = stack.data?.Tags?.length ? `  [${stack.data.Tags.join(', ')}]` : '';
    console.log(
      `${stack.id}  ${String(stack.total).padStart(5)}x  ${String(stack.users ?? 0).padStart(3)} users  ` +
        `last ${formatDate(stack.last_occurrence)}  ${stack.status ?? ''}${tags}`,
    );
    console.log(`    ${stack.title}`);
  }
}

function printEvent(event) {
  const data = event.data ?? {};
  const error = data['@error'] ?? data['@simple_error'];
  const properties = Object.entries(data).filter(([key]) => !key.startsWith('@'));
  console.log(`--- ${event.id}  ${formatDate(event.date)}  ${event.source ?? ''}  [${(event.tags ?? []).join(', ')}]`);
  console.log(`    ${error?.type ?? event.type}: ${error?.message ?? event.message ?? ''}`);
  if (data['@version']) console.log(`    version ${data['@version']}`);
  if (data['@user']?.identity) console.log(`    user ${data['@user'].identity}`);
  for (const [key, value] of properties) {
    const text = key === 'ComponentStack' ? summarizeComponentStack(value) : JSON.stringify(value);
    console.log(`    ${key}: ${text}`);
  }
  const frames = error?.stack_trace;
  if (Array.isArray(frames)) {
    for (const frame of frames.slice(0, 8)) {
      console.log(
        `      at ${frame.name ?? '?'} (${String(frame.file_name ?? '?').replace(/^.*\//, '')}:${frame.line_number ?? '?'}${frame.column ? `:${frame.column}` : ''})`,
      );
    }
  } else if (typeof frames === 'string' && frames) {
    for (const line of frames.split('\n').slice(0, 8)) console.log(`      ${line.trim().replace(/\/\S*\//, '')}`);
  }
}

function summarizeComponentStack(value) {
  const components = String(value).match(/at [^\s(]+/g) ?? [];
  return components
    .slice(0, 6)
    .map((frame) => frame.slice(3))
    .join(' < ');
}

async function resolveProjectId(token) {
  if (process.env.EXCEPTIONLESS_PROJECT_ID) return process.env.EXCEPTIONLESS_PROJECT_ID;
  const projects = await get(token, '/projects', { limit: 1000 });
  const matches = projects.filter((project) => /sucker/i.test(project.name));
  if (matches.length === 1) return matches[0].id;
  const names = projects.map((project) => `${project.id} ${project.name}`).join('\n  ');
  throw new Error(`Set EXCEPTIONLESS_PROJECT_ID to one of:\n  ${names}`);
}

async function get(token, path, query = {}) {
  const url = new URL(`${apiUrl}/api/v2${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url.pathname}: ${await response.text()}`);
  }
  return response.json();
}

async function login() {
  const email = await prompt('Exceptionless email: ');
  const password = await prompt('Password: ', { hidden: true });
  const response = await fetch(`${apiUrl}/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`Login failed: ${response.status} ${response.statusText} ${await response.text()}`);
  }

  const { token } = await response.json();
  execFileSync('security', ['add-generic-password', '-U', '-s', 'sucker-exceptionless', '-a', 'api', '-w', token]);
  console.log('Saved the token to the keychain item "sucker-exceptionless".');
}

function prompt(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    rl._writeToOutput = (text) => {
      if (text.startsWith(question)) rl.output.write(question);
    };
  }

  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      if (hidden) rl.output.write('\n');
      rl.close();
      resolve(answer.trim());
    }),
  );
}

function readToken() {
  const fromEnv = process.env.EXCEPTIONLESS_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'sucker-exceptionless', '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error('No Exceptionless API token. Run `npm run errors -- login` or set EXCEPTIONLESS_API_TOKEN.');
  }
}

function parseOptions(args) {
  const options = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith('--')) options[args[index].slice(2)] = args[++index];
    else options._.push(args[index]);
  }
  return options;
}

function requireArgument(value, name) {
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function formatDate(value) {
  return value ? new Date(value).toISOString().replace('T', ' ').slice(0, 16) : '?';
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
