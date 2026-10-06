import { expect, test, type Page } from '@playwright/test';
import { createGame, rollCurrentDice, scoreTurn } from '../shared/game';
import type { ComputerSession } from '../src/game/computerSession';
import type { RemoteGameRow } from '../src/multiplayer/types';

const actorId = '00000000-0000-4000-8000-000000000001';
const opponentId = '00000000-0000-4000-8000-000000000002';
const queuedOpponentId = '00000000-0000-4000-8000-000000000003';
const backend = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const sessionKey = `sb-${new URL(backend).hostname.split('.')[0]}-auth-token`;
const profileKey = `sucker.profiles.v1:${backend}`;
const user = {
  id: actorId,
  email: 'startup@example.test',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup(page: Page, signedIn = true) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const accessToken =
    [
      { alg: 'HS256', typ: 'JWT' },
      { sub: actorId, exp: expiresAt, role: 'authenticated' },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.') + '.test-only-signature';
  await page.addInitScript(
    ({ sessionKey, session, signedIn }) => {
      if (signedIn && !sessionStorage.getItem('seeded-startup-session')) {
        localStorage.setItem(sessionKey, JSON.stringify(session));
        sessionStorage.setItem('seeded-startup-session', '1');
      }
      (window as typeof window & { loginFlashed?: boolean }).loginFlashed = false;
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="login-email-input"]')) {
          (window as typeof window & { loginFlashed?: boolean }).loginFlashed = true;
        }
      }).observe(document, { childList: true, subtree: true });
    },
    {
      signedIn,
      sessionKey,
      session: {
        access_token: accessToken,
        refresh_token: 'test-refresh',
        expires_at: expiresAt,
        expires_in: 3600,
        token_type: 'bearer',
        user,
      },
    },
  );
  const profiles = [
    { id: actorId, display_name: 'Startup Tester', username: 'startup', avatar_url: null as string | null },
    { id: opponentId, display_name: 'Opponent', username: 'opponent', avatar_url: null as string | null },
    {
      id: queuedOpponentId,
      display_name: 'Photo Player',
      username: 'photo',
      avatar_url: `${backend}/storage/v1/object/public/avatars/${queuedOpponentId}/avatar.png` as string | null,
    },
  ];
  const makeGame = (id: string, opponent: (typeof profiles)[number]): RemoteGameRow => {
    const state = createGame(['Startup Tester', opponent.display_name]);
    state.players[0].id = actorId;
    state.players[1].id = opponent.id;
    return {
      id,
      state,
      status: 'active',
      created_by: actorId,
      current_player_id: actorId,
      created_at: user.created_at,
      updated_at: user.created_at,
      completed_at: null,
      last_turn_id: null,
      last_nudged_at: null,
      winner_id: null,
      sucker_tokens_spent: {},
    };
  };
  const games = [
    makeGame('00000000-0000-4000-8000-000000000004', profiles[1]),
    makeGame('00000000-0000-4000-8000-000000000005', profiles[2]),
  ];
  let blocked: Promise<void> | null = null;
  let blockProfiles = false;
  const profileRelease = deferred();
  await page.route(/\/storage\/v1\/object\/public\/avatars\//, (route) =>
    route.fulfill({
      contentType: 'image/png',
      path: 'assets/icon.png',
    }),
  );
  await page.route(/\/(?:auth|rest)\/v1\//, async (route) => {
    if (blocked) await blocked;
    const url = new URL(route.request().url());
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (url.pathname === '/rest/v1/profiles') {
      if (blockProfiles) await profileRelease.promise;
      return route.fulfill({ json: url.searchParams.get('id')?.startsWith('eq.') ? profiles[0] : profiles });
    }
    if (url.pathname === '/rest/v1/games') {
      const id = url.searchParams.get('id');
      return route.fulfill({
        json: id
          ? games.find((game) => id === `eq.${game.id}`)
          : url.searchParams.get('status') === 'neq.complete'
            ? games
            : [],
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.route(/\/functions\/v1\/game-action/, async (route) => {
    const action = route.request().postDataJSON();
    const game = games.find((game) => game.id === action.gameId)!;
    if (action.type === 'roll') game.state = rollCurrentDice(game.state, () => 0);
    if (action.type === 'score_category') {
      game.state = scoreTurn(game.state, action.category);
      game.current_player_id = game.state.players[game.state.currentPlayerIndex].id;
    }
    return route.fulfill({ json: { game } });
  });
  await page.routeWebSocket(/\/realtime\/v1\//, (socket) => socket.close());
  return {
    games,
    profiles,
    block: (promise: Promise<void>) => {
      blocked = promise;
    },
    blockProfiles: () => {
      blockProfiles = true;
    },
    releaseProfiles: profileRelease.resolve,
  };
}

test('restoring a persisted session never renders the login form', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await expect(page.getByText('Hi, Startup Tester')).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { loginFlashed?: boolean }).loginFlashed)).toBe(false);
});

