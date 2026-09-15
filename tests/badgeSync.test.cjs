const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = readFileSync(require.resolve('../src/multiplayer/notifications.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function loadBadgeSync({ getRegistration = async () => null, setBadgeCountAsync = async () => {} } = {}) {
  const title = { textContent: 'Sucker!' };
  const exports = {};
  const mocks = {
    'react-native': { Platform: { OS: 'web' } },
    'expo-notifications': { setNotificationHandler() {}, setBadgeCountAsync },
    'expo-constants': {},
    'expo-device': {},
    './authStorage': {},
    './supabase': {},
  };
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
      return mocks[name];
    },
    navigator: { serviceWorker: { getRegistration } },
    document: { querySelector: () => title },
  });
  return { sync: exports.syncAppBadgeCount, title };
}

test('a delayed web badge lookup cannot overwrite a newer turn count', async () => {
  const lookup = deferred();
  const started = deferred();
  const counts = [];
  let lookups = 0;
  const { sync, title } = loadBadgeSync({
    getRegistration: () => {
      if (++lookups === 1) {
        started.resolve();
        return lookup.promise;
      }
      return Promise.resolve(null);
    },
    setBadgeCountAsync: async (count) => {
      counts.push(count);
    },
  });
  const older = sync(2);
  await started.promise;
  const newer = sync(1);
  // Give the newer request a chance to overtake the pending lookup.
  await new Promise(setImmediate);
  lookup.resolve(null);
  await Promise.all([older, newer]);
  assert.deepEqual(counts, [2, 1]);
  assert.equal(title.textContent, '(1) Sucker!');
});

test('clearing the badge waits for an older SDK write and leaves no stale count', async () => {
  const write = deferred();
  const started = deferred();
  let iconCount = 0;
  const { sync, title } = loadBadgeSync({
    setBadgeCountAsync: async (count) => {
      if (count === 2) {
        started.resolve();
        await write.promise;
      }
      iconCount = count;
    },
  });
  const older = sync(2);
  await started.promise;
  const clear = sync(0);
  await new Promise(setImmediate);
  write.resolve();
  await Promise.all([older, clear]);
  assert.equal(iconCount, 0);
  assert.equal(title.textContent, 'Sucker!');
});

test('an unsupported badge API does not prevent later title updates', async () => {
  const { sync, title } = loadBadgeSync({
    setBadgeCountAsync: async () => {
      throw new Error('Badges unavailable');
    },
  });
  await Promise.all([sync(2), sync(1), sync(0)]);
  assert.equal(title.textContent, 'Sucker!');
});
