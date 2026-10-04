const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(require.resolve(file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    console,
    require: (name) => {
      assert.ok(modules[name], `Unexpected dependency ${name}`);
      return modules[name];
    },
  });
  return exports;
}

const cached = { access_token: 'account-a-token', user: { id: 'account-a', identities: [{ provider: 'email' }] } };
const linkedUser = { ...cached.user, identities: [{ provider: 'email' }, { provider: 'apple' }] };

// Execute the real hook with controlled effects and auth/network events.
function mountSession() {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let dirty = true;
  let result;
  let authListener;
  const networkListeners = new Set();
  const appListeners = new Set();
  const controls = { offline: false, profileFails: false, serverUser: cached.user, linkCalls: 0 };
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [
        slots[index].value,
        (next) => {
          const value = typeof next === 'function' ? next(slots[index].value) : next;
          if (!Object.is(value, slots[index].value)) {
            slots[index].value = value;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(fn, deps) {
      const index = cursor++;
      if (!sameDeps(slots[index]?.deps, deps)) slots[index] = { deps, value: fn };
      return slots[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!sameDeps(slots[index]?.deps, deps)) {
        const previous = slots[index];
        slots[index] = { deps };
        effects.push(() => {
          previous?.cleanup?.();
          slots[index].cleanup = fn();
        });
      }
    },
  };
  const { useMultiplayerSession } = load('../src/multiplayer/useMultiplayerSession.ts', {
    react,
    'react-native': {
      Platform: { OS: 'ios' },
      AppState: {
        addEventListener: (_event, fn) => {
          appListeners.add(fn);
          return { remove: () => appListeners.delete(fn) };
        },
      },
      Linking: { getInitialURL: async () => null, addEventListener: () => ({ remove() {} }) },
    },
    '@react-native-community/netinfo': {
      __esModule: true,
      default: {
        addEventListener: (fn) => {
          networkListeners.add(fn);
          return () => networkListeners.delete(fn);
        },
      },
    },
    './auth': { hasAuthCallbackParams: () => false, getCurrentSession: async () => cached },
    './notifications': { registerPushToken: async () => {} },
    './profiles': {
      getMyProfile: async () => {
        if (controls.profileFails) throw new Error('Profile offline');
        return { id: 'account-a', display_name: 'Player' };
      },
    },
    './env': { getE2ESession: () => null },
    './supabase': {
      isMultiplayerConfigured: true,
      supabase: {
        auth: {
          onAuthStateChange: (fn) => {
            authListener = fn;
            return { data: { subscription: { unsubscribe() {} } } };
          },
          getUser: async () => {
            if (controls.offline) throw new Error('Network offline');
            return { data: { user: controls.serverUser }, error: null };
          },
        },
      },
    },
    '../monitoring/exceptionless': { setMonitoringUser() {}, reportError: async () => {} },
    './appleIdentity': load('../src/multiplayer/appleIdentity.ts', {}),
    './appleAuth': {
      authenticateWithApple: async () => {
        controls.linkCalls++;
        return cached;
      },
    },
  });
  async function flush() {
    for (let i = 0; i < 30; i++) {
      if (dirty) {
        dirty = false;
        cursor = 0;
        result = useMultiplayerSession();
        const pending = effects;
        effects = [];
        pending.forEach((effect) => effect());
      }
      await Promise.resolve();
    }
    assert.equal(dirty, false, 'hook should settle');
  }
  return {
    controls,
    flush,
    current: () => result,
    authEvent: (session) => authListener('TOKEN_REFRESHED', session),
    reconnect: () => networkListeners.forEach((fn) => fn({ isConnected: true, isInternetReachable: true })),
    resume: () => appListeners.forEach((fn) => fn('active')),
    unmount: () => slots.forEach((slot) => slot?.cleanup?.()),
  };
}

test('successful linking remains connected through refresh/profile outages and stale auth events', async () => {
  const hook = mountSession();
  await hook.flush();
  assert.equal(hook.current().isAppleConnected, false);
  hook.controls.offline = true;
  hook.controls.profileFails = true;
  const linking = hook.current().continueWithApple('link');
  await hook.flush();
  assert.equal(await linking, cached);
  await hook.flush();
  assert.equal(hook.current().isAppleConnected, true);
  assert.equal(hook.current().error, null);
  assert.equal(hook.current().profile.id, 'account-a');
  hook.controls.profileFails = false;
  hook.authEvent(cached);
  await hook.flush();
  assert.equal(hook.current().isAppleConnected, true);
  hook.controls.offline = false;
  hook.controls.serverUser = linkedUser;
  hook.reconnect();
  await hook.flush();
  assert.equal(hook.current().session.user, linkedUser);
  assert.equal(hook.controls.linkCalls, 1);
  hook.unmount();
});

test('restoring a cached session reloads Apple status and resumes synchronization after an outage', async () => {
  const hook = mountSession();
  hook.controls.offline = true;
  await hook.flush();
  hook.controls.offline = false;
  hook.controls.serverUser = linkedUser;
  hook.resume();
  await hook.flush();
  assert.equal(hook.current().isAppleConnected, true);
  assert.equal(hook.controls.linkCalls, 0);
  hook.unmount();
  const restarted = mountSession();
  restarted.controls.serverUser = linkedUser;
  await restarted.flush();
  assert.equal(restarted.current().isAppleConnected, true);
  restarted.unmount();
});

test('a confirmed Apple connection does not transfer to another account or survive sign-out', async () => {
  const hook = mountSession();
  await hook.flush();
  hook.controls.offline = true;
  await hook.current().continueWithApple('link');
  await hook.flush();
  assert.equal(hook.current().isAppleConnected, true);
  hook.authEvent({ ...cached, user: { id: 'account-b', identities: [] } });
  await hook.flush();
  assert.equal(hook.current().isAppleConnected, false);
  hook.authEvent(null);
  await hook.flush();
  assert.equal(hook.current().session, null);
  assert.equal(hook.current().isAppleConnected, false);
  hook.unmount();
});