test('reload renders the saved lobby and photos before server refresh completes', async ({ page }, testInfo) => {
  const fixture = await setup(page);
  await page.goto('/');
  await expect(page.getByText('Hi, Startup Tester')).toBeVisible();
  const card = page.getByTestId(`game-card-${fixture.games[1].id}`);
  await expect(card.locator('img')).toBeVisible();
  await expect.poll(() => page.evaluate((key) => Boolean(localStorage.getItem(key)), profileKey)).toBe(true);
  const refresh = deferred();
  fixture.block(refresh.promise);
  fixture.profiles[0].display_name = 'Refreshed Tester';
  try {
    await page.reload();
    await expect(page.getByText('Hi, Startup Tester')).toBeVisible();
    await expect(card).toBeVisible();
    await expect(card.locator('img')).toBeVisible();
    expect(await page.evaluate(() => (window as typeof window & { loginFlashed?: boolean }).loginFlashed)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('cached-lobby-before-refresh.png') });
  } finally {
    refresh.resolve();
  }
  await expect(page.getByText('Hi, Refreshed Tester')).toBeVisible();
});

test('signing out clears cached identity and games before the next launch', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await expect(page.getByText('Hi, Startup Tester')).toBeVisible();
  await page.getByTestId('profile-button').click();
  await page.getByTestId('sign-out-button').click();
  await expect(page.getByTestId('login-email-input')).toBeVisible();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), profileKey)).toBeNull();
  await page.reload();
  await expect(page.getByTestId('login-email-input')).toBeVisible();
  await expect(page.getByText('Hi, Startup Tester')).toHaveCount(0);
  await expect(page.getByTestId(/^game-card-/)).toHaveCount(0);
});

test('token refresh keeps the current profile visible during its background refresh', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/');
  await expect(page.getByText('Hi, Startup Tester')).toBeVisible();
  fixture.blockProfiles();
  try {
    await page.evaluate((key) => {
      const channel = new BroadcastChannel(key);
      channel.postMessage({ event: 'TOKEN_REFRESHED', session: JSON.parse(localStorage.getItem(key)!) });
      channel.close();
    }, sessionKey);
    await page.waitForTimeout(100);
    await expect(page.getByText('Hi, Startup Tester')).toBeVisible();
    await expect(page.getByTestId('login-email-input')).toHaveCount(0);
  } finally {
    fixture.releaseProfiles();
  }
});

test('a game-list request finishing after sign-out cannot restore cached games', async ({ page }) => {
  await setup(page);
  await page.goto('/');
  await expect(page.getByText('Hi, Startup Tester')).toBeVisible();
  await expect(page.getByTestId(/^game-card-/)).toHaveCount(2);
  const refresh = deferred();
  const requested = deferred();
  const completed = deferred();
  await page.route('**/rest/v1/games?**', async (route) => {
    requested.resolve();
    await refresh.promise;
    await route.fallback();
    completed.resolve();
  });
  await page.getByTestId('refresh-games-button').click();
  await requested.promise;
  await page.getByTestId('profile-button').click();
  await page.getByTestId('sign-out-button').click();
  await expect(page.getByTestId('login-email-input')).toBeVisible();
  refresh.resolve();
  await completed.promise;
  await page.waitForTimeout(100);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('sucker.multiplayerGameList.v1'))).toBeNull();
  await page.reload();
  await expect(page.getByTestId('login-email-input')).toBeVisible();
  await expect(page.getByTestId(/^game-card-/)).toHaveCount(0);
});

