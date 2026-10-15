const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const compiled = ts.transpileModule(readFileSync(require.resolve('../src/multiplayer/profileCache.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const alice = { id: 'alice', display_name: 'Alice', username: 'alice', avatar_url: 'alice/photo.png' };
const bob = { id: 'bob', display_name: 'Bob', username: null, avatar_url: 'bob/photo.png' };

function loadCache({ read = async () => null } = {}) {
  const exports = {};
  const writes = [];
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === './env') return { getMultiplayerConfig: () => ({ supabaseUrl: 'https://example.test' }) };
      assert.equal(name, '@react-native-async-storage/async-storage');
      return {
        getItem: read,
        setItem: async (_key, value) => writes.push(value),
        removeItem: async () => writes.push(null),
      };
    },
  });
  return { ...exports, writes };
}

test('restored profiles merge with fresh data without overwriting newer avatar changes', async () => {
  let resolve;
  const cache = loadCache({
    read: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const hydration = cache.hydrateProfileCache();
  cache.rememberProfiles([{ ...alice, avatar_url: null }]);
  resolve(JSON.stringify([alice, bob]));
  await hydration;
  assert.equal(cache.getCachedProfiles().alice.avatar_url, null);
  assert.equal(cache.getCachedProfiles().bob.avatar_url, bob.avatar_url);
});

test('sign out discards pending storage and network results and clears queued writes', async () => {
  let resolve;
  const cache = loadCache({
    read: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const hydration = cache.hydrateProfileCache();
  const requestGeneration = cache.getProfileCacheGeneration();
  cache.rememberProfiles([alice]);
  cache.clearProfileCache();
  resolve(JSON.stringify([alice, bob]));
  await hydration;
  cache.rememberProfiles([bob], requestGeneration);
  await new Promise(setImmediate);
  assert.equal(Object.keys(cache.getCachedProfiles()).length, 0);
  assert.equal(cache.writes.at(-1), null);
});

test('partial profile responses preserve other known avatars and explicit null removes a photo', () => {
  const cache = loadCache();
  let changes = 0;
  const unsubscribe = cache.subscribeToProfiles(() => changes++);
  cache.rememberProfiles([alice, bob]);
  cache.rememberProfiles([{ ...alice, avatar_url: null }]);
  assert.equal(cache.getCachedProfiles().alice.avatar_url, null);
  assert.equal(cache.getCachedProfiles().bob.avatar_url, bob.avatar_url);
  assert.equal(changes, 2);
  unsubscribe();
  cache.clearProfileCache();
  assert.equal(changes, 2);
});

test('unreadable or malformed storage does not prevent profile refresh', async () => {
  for (const read of [
    async () => {
      throw new Error('unavailable');
    },
    async () => '{',
    async () => '[null, {"id":"broken"}]',
  ]) {
    const cache = loadCache({ read });
    await cache.hydrateProfileCache();
    cache.rememberProfiles([alice]);
    assert.equal(cache.getCachedProfiles().alice.display_name, 'Alice');
  }
});

test('persistent cache stores display data without unrelated account fields', async () => {
  const cache = loadCache();
  cache.rememberProfiles([{ ...alice, access_token: 'not-display-data', email: 'private@example.test' }]);
  await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(cache.writes.at(-1)), [alice]);
});

test('avatar lookups preserve cached setup status and completing setup survives a restart', async () => {
  const cache = loadCache();
  cache.rememberProfiles([{ ...alice, needs_profile_setup: true }]);
  cache.rememberProfiles([alice]);
  assert.equal(cache.getCachedProfiles().alice.needs_profile_setup, true);
  cache.rememberProfiles([{ ...alice, needs_profile_setup: false }]);
  cache.rememberProfiles([alice]);
  await new Promise(setImmediate);
  const restored = loadCache({ read: async () => cache.writes.at(-1) });
  await restored.hydrateProfileCache();
  assert.equal(restored.getCachedProfiles().alice.needs_profile_setup, false);
});
