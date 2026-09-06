const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

test('revoked permission does not leave an older installation registered at sign-out', async () => {
  const events = [];
  const filters = [];
  const notifications = {
    setNotificationHandler: () => undefined,
    getPermissionsAsync: async () => ({ status: 'denied' }),
    requestPermissionsAsync: async () => { throw new Error('Cleanup must not prompt'); },
    getExpoPushTokenAsync: async () => { events.push('discover'); return { data: 'legacy-device-token' }; },
    setBadgeCountAsync: async () => undefined,
  };
  const query = {
    eq: (column, value) => { filters.push([column, value]); return query; },
    then: (resolve) => { events.push('delete'); return Promise.resolve({ error: null }).then(resolve); },
  };
  const modules = {
    'expo-constants': { __esModule: true, default: { easConfig: { projectId: 'project' } } },
    'expo-device': { isDevice: true },
    'expo-notifications': notifications,
    'react-native': { Platform: { OS: 'ios' } },
    './authStorage': { authStorage: { getItem: async () => null, removeItem: async () => { events.push('forget'); } } },
    './supabase': { supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'alice' } } }, error: null }) },
      from: (table) => { assert.equal(table, 'push_tokens'); return { delete: () => query }; },
    } },
  };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/multiplayer/notifications.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (name) => {
    assert.ok(modules[name], `Unexpected dependency ${name}`); return modules[name];
  } });
  await exports.signOutWithNotificationCleanup(async () => { events.push('sign-out'); });
  console.log(`Legacy denied-permission cleanup: ${events.join(' -> ')}`);
  assert.deepEqual(events, ['discover', 'delete', 'sign-out', 'forget']);
  assert.deepEqual(filters, [['profile_id', 'alice'], ['expo_push_token', 'legacy-device-token']]);
});
