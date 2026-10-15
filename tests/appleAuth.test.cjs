const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function compile(file) {
  return ts.transpileModule(readFileSync(require.resolve(file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const appleSource = compile('../src/multiplayer/appleAuth.ts');
const authSource = compile('../src/multiplayer/auth.ts');
const session = {
  access_token: 'linked-account-access-token',
  refresh_token: 'linked-account-token',
  user: { id: 'existing-player', identities: [{ provider: 'apple' }] },
};
const identityExports = {};
vm.runInNewContext(compile('../src/multiplayer/appleIdentity.ts'), { exports: identityExports });

function loadApple({
  platform = 'ios',
  available = true,
  configured = true,
  appleError,
  token = 'apple-token',
  authError,
  user = session.user,
  linkSession = session,
  refreshedSession = session,
  refreshError = null,
  userAfterApple = user,
  storedSessionAfterLink = linkSession,
  synchronizedUser = session.user,
  synchronizationError = null,
  throwRefreshError = false,
  throwSynchronizationError = false,
  sessionAfterSynchronization,
} = {}) {
  const calls = [];
  const activity = [];
  let nextNonce = 0;
  let userReads = 0;
  let storedSession = null;
  const refreshInputs = [];
  const signOutOptions = [];
  const synchronizationTokens = [];
  const authResult = { data: { session }, error: authError ?? null };
  const modules = {
    './appleIdentity': identityExports,
    'expo-apple-authentication': {
      isAvailableAsync: async () => {
        activity.push('check-apple-availability');
        return available;
      },
      AppleAuthenticationScope: { EMAIL: 1 },
      signInAsync: async (options) => {
        calls.push(['apple', options]);
        if (appleError) throw appleError;
        return { identityToken: token };
      },
    },
    'expo-crypto': {
      randomUUID: () => `nonce-${++nextNonce}`,
      CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
      digestStringAsync: async (_algorithm, value) => createHash('sha256').update(value).digest('hex'),
    },
    'react-native': {
      Platform: { OS: platform },
    },
    './supabase': {
      isMultiplayerConfigured: configured,
      supabase: {
        auth: {
          getUser: async (accessToken) => {
            activity.push('get-user');
            if (accessToken) {
              synchronizationTokens.push(accessToken);
              if (sessionAfterSynchronization !== undefined) storedSession = sessionAfterSynchronization;
              if (throwSynchronizationError) throw synchronizationError;
              return { data: { user: synchronizationError ? null : synchronizedUser }, error: synchronizationError };
            }
            return { data: { user: userReads++ === 0 ? user : userAfterApple }, error: null };
          },
          signInWithIdToken: async (credentials) => {
            calls.push(['signIn', credentials]);
            return authResult;
          },
          linkIdentity: async (credentials) => {
            calls.push(['link', credentials]);
            storedSession = storedSessionAfterLink;
            return { data: { session: linkSession }, error: authError ?? null };
          },
          refreshSession: async (input) => {
            activity.push('refresh-session');
            refreshInputs.push(input);
            if (throwRefreshError) throw refreshError;
            if (input && refreshedSession && !refreshError) storedSession = refreshedSession;
            return { data: { session: refreshError ? null : refreshedSession }, error: refreshError };
          },
          getSession: async () => ({ data: { session: storedSession }, error: null }),
          signOut: async (options) => {
            signOutOptions.push(options);
            storedSession = null;
            return { error: null };
          },
        },
      },
    },
  };
  const exports = {};
  vm.runInNewContext(appleSource, {
    exports,
    require: (name) => {
      assert.ok(modules[name], `Unexpected dependency ${name}`);
      return modules[name];
    },
  });
  return {
    authenticate: exports.authenticateWithApple,
    calls,
    activity,
    refreshInputs,
    signOutOptions,
    synchronizationTokens,
    getStoredSession: () => storedSession,
  };
}

test('native Apple sign-in sends a fresh hashed nonce to Apple and the raw nonce to Supabase', async () => {
  const { authenticate, calls } = loadApple();
  assert.equal(await authenticate(), session);
  assert.equal(await authenticate(), session);
  for (let attempt = 0; attempt < 2; attempt++) {
    const [apple, signIn] = calls.slice(attempt * 2, attempt * 2 + 2);
    assert.equal(apple[0], 'apple');
    assert.equal(signIn[0], 'signIn');
    assert.equal(signIn[1].provider, 'apple');
    assert.equal(signIn[1].token, 'apple-token');
    assert.equal(signIn[1].nonce, `nonce-${attempt + 1}`);
    assert.equal(apple[1].nonce, createHash('sha256').update(signIn[1].nonce).digest('hex'));
  }
});

test('native linking attaches the Apple identity to the signed-in player without signing in as a different user', async () => {
  const { authenticate, calls } = loadApple();
  assert.equal(await authenticate('link'), session);
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['apple', 'link'],
  );
  assert.equal(calls[1][1].nonce, 'nonce-1');
});

test('linking requires an existing signed-in player', async () => {
  const { authenticate, calls } = loadApple({ user: null });
  await assert.rejects(authenticate('link'), /existing account/);
  assert.equal(calls.length, 0);
});

test('linking refreshes stale identity data before reporting success', async () => {
  const stale = { user: { id: 'existing-player', identities: [{ provider: 'email' }] } };
  const { authenticate, activity } = loadApple({ user: stale.user, linkSession: stale });
  const linked = await authenticate('link');
  assert.equal(linked, session);
  assert.equal(identityExports.hasAppleIdentity(linked.user), true);
  assert.equal(activity.filter((entry) => entry === 'refresh-session').length, 1);
});

test('a successful link reloads the authoritative user when refresh fails or has stale identity data', async () => {
  const stale = { ...session, user: { id: 'existing-player', identities: [{ provider: 'email' }] } };
  for (const options of [
    { refreshError: new Error('Network unavailable') },
    { refreshError: new Error('Network unavailable'), throwRefreshError: true },
    { refreshedSession: null },
    { refreshedSession: stale },
  ]) {
    const auth = loadApple({ linkSession: stale, ...options });
    const result = await auth.authenticate('link');
    assert.equal(result.user, session.user);
    assert.deepEqual(auth.synchronizationTokens, [session.access_token]);
    assert.equal(auth.calls.filter(([kind]) => kind === 'link').length, 1);
    assert.equal(auth.signOutOptions.length, 0);
  }
});

test('losing connectivity after linking preserves the successful session without linking again', async () => {
  const stale = { ...session, user: { id: 'existing-player', identities: [] } };
  for (const throwSynchronizationError of [false, true]) {
    const auth = loadApple({
      linkSession: stale,
      refreshError: new Error('Offline'),
      synchronizationError: new Error('Offline'),
      throwSynchronizationError,
    });
    assert.equal(await auth.authenticate('link'), stale);
    assert.equal(auth.getStoredSession(), stale);
    assert.equal(auth.calls.filter(([kind]) => kind === 'link').length, 1);
  }
});

test('follow-up user synchronization cannot return another account or restore a signed-out account', async () => {
  const other = { ...session, user: { id: 'other-player' } };
  for (const options of [
    { synchronizedUser: other.user },
    { sessionAfterSynchronization: other },
    { sessionAfterSynchronization: null },
  ]) {
    const auth = loadApple({ refreshError: new Error('Offline'), ...options });
    await assert.rejects(auth.authenticate('link'), /account changed/);
    assert.equal(auth.getStoredSession(), null);
  }
});

test('refresh uses the linked session even if another account becomes current during linking', async () => {
  const other = { refresh_token: 'other-token', user: { id: 'other-player' } };
  const auth = loadApple({ storedSessionAfterLink: other });
  assert.equal(await auth.authenticate('link'), session);
  assert.deepEqual(auth.refreshInputs, [session]);
  assert.equal(auth.getStoredSession(), session);
});

test('account changes while the Apple sheet is open abort linking', async () => {
  for (const userAfterApple of [null, { id: 'other-player' }]) {
    const auth = loadApple({ userAfterApple });
    await assert.rejects(auth.authenticate('link'), /account changed/);
    assert.deepEqual(
      auth.calls.map(([kind]) => kind),
      ['apple'],
    );
    assert.equal(auth.refreshInputs.length, 0);
  }
});

test('mismatched link or refresh results are removed from active auth storage', async () => {
  const other = { refresh_token: 'other-token', user: { id: 'other-player', identities: [{ provider: 'apple' }] } };
  for (const options of [{ linkSession: other }, { refreshedSession: other }]) {
    const auth = loadApple(options);
    await assert.rejects(auth.authenticate('link'), /account changed/);
    assert.equal(auth.getStoredSession(), null);
    assert.equal(auth.signOutOptions.length, 1);
    assert.equal(auth.signOutOptions[0].scope, 'local');
    if (options.linkSession) assert.equal(auth.refreshInputs.length, 0);
  }
});

test('Apple connection recognizes identity and server provider metadata, never editable user metadata', () => {
  for (const user of [
    session.user,
    { app_metadata: { providers: ['email', 'apple'] } },
    { app_metadata: { provider: 'apple' } },
  ]) {
    assert.equal(identityExports.hasAppleIdentity(user), true);
  }
  for (const user of [
    {},
    { identities: [{ provider: 'email' }], app_metadata: { providers: ['email'] } },
    { user_metadata: { provider: 'apple', providers: ['apple'] } },
  ]) {
    assert.equal(identityExports.hasAppleIdentity(user), false);
  }
});

test('canceling native Apple sign-in does not call Supabase', async () => {
  const { authenticate, calls } = loadApple({ appleError: { code: 'ERR_REQUEST_CANCELED' } });
  assert.equal(await authenticate(), null);
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['apple'],
  );
});

test('missing Apple tokens and native failures do not create sessions', async () => {
  const missing = loadApple({ token: null });
  await assert.rejects(missing.authenticate(), /did not return a sign-in token/);
  assert.equal(missing.calls.length, 1);
  const failure = new Error('Apple unavailable');
  await assert.rejects(loadApple({ appleError: failure }).authenticate(), (error) => error === failure);
});

test('unavailable devices and missing configuration cannot start sign-in', async () => {
  for (const options of [{ available: false }, { configured: false }]) {
    const { authenticate, calls } = loadApple(options);
    await assert.rejects(authenticate(), /not (available|configured)/);
    assert.equal(calls.length, 0);
  }
});

for (const platform of ['web', 'android']) {
  for (const action of ['signIn', 'link']) {
    test(`${platform} cannot start Apple ${action} or contact the provider`, async () => {
      const { authenticate, calls, activity } = loadApple({ platform });
      await assert.rejects(authenticate(action), /only available in the iOS app/);
      assert.deepEqual(calls, []);
      assert.deepEqual(activity, []);
    });
  }
}

test('Supabase linking errors propagate without signing in to a different account', async () => {
  const authError = new Error('Identity already belongs to another account');
  const { authenticate, calls } = loadApple({ authError });
  await assert.rejects(authenticate('link'), (error) => error === authError);
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['apple', 'link'],
  );
});

function loadCallback(error = null) {
  const exchanges = [];
  const clearedUrls = [];
  const modules = {
    'react-native': { Platform: { OS: 'web' } },
    'expo-router': { router: { setParams() {} } },
    './env': {},
    './authStorage': {},
    './sessionRecovery': {},
    './notifications': {},
    './supabase': {
      supabase: {
        auth: {
          exchangeCodeForSession: async (code) => {
            exchanges.push(code);
            return { data: { session }, error };
          },
        },
      },
    },
  };
  const exports = {};
  vm.runInNewContext(authSource, {
    exports,
    URL,
    URLSearchParams,
    document: { title: 'Sucker!' },
    window: {
      location: {
        href: 'https://play.sucker.games/?code=apple-code',
        origin: 'https://play.sucker.games',
        pathname: '/',
      },
      history: { replaceState: (_state, _title, url) => clearedUrls.push(url) },
    },
    require: (name) => {
      assert.ok(modules[name], `Unexpected dependency ${name}`);
      return modules[name];
    },
  });
  return { ...exports, exchanges, clearedUrls };
}

test('auth callbacks exchange the PKCE code and remove it from browser history', async () => {
  const callback = loadCallback();
  assert.equal(await callback.createSessionFromAuthUrl('https://play.sucker.games?code=apple-code'), session);
  assert.deepEqual(callback.exchanges, ['apple-code']);
  assert.deepEqual(callback.clearedUrls, ['https://play.sucker.games/']);
});

test('OAuth cancellation is quiet but linking conflicts and invalid codes remain visible', async () => {
  const callback = loadCallback();
  assert.equal(await callback.createSessionFromAuthUrl('https://play.sucker.games?error=access_denied'), null);
  await assert.rejects(
    callback.createSessionFromAuthUrl(
      'https://play.sucker.games?error=access_denied&error_code=identity_already_exists&error_description=Already+linked',
    ),
    /Already linked/,
  );
  assert.equal(callback.exchanges.length, 0);
  const invalid = loadCallback(new Error('Code expired'));
  await assert.rejects(invalid.createSessionFromAuthUrl('https://play.sucker.games?code=expired'), /Code expired/);
  assert.equal(invalid.clearedUrls.length, 1);
});