test('a different restored account never sees the previous account lobby', async ({ page }) => {
  const fixture = await setup(page);
  await page.addInitScript(
    ({ games, profileKey }) => {
      localStorage.setItem('sucker.multiplayerGameList.v1', JSON.stringify({ profileId: 'other-account', games }));
      localStorage.setItem(
        profileKey,
        JSON.stringify([{ id: 'other-account', display_name: 'Other Account', username: null, avatar_url: null }]),
      );
    },
    { games: fixture.games, profileKey },
  );
  const refresh = deferred();
  fixture.block(refresh.promise);
  try {
    await page.goto('/');
    await expect(page.getByTestId('profile-button')).toBeVisible();
    await expect(page.getByText('Hi, Other Account')).toHaveCount(0);
    await expect(page.getByTestId(/^game-card-/)).toHaveCount(0);
    await expect(page.getByTestId('login-email-input')).toHaveCount(0);
  } finally {
    refresh.resolve();
  }
  await expect(page.getByText('Hi, Startup Tester')).toBeVisible();
});

test('an expired rejected session shows login after restoration without cached games', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/');
  await expect(page.getByText('Hi, Startup Tester')).toBeVisible();
  await expect(page.getByTestId(/^game-card-/)).toHaveCount(2);
  await page.evaluate((key) => {
    const session = JSON.parse(localStorage.getItem(key)!);
    session.expires_at = 1;
    localStorage.setItem(key, JSON.stringify(session));
  }, sessionKey);
  const refresh = deferred();
  await page.route('**/auth/v1/token?**', async (route) => {
    await refresh.promise;
    return route.fulfill({ status: 400, json: { code: 'refresh_token_not_found', message: 'Session expired' } });
  });
  try {
    await page.reload();
    await expect(page.getByText('Hi, Startup Tester')).toBeVisible();
    await expect(page.getByTestId('login-email-input')).toHaveCount(0);
    await expect(page.getByTestId(`game-card-${fixture.games[0].id}`)).toBeVisible();
  } finally {
    refresh.resolve();
  }
  await expect(page.getByTestId('login-email-input')).toBeVisible();
  await expect(page.getByText('Hi, Startup Tester')).toHaveCount(0);
});

for (const failure of ['offline', 'server', 'rate-limited'] as const) {
  test(`an expired session survives ${failure} failure and reconnects without login`, async ({ page }, testInfo) => {
    const fixture = await setup(page);
    await page.goto('/');
    await expect(page.getByText('Hi, Startup Tester')).toBeVisible();
    await expect(page.getByTestId(/^game-card-/)).toHaveCount(2);
    await page.evaluate((key) => {
      const session = JSON.parse(localStorage.getItem(key)!);
      session.expires_at = 1;
      localStorage.setItem(key, JSON.stringify(session));
    }, sessionKey);
    let available = false;
    await page.route('**/auth/v1/token?**', async (route) => {
      if (!available) {
        return failure === 'offline'
          ? route.abort('internetdisconnected')
          : route.fulfill({
              status: failure === 'rate-limited' ? 429 : 503,
              json: { message: 'Auth temporarily unavailable' },
            });
      }
      const session = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), sessionKey);
      return route.fulfill({
        json: { ...session, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 },
      });
    });
    await page.reload();
    await expect(page.getByText('Hi, Startup Tester')).toBeVisible();
    await expect(page.getByTestId(/^game-card-/)).toHaveCount(2);
    await expect(page.getByTestId('session-connection-notice')).toBeVisible({ timeout: 20_000 });
    // Supabase emits this when startup refresh fails, even though credentials
    // remain in storage. It must not clear the UI or the saved games.
    await page.evaluate((key) => {
      const channel = new BroadcastChannel(key);
      channel.postMessage({ event: 'INITIAL_SESSION', session: null });
      channel.close();
    }, sessionKey);
    await page.waitForTimeout(100);
    await expect(page.getByText('Hi, Startup Tester')).toBeVisible();
    await expect(page.getByTestId(/^game-card-/)).toHaveCount(2);
    await expect(page.getByTestId('login-email-input')).toHaveCount(0);
    expect(await page.evaluate(() => (window as typeof window & { loginFlashed?: boolean }).loginFlashed)).toBe(false);
    expect(await page.evaluate((key) => Boolean(localStorage.getItem(key)), sessionKey)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`session-${failure}.png`) });
    fixture.profiles[0].display_name = 'Reconnected Tester';
    if (failure === 'server') {
      await expect(page.getByTestId('retry-session-button')).toBeEnabled({ timeout: 20_000 });
      available = true;
      await page.getByTestId('retry-session-button').click();
    } else {
      available = true;
      if (failure === 'offline') await page.evaluate(() => window.dispatchEvent(new Event('online')));
    }
    await expect(page.getByText('Hi, Reconnected Tester')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('session-connection-notice')).toHaveCount(0);
    await expect(page.getByTestId('login-email-input')).toHaveCount(0);
  });
}

