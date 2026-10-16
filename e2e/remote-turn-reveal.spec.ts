import { expect, test } from '@playwright/test';
import { createGame } from '../shared/game';

// Returning to a game after the opponent's turn must reveal that turn and allow
// rolling, even when a refresh races the blocked-punch check or the check hangs.
for (const scenario of ['refresh-during-check', 'hung-check'] as const) {
  test(`the opponent's turn is revealed and playable after ${scenario}`, async ({ page }, testInfo) => {
    const user = {
      id: '00000000-0000-4000-8000-000000000011',
      email: 'reveal@example.test',
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    };
    const opponentId = '00000000-0000-4000-8000-000000000012';
    const gameId = '00000000-0000-4000-8000-000000000013';
    const turnId = '00000000-0000-4000-8000-000000000014';
    const state = createGame(['Reveal Tester', 'Opponent']);
    state.players[0].id = user.id;
    state.players[1].id = opponentId;
    state.players[1].scorecard.chance = 20;
    state.currentPlayerIndex = 0;
    const game = {
      id: gameId,
      state,
      status: 'response_window',
      created_by: opponentId,
      current_player_id: user.id,
      created_at: user.created_at,
      updated_at: '2026-01-01T00:05:00Z',
      completed_at: null,
      last_turn_id: turnId,
      last_nudged_at: null,
      winner_id: null,
      sucker_tokens_spent: {},
    };
    const opponentTurn = {
      id: turnId,
      game_id: gameId,
      player_id: opponentId,
      turn_index: 0,
      category: 'chance',
      score: 20,
      dice: [4, 4, 4, 4, 4],
      held: [false, false, false, false, false],
      roll_count: 1,
      status: 'submitted',
      created_at: '2026-01-01T00:05:00Z',
      finalized_at: null,
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

    let firstCheckRequested!: () => void;
    let releaseChecks!: () => void;
    const firstCheck = new Promise<void>((resolve) => {
      firstCheckRequested = resolve;
    });
    const checksReleased = new Promise<void>((resolve) => {
      releaseChecks = resolve;
    });
    await page.route(/\/(?:auth|rest)\/v1\//, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
      if (url.pathname === '/rest/v1/profiles') {
        return route.fulfill({
          json: { id: user.id, display_name: 'Reveal Tester', username: 'reveal_tester', avatar_url: null },
        });
      }
      if (url.pathname === '/rest/v1/games' && url.searchParams.get('id') === `eq.${gameId}`) {
        return route.fulfill({ json: game });
      }
      if (url.pathname === '/rest/v1/games') {
        return route.fulfill({ json: url.searchParams.get('status') === 'neq.complete' ? [game] : [] });
      }
      if (url.pathname === '/rest/v1/turns' && url.searchParams.get('id') === `eq.${turnId}`) {
        return route.fulfill({ json: opponentTurn });
      }
      if (url.pathname === '/rest/v1/turn_actions' && url.searchParams.get('action_type') === 'eq.sucker_punch') {
        firstCheckRequested();
        await checksReleased;
        return route.fulfill({ json: [] });
      }
      return route.fulfill({ json: [] });
    });

    let sendGameUpdate: (() => void) | null = null;
    await page.routeWebSocket(/\/realtime\/v1\//, (socket) => {
      socket.onMessage((raw) => {
        if (typeof raw !== 'string') return;
        const [joinRef, ref, topic, event, payload] = JSON.parse(raw);
        if (event === 'phx_join') {
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
          if (topic === `realtime:game:${gameId}`) {
            sendGameUpdate = () =>
              socket.send(
                JSON.stringify([
                  null,
                  null,
                  topic,
                  'postgres_changes',
                  {
                    ids: [1],
                    data: {
                      columns: [],
                      commit_timestamp: '2026-01-01T00:05:01Z',
                      errors: null,
                      old_record: { id: gameId },
                      record: { ...game, updated_at: '2026-01-01T00:05:01Z' },
                      schema: 'public',
                      table: 'games',
                      type: 'UPDATE',
                    },
                  },
                ]),
              );
          }
        } else if (event === 'heartbeat' || event === 'phx_leave') {
          socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
        }
      });
    });

    await page.goto('/');
    await expect(page.getByText('Hi, Reveal Tester')).toBeVisible();
    await page.goto(`/game/${gameId}`);
    await firstCheck;
    await expect(page.getByTestId('roll-button')).toBeDisabled();
    try {
      if (scenario === 'refresh-during-check') {
        // A realtime update replaces the game object while the check is in
        // flight. That must not discard the check's answer.
        await expect.poll(() => sendGameUpdate !== null).toBe(true);
        sendGameUpdate!();
        await page.waitForTimeout(1_000);
        releaseChecks();
        // Well before the fail-open timeout, so the check's own answer clears the gate.
        await expect(page.getByTestId('opponent-turn-reveal')).toBeVisible({ timeout: 2_000 });
        await expect(page.getByTestId('roll-button')).toBeEnabled({ timeout: 10_000 });
      } else {
        await expect(page.getByTestId('roll-button')).toBeEnabled({ timeout: 10_000 });
        releaseChecks();
      }
    } finally {
      await page.screenshot({ path: testInfo.outputPath(`${scenario}.png`) });
    }
  });
}
