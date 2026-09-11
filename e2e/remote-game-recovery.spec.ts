import { expect, test } from '@playwright/test';
import { createGame } from '../shared/game';

for (const initialFails of [true, false]) {
  test(`a game opens when only the ${initialFails ? 'reconnect' : 'initial'} fetch succeeds`, async ({
    page,
  }, testInfo) => {
    const user = {
      id: '00000000-0000-4000-8000-000000000001',
      email: 'recovery@example.test',
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    };
    const gameId = '00000000-0000-4000-8000-000000000003';
    const state = createGame(['Recovery Tester', 'Opponent']);
    state.players[0].id = user.id;
    state.players[1].id = '00000000-0000-4000-8000-000000000002';
    const game = {
      id: gameId,
      state,
      status: 'active',
      created_by: user.id,
      current_player_id: user.id,
      created_at: user.created_at,
      updated_at: user.created_at,
      completed_at: null,
      last_turn_id: null,
      last_nudged_at: null,
      winner_id: null,
      sucker_tokens_spent: {},
    };
    const accessToken =
      [
        { alg: 'HS256', typ: 'JWT' },
        { sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' },
      ]
        .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
        .join('.') + '.test-only-signature';
    await page.addInitScript(
      ({ accessToken }) => {
        (window as typeof window & { __SUCKER_E2E_MULTIPLAYER_CONFIG__?: unknown }).__SUCKER_E2E_MULTIPLAYER_CONFIG__ =
          {
            accessToken,
            refreshToken: 'test-only-refresh',
          };
      },
      { accessToken },
    );

    let firstRequested!: () => void;
    let releaseInitial!: () => void;
    let replacementFinished!: () => void;
    const firstRequest = new Promise<void>((resolve) => {
      firstRequested = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseInitial = resolve;
    });
    const replacement = new Promise<void>((resolve) => {
      replacementFinished = resolve;
    });
    let gameRequests = 0;
    await page.route(/\/(?:auth|rest)\/v1\//, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
      if (url.pathname === '/rest/v1/profiles') {
        return route.fulfill({
          json: { id: user.id, display_name: 'Recovery Tester', username: 'recovery_tester', avatar_url: null },
        });
      }
      if (url.pathname === '/rest/v1/games' && url.searchParams.get('id') === `eq.${gameId}`) {
        const request = ++gameRequests;
        if (request === 1) {
          firstRequested();
          await release;
        }
        // Keep the failed chain failing through PostgREST's automatic GET
        // retries; only the other original request may return a game.
        const fails = initialFails ? request !== 2 : request !== 1;
        await route.fulfill(
          fails ? { status: 503, json: { message: 'Controlled game-fetch failure' } } : { json: game },
        );
        if (request === 2) replacementFinished();
        return;
      }
      return route.fulfill({ json: [] });
    });

    // Complete the actual Supabase subscription handshake only after the first
    // game fetch is pending, so SUBSCRIBED starts the competing refresh.
    await page.routeWebSocket(/\/realtime\/v1\//, (socket) => {
      socket.onMessage(async (raw) => {
        if (typeof raw !== 'string') return;
        const [joinRef, ref, topic, event, payload] = JSON.parse(raw);
        if (event === 'phx_join') {
          if (topic === `realtime:game:${gameId}`) await firstRequest;
          socket.send(
            JSON.stringify([
              joinRef,
              ref,
              topic,
              'phx_reply',
              {
                status: 'ok',
                response: {
                  postgres_changes: (payload.config?.postgres_changes ?? []).map(
                    (filter: Record<string, unknown>, id: number) => ({ ...filter, id: id + 1 }),
                  ),
                },
              },
            ]),
          );
        } else if (event === 'heartbeat' || event === 'phx_leave') {
          socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
        }
      });
    });

    await page.goto('/');
    await expect(page.getByText('Hi, Recovery Tester')).toBeVisible();
    await page.goto(`/game/${gameId}`);
    await replacement;
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    releaseInitial();
    try {
      await expect(page.getByTestId('roll-button')).toBeVisible();
      await expect(page.getByTestId('remote-loading-screen')).toHaveCount(0);
      await expect(page.getByTestId('roll-button')).toBeEnabled();
      await expect(page.getByText('Unable to load game.', { exact: true })).toHaveCount(0);
      expect(gameRequests).toBeGreaterThanOrEqual(2);
    } finally {
      await page.screenshot({ path: testInfo.outputPath('game-load-race.png') });
    }
  });
}