test('a move blocked by auth connectivity never asks the player to sign in', async ({ page }) => {
  const fixture = await setup(page);
  await page.goto('/');
  await page.getByTestId(`game-card-${fixture.games[0].id}`).click();
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  await page.evaluate((key) => {
    const session = JSON.parse(localStorage.getItem(key)!);
    session.expires_at = 1;
    localStorage.setItem(key, JSON.stringify(session));
  }, sessionKey);
  let actionsSent = 0;
  await page.route('**/auth/v1/token?**', (route) => route.abort('internetdisconnected'));
  await page.route('**/functions/v1/game-action', (route) => {
    actionsSent++;
    return route.fallback();
  });
  await page.getByTestId('roll-button').click();
  await expect(page.getByText('Unable to reach Sucker! services. Please try again.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Sign in before making a game move.')).toHaveCount(0);
  await expect(page.getByTestId('game-screen')).toBeVisible();
  expect(actionsSent).toBe(0);
});

for (const signedIn of [true, false]) {
  test(`${signedIn ? 'an expired signed-in player' : 'a guest'} can start, play, and resume a computer game offline`, async ({
    page,
    context,
  }, testInfo) => {
    await setup(page, signedIn);
    // Expected SDK network errors create a development-only Metro toast over
    // the roll button. Dismiss it normally; keep app error dialogs observable.
    const networkToast = page.locator('#error-toast [role="button"]').filter({
      hasText: /Failed to fetch|Load failed|NetworkError/,
    });
    await page.addLocatorHandler(networkToast, () => networkToast.locator('button').click());
    await page.goto('/');
    await expect(signedIn ? page.getByText('Hi, Startup Tester') : page.getByTestId('login-email-input')).toBeVisible();
    const saveKey = `sucker.computer-session.v1.${signedIn ? actorId : 'guest'}`;
    const otherSaveKey = `sucker.computer-session.v1.${signedIn ? 'guest' : actorId}`;
    await page.evaluate(
      ({ sessionKey, signedIn, otherSaveKey }) => {
        if (signedIn) {
          const session = JSON.parse(localStorage.getItem(sessionKey)!);
          session.expires_at = 1;
          localStorage.setItem(sessionKey, JSON.stringify(session));
        }
        localStorage.setItem(otherSaveKey, 'unrelated saved game');
      },
      { sessionKey, signedIn, otherSaveKey },
    );
    // Block the entire backend, including mocked requests, as well as the
    // browser network. Solo play cannot depend on a successful auth refresh.
    await page.route(`${backend}/**`, (route) => route.abort('internetdisconnected'));
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await page.getByTestId('play-computer-button').click();
    await expect(page.getByTestId('roll-button')).toBeEnabled();
    await expect(page.getByTestId('computer-save-dialog')).toHaveCount(0);
    await page.getByTestId('roll-button').click();
    const firstDie = page.getByRole('button', { name: /^Die 1:/ });
    await expect(firstDie).toBeEnabled();
    await firstDie.click();
    await page.getByTestId('token-menu-button').click();
    await page.getByTestId('token-option-extra-roll').click();
    await expect(page.getByTestId('token-menu-button')).toHaveText('9');
    const readSave = () => page.evaluate((key): ComputerSession => JSON.parse(localStorage.getItem(key)!), saveKey);
    await expect.poll(async () => (await readSave())?.game.players[0].suckerTokens).toBe(9);
    const rolledSave = await readSave();
    await page.getByRole('button', { name: 'Back to games', exact: true }).click();
    await expect(page.getByTestId('play-computer-button')).toHaveText('Resume Computer Game');
    await page.getByTestId('play-computer-button').click();
    await expect(page.getByTestId('token-menu-button')).toHaveText('9');
    expect((await readSave()).game).toEqual(rolledSave.game);

    await page.getByTestId('category-button-chance').click();
    await page.getByTestId('play-score-button').click();
    await expect(page.getByTestId('roll-button')).toBeEnabled({ timeout: 25_000 });
    const afterTurn = await readSave();
    expect(afterTurn.game.players[0].scorecard.chance).not.toBeNull();
    expect(Object.values(afterTurn.game.players[1].scorecard).filter((value) => value !== null)).toHaveLength(1);
    await page.screenshot({ path: testInfo.outputPath('computer-game-offline.png') });

    // A dev web reload needs Metro to serve the app bundle. Keep every backend
    // request failing while reloading, as on a native cold launch in airplane mode.
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByTestId('roll-button')).toBeEnabled({ timeout: 25_000 });
    expect((await readSave()).game).toEqual(afterTurn.game);
    expect(await page.evaluate((key) => localStorage.getItem(key), otherSaveKey)).toBe('unrelated saved game');
    if (signedIn) expect(await page.evaluate((key) => Boolean(localStorage.getItem(key)), sessionKey)).toBe(true);
    await expect(page.getByTestId('computer-save-dialog')).toHaveCount(0);
  });
}

