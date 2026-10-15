const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(readFileSync(require.resolve('../src/multiplayer/auth.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadProfile({ error = null, user = { id: 'new-apple-player' } } = {}) {
  const calls = [];
  const profile = { id: user?.id, display_name: 'Player', username: null, needs_profile_setup: true };
  let updates;
  const query = {
    update: (value) => {
      updates = value;
      calls.push(['update', value]);
      return query;
    },
    eq: (key, value) => {
      calls.push(['eq', key, value]);
      return query;
    },
    select: () => query,
    single: async () => {
      if (error) return { data: null, error };
      Object.assign(profile, updates);
      return { data: profile, error: null };
    },
  };
  const modules = {
    'react-native': { Platform: { OS: 'ios' } },
    'expo-router': { router: {} },
    './env': {},
    './authStorage': {},
    './sessionRecovery': {},
    './notifications': {},
    './supabase': {
      supabase: {
        auth: {
          getUser: async () => {
            calls.push(['getUser']);
            return { data: { user }, error: null };
          },
        },
        from: (table) => {
          assert.equal(table, 'profiles');
          return query;
        },
      },
    },
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    require: (name) => {
      assert.ok(modules[name], `Unexpected dependency ${name}`);
      return modules[name];
    },
  });
  return { save: exports.upsertProfile, calls, profile };
}

test('profile setup saves the chosen name and completion together on the existing player', async () => {
  const { save, calls, profile } = loadProfile();
  await save({ displayName: '  Lucky Roller  ', username: ' ', completeSetup: true });
  assert.equal(profile.display_name, 'Lucky Roller');
  assert.equal(profile.username, null);
  assert.equal(profile.needs_profile_setup, false);
  assert.equal(calls.filter(([kind]) => kind === 'update').length, 1);
  assert.deepEqual(
    calls.find(([kind]) => kind === 'eq'),
    ['eq', 'id', 'new-apple-player'],
  );
});

test('setup accepts an optional username and does not require one', async () => {
  for (const username of [undefined, '', 'alex_rolls']) {
    const { save, profile } = loadProfile();
    await save({ displayName: 'Alex', username, completeSetup: true });
    assert.equal(profile.username, username || null);
    assert.equal(profile.needs_profile_setup, false);
  }
});

test('blank names and invalid usernames do not write or complete setup', async () => {
  for (const input of [
    { displayName: '  ' },
    { displayName: 'Alex', username: 'Alex Smith' },
    { displayName: 'Alex', username: '@alex' },
    { displayName: 'Alex', username: 'ab' },
    { displayName: 'Alex', username: 'a'.repeat(25) },
  ]) {
    const { save, calls, profile } = loadProfile();
    await assert.rejects(save({ ...input, completeSetup: true }), /Choose a name|3–24/);
    assert.equal(calls.length, 0);
    assert.equal(profile.needs_profile_setup, true);
  }
});

test('username conflicts and network errors leave setup pending', async () => {
  for (const error of [{ code: '23505' }, new Error('Network unavailable')]) {
    const { save, profile } = loadProfile({ error });
    await assert.rejects(
      save({ displayName: 'Alex', username: 'alex_rolls', completeSetup: true }),
      /username is taken|Network unavailable/,
    );
    assert.equal(profile.needs_profile_setup, true);
    assert.equal(profile.display_name, 'Player');
  }
});

test('ordinary profile edits do not change setup status', async () => {
  const { save, calls } = loadProfile();
  await save({ displayName: 'Alex', username: null });
  assert.equal(Object.hasOwn(calls.find(([kind]) => kind === 'update')[1], 'needs_profile_setup'), false);
});

test('profile setup cannot save without a signed-in player', async () => {
  const { save, calls } = loadProfile({ user: null });
  await assert.rejects(save({ displayName: 'Alex', completeSetup: true }), /signed in/);
  assert.equal(
    calls.some(([kind]) => kind === 'update'),
    false,
  );
});
