import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createGame, scoreCategories } from '../shared/game';

for (const failure of ['outage', 'lost acknowledgement'] as const) {
  test(`computer result recovers after ${failure} without counting twice`, async ({ page }) => {
    const url = process.env.SUPABASE_URL!;
    const anon = process.env.SUPABASE_ANON_KEY!;
    const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `computer-result-${crypto.randomUUID()}@example.test`;
    const password = 'local-computer-result-2026';
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: 'Result Tester' },
    });
    if (created.error) throw created.error;
    const profileId = created.data.user!.id;
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    const session = signed.data.session!;
    await page.addInitScript(
      (config) => {
        (
          window as typeof window & { __SUCKER_E2E_MULTIPLAYER_CONFIG__?: typeof config }
        ).__SUCKER_E2E_MULTIPLAYER_CONFIG__ = config;
      },
      {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        supabaseAnonKey: anon,
        supabaseUrl: url,
      },
    );
    await page.goto('/');
    await expect(page.getByText('Hi, Result Tester')).toBeVisible();
    const game = createGame(['Result Tester', 'Computer']);
    for (const player of game.players) for (const category of scoreCategories) player.scorecard[category] = 0;
    game.players[0].scorecard.chance = null;
    game.dice = [1, 2, 3, 4, 5];
    game.phase = 'scoring';
    game.rollNumber = 1;
    await page.evaluate(
      ({ owner, savedGame }) => {
        localStorage.setItem(
          `sucker.computer-session.v1.${owner}`,
          JSON.stringify({
            version: 1,
            game: savedGame,
            pendingTurn: null,
            actions: [],
            turns: [],
            recordedGameIds: [],
          }),
        );
      },
      { owner: profileId, savedGame: game },
    );
    let failing = true;
    let attempts = 0;
    await page.route('**/rest/v1/rpc/record_computer_game_result*', async (route) => {
      attempts += 1;
      if (failing) {
        if (failure === 'lost acknowledgement' && attempts === 1) await route.fetch();
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Local review: simulated result upload outage' }),
        });
      } else await route.continue();
    });
    await page.goto('/local');
    await page.getByTestId('category-button-chance').click();
    await page.getByTestId('play-score-button').click();
    await expect(page.getByTestId('game-over-overlay')).toBeVisible();
    await expect.poll(() => attempts).toBeGreaterThan(0);
    await page.screenshot({ path: test.info().outputPath('completed-during-outage.png') });
    failing = false;
    await page.reload();
    await expect(page.getByTestId('roll-button')).toBeEnabled();
    try {
      await expect
        .poll(
          async () => {
            const stats = await admin
              .from('computer_stats')
              .select('games_played')
              .eq('profile_id', profileId)
              .maybeSingle();
            if (stats.error) throw stats.error;
            return stats.data?.games_played ?? 0;
          },
          { timeout: 12_000 },
        )
        .toBe(1);
      await expect.poll(() => attempts).toBeGreaterThan(1);
      await expect
        .poll(() =>
          page.evaluate(
            (owner) => JSON.parse(localStorage.getItem(`sucker.computer-results.v1.${owner}`) ?? '[]').length,
            profileId,
          ),
        )
        .toBe(0);
    } finally {
      await page.getByTestId('game-menu-button').click();
      await page.getByTestId('game-stats-menu-item').click();
      await expect(page.getByTestId('stats-page-overlay')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('stats-after-recovery.png') });
    }
    await page.reload();
    const stats = await admin.from('computer_stats').select('games_played').eq('profile_id', profileId).single();
    if (stats.error) throw stats.error;
    expect(stats.data.games_played).toBe(1);
  });
}