test('computer play stays available while a sign-in link waits for the server', async ({ page }) => {
  await setup(page, false);
  await page.addInitScript((key) => {
    localStorage.setItem(`${key}-code-verifier`, JSON.stringify('offline-test-code-verifier'));
  }, sessionKey);
  const refresh = deferred();
  let authRequested = false;
  await page.route('**/auth/v1/token?**', async (route) => {
    authRequested = true;
    await refresh.promise;
    await route.abort('internetdisconnected');
  });
  try {
    await page.goto('/?code=offline-sign-in');
    await expect.poll(() => authRequested).toBe(true);
    await expect(page.getByTestId('session-restoring-screen')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('computer-entry-during-sign-in.png') });
    await page.getByTestId('play-computer-button').click();
    await expect(page.getByTestId('roll-button')).toBeEnabled();
    await expect(page.getByTestId('computer-save-dialog')).toHaveCount(0);
  } finally {
    refresh.resolve();
  }
});

test('a transient avatar image failure retries without navigating into a game', async ({ page }) => {
  const fixture = await setup(page);
  let imageRequests = 0;
  await page.route(/\/storage\/v1\/object\/public\/avatars\//, (route) => {
    if (++imageRequests === 1) return route.fulfill({ status: 503, body: 'Temporary image failure' });
    return route.fallback();
  });
  await page.goto('/');
  const image = page.getByTestId(`game-card-${fixture.games[1].id}`).locator('img');
  await expect.poll(() => imageRequests).toBeGreaterThan(1);
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => Boolean(img.complete && img.naturalWidth)))
    .toBe(true);
});

test('keep playing reuses lobby avatars while profile requests are delayed', async ({ page }, testInfo) => {
  const fixture = await setup(page);
  await page.goto('/');
  const queuedGameId = fixture.games[1].id;
  await expect(page.getByTestId(`game-card-${queuedGameId}`).locator('img')).toBeVisible();
  fixture.blockProfiles();
  try {
    await page.getByTestId(`game-card-${fixture.games[0].id}`).click();
    await page.getByTestId('roll-button').click();
    await page.getByTestId('home-score-box-ones').click();
    await page.getByTestId('play-score-button').click();
    await expect(page.getByTestId('next-turns-dialog')).toBeVisible({ timeout: 15_000 });
    const image = page.getByTestId(`next-turn-avatar-${queuedGameId}-image`);
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate((node) => {
          const img = node instanceof HTMLImageElement ? node : node.querySelector('img');
          return Boolean(img?.complete && img.naturalWidth);
        }),
      )
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath('keep-playing-cached-avatar.png') });
    await page.getByTestId(`next-turn-game-${queuedGameId}`).click();
    await expect(page.getByTestId('opponent-player-avatar-image')).toBeVisible();
  } finally {
    fixture.releaseProfiles();
  }
});
