import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { createGame } from '../shared/game';

const actorId = '00000000-0000-4000-8000-000000000001';
const opponentId = '00000000-0000-4000-8000-000000000002';

async function openLobby(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const user = {
    id: actorId,
    email: 'title@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  };
  const accessToken =
    [
      { alg: 'HS256', typ: 'JWT' },
      { sub: actorId, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.') + '.test-only-signature';
  let pendingTurns = 2;
  function games() {
    return [0, 1, 2].map((index) => {
      const state = createGame(['Title Tester', `Opponent ${index + 1}`]);
      state.players[0].id = actorId;
      state.players[1].id = opponentId;
      return {
        id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
        state,
        status: 'active',
        created_by: actorId,
        current_player_id: index < pendingTurns ? actorId : opponentId,
        created_at: user.created_at,
        updated_at: user.created_at,
        completed_at: null,
        last_turn_id: null,
        winner_id: null,
      };
    });
  }
  await page.addInitScript(
    ({ accessToken }) => {
      (window as typeof window & { __SUCKER_E2E_MULTIPLAYER_CONFIG__?: unknown }).__SUCKER_E2E_MULTIPLAYER_CONFIG__ = {
        accessToken,
        refreshToken: 'test-only-refresh',
        supabaseUrl: 'http://127.0.0.1:59721',
        supabaseAnonKey: 'test-only-key',
      };
    },
    { accessToken },
  );
  await page.route(/\/(?:auth|rest)\/v1\//, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
    if (url.pathname === '/rest/v1/profiles') {
      const profile = { id: actorId, display_name: 'Title Tester', username: 'title_tester', avatar_url: null };
      return route.fulfill({ json: url.searchParams.get('id')?.startsWith('in.') ? [profile] : profile });
    }
    if (url.pathname === '/rest/v1/games') {
      return route.fulfill({ json: url.searchParams.get('status') === 'neq.complete' ? games() : [] });
    }
    return route.fulfill({ json: [] });
  });
  const channels = new Map<string, { joinRef: string; socket: WebSocketRoute }>();
  await page.routeWebSocket(/\/realtime\/v1\//, (socket) => {
    socket.onMessage((raw) => {
      if (typeof raw !== 'string') return;
      const [joinRef, ref, topic, event, payload] = JSON.parse(raw);
      if (event === 'phx_join') {
        if (topic.startsWith('realtime:games:list:')) channels.set(topic, { joinRef, socket });
        socket.send(
          JSON.stringify([
            joinRef,
            ref,
            topic,
            'phx_reply',
            {
              status: 'ok',
              response: {
                postgres_changes: (payload.config?.postgres_changes ?? []).map((filter: object) => ({
                  ...filter,
                  id: 1,
                })),
              },
            },
          ]),
        );
      } else if (event === 'heartbeat' || event === 'phx_leave') {
        if (event === 'phx_leave') channels.delete(topic);
        socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
      }
    });
  });
  await page.goto('/');
  await expect(page.getByText('Hi, Title Tester')).toBeVisible();
  await expect(page).toHaveTitle('(2) Sucker!');
  return {
    errors,
    setPendingTurns(count: number) {
      pendingTurns = count;
    },
    async emitGameChange() {
      await expect.poll(() => channels.size).toBe(1);
      for (const [topic, { joinRef, socket }] of channels) {
        socket.send(
          JSON.stringify([
            joinRef,
            null,
            topic,
            'postgres_changes',
            {
              ids: [1],
              data: {
                schema: 'public',
                table: 'games',
                type: 'UPDATE',
                columns: [],
                record: games()[0],
                old_record: {},
                errors: null,
                commit_timestamp: new Date().toISOString(),
              },
            },
          ]),
        );
      }
    },
  };
}

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event(hidden ? 'blur' : 'focus'));
  }, hidden);
  // Let React commit the activity change before a server event or timer fires.
  await page.waitForTimeout(100);
}

test('realtime updates the turn title while the tab stays hidden', async ({ page }) => {
  const lobby = await openLobby(page);
  await setHidden(page, true);
  for (const count of [3, 0]) {
    lobby.setPendingTurns(count);
    await lobby.emitGameChange();
    await expect(page).toHaveTitle(count ? `(${count}) Sucker!` : 'Sucker!');
    expect(await page.evaluate(() => document.visibilityState)).toBe('hidden');
  }
  expect(lobby.errors).toEqual([]);
});

test('polling refreshes a hidden tab and returning to it catches up immediately', async ({ page }) => {
  await page.clock.install();
  const lobby = await openLobby(page);
  await setHidden(page, true);
  lobby.setPendingTurns(1);
  await page.clock.fastForward(16_000);
  await expect(page).toHaveTitle('(1) Sucker!');
  expect(await page.evaluate(() => document.visibilityState)).toBe('hidden');
  lobby.setPendingTurns(0);
  await setHidden(page, false);
  await expect(page).toHaveTitle('Sucker!');
  expect(lobby.errors).toEqual([]);
});
