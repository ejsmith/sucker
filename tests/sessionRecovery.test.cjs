const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadModule(name, globals = {}) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(require.resolve(`../src/multiplayer/${name}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    require: () => ({ sessionConnectionMessage: 'Temporary connection error' }),
    ...globals,
  });
  return exports;
}
const { parseStoredSession, isTemporarySessionError } = loadModule('sessionRecovery');

test('an expired stored session remains available as a display snapshot', () => {
  const session = { access_token: 'expired', refresh_token: 'saved', expires_at: 1, user: { id: 'player' } };
  assert.equal(parseStoredSession(JSON.stringify(session)).user.id, 'player');
  for (const invalid of [
    null,
    '{',
    '{}',
    'null',
    JSON.stringify({ ...session, refresh_token: '' }),
    JSON.stringify({ ...session, user: {} }),
  ])
    assert.equal(parseStoredSession(invalid), null);
});

test('connection failures remain distinct from rejected credentials', () => {
  for (const error of [
    { name: 'AuthRetryableFetchError' },
    { name: 'AbortError' },
    { status: 429 },
    { status: 503 },
    { message: 'Network request failed' },
  ])
    assert.equal(isTemporarySessionError(error), true);
  for (const error of [
    { status: 401, code: 'invalid_jwt' },
    { status: 400, code: 'refresh_token_not_found' },
    { name: 'AuthSessionMissingError' },
  ])
    assert.equal(isTemporarySessionError(error), false);
});

test('a stalled session lookup returns a connection error without waiting for SDK retries', async () => {
  let onTimeout;
  let cleared = false;
  const { withSessionTimeout } = loadModule('sessionRecovery', {
    setTimeout: (callback, delay) => {
      assert.equal(delay, 3_000);
      onTimeout = callback;
      return 7;
    },
    clearTimeout: (id) => {
      assert.equal(id, 7);
      cleared = true;
    },
  });
  let resolve;
  const request = new Promise((done) => {
    resolve = done;
  });
  const lookup = withSessionTimeout(request);
  onTimeout();
  await assert.rejects(lookup, { name: 'SessionConnectionError' });
  assert.equal(cleared, true);
  // The underlying SDK may still finish and publish its auth event later.
  resolve({ data: { session: { user: { id: 'player' } } }, error: null });
  assert.equal((await request).data.session.user.id, 'player');
});

test('auth transport preserves infrastructure failures for SDK retry and leaves credential rejection intact', async () => {
  for (const status of [408, 429, 500, 503, 504, 599]) {
    const { fetchWithAuthRecovery } = loadModule('authFetch', { fetch: async () => ({ status }) });
    await assert.rejects(fetchWithAuthRecovery('https://example.test/auth/v1/token'), { name: 'TypeError' });
  }
  for (const status of [200, 400, 401, 403]) {
    const response = { status };
    const { fetchWithAuthRecovery } = loadModule('authFetch', { fetch: async () => response });
    assert.equal(await fetchWithAuthRecovery('https://example.test/auth/v1/token'), response);
  }
});

test('auth transport does not change game action HTTP failures', async () => {
  const response = { status: 503 };
  const { fetchWithAuthRecovery } = loadModule('authFetch', { fetch: async () => response });
  assert.equal(await fetchWithAuthRecovery('https://example.test/functions/v1/game-action'), response);
});

test('a stalled auth request is aborted and its timer is cleaned up', async () => {
  let onTimeout;
  let removedTimer = false;
  const { fetchWithAuthRecovery } = loadModule('authFetch', {
    setTimeout: (callback, delay) => {
      assert.equal(delay, 10_000);
      onTimeout = callback;
      return 42;
    },
    clearTimeout: (id) => {
      assert.equal(id, 42);
      removedTimer = true;
    },
    fetch: async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('Timeout'), { name: 'AbortError' })));
      }),
  });
  const request = fetchWithAuthRecovery('https://example.test/auth/v1/token');
  onTimeout();
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(removedTimer, true);
});
