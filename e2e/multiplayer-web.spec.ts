import { expect, test, type Browser, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type DbClient = SupabaseClient;
type TestUser = {
  displayName: string;
  email: string;
  id: string;
};

const supabaseUrl = requireEnv('SUPABASE_URL');
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const mailpitUrl = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const scoreCategories = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'threeOfAKind',
  'fourOfAKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'sucker',
  'chance',
] as const;

test('two players can create an invite and play turns through the web UI', async ({ browser }) => {
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const alice = await createUser(`alice-${runId}`, 'Alice E2E');
  const bob = await createUser(`bob-${runId}`, 'Bob E2E');

  const alicePage = await openAuthedPage(browser, alice);
  const bobPage = await openAuthedPage(browser, bob);

  await expect(alicePage.getByTestId('multiplayer-lobby-shell')).toHaveScreenshot('lobby.png');

  await alicePage.getByTestId('start-with-friend-button').click();
  await alicePage.getByTestId('create-invite-button').click();
  const inviteCode = (await alicePage.getByTestId('generated-invite-code').innerText()).trim();
  expect(inviteCode).toMatch(/^[A-F0-9]{8}$/);

  await bobPage.getByTestId('start-with-friend-button').click();
  await bobPage.getByTestId('invite-code-input').fill(inviteCode);
  await bobPage.getByTestId('join-invite-button').click();

  const gameId = await waitForAcceptedGame(inviteCode);
  await openGameFromLobby(alicePage, gameId);
  await expect(alicePage.getByTestId('game-screen')).toHaveScreenshot('active-turn.png');

  await expect(alicePage.getByTestId('roll-button')).toBeEnabled();
  await alicePage.getByTestId('roll-button').click();
  await expect(alicePage.getByTestId('game-screen')).toHaveScreenshot('scoring.png', {
    mask: [alicePage.getByTestId('dice-tray')],
  });
  await expect(alicePage.getByTestId('token-menu-button')).toBeEnabled();
  await expect(async () => {
    await alicePage.getByTestId('token-menu-button').click();
    await expect(alicePage.getByTestId('token-menu-overlay')).toBeVisible({ timeout: 500 });
  }).toPass();
  await expect(alicePage.getByTestId('game-screen')).toHaveScreenshot('token-menu.png', {
    mask: [alicePage.getByTestId('dice-tray')],
  });
  await alicePage.getByTestId('token-menu-close-button').click();
  await expect(alicePage.getByTestId('home-score-box-ones')).toBeVisible();
  await alicePage.getByTestId('home-score-box-ones').click();
  await expect(alicePage.getByTestId('play-score-button')).toBeEnabled();
  await alicePage.getByTestId('play-score-button').click();

  await expect.poll(() => loadGameStatus(gameId)).toBe('response_window');

  await openGameFromLobby(bobPage, gameId);
  await expect(bobPage.getByTestId('game-screen')).toHaveScreenshot('response-window.png', {
    mask: [
      bobPage.getByTestId('dice-tray'),
      bobPage.getByTestId('opponent-score-box-ones'),
      bobPage.getByTestId('player-strip'),
      bobPage.getByTestId('section-bonus-panel'),
    ],
  });
  await expect(bobPage.getByTestId('roll-button')).toBeEnabled();
  await bobPage.getByTestId('roll-button').click();
  await expect(bobPage.getByTestId('home-score-box-twos')).toBeVisible();
  await bobPage.getByTestId('home-score-box-twos').click();
  await expect(bobPage.getByTestId('play-score-button')).toBeEnabled();
  await bobPage.getByTestId('play-score-button').click();

  await expect.poll(() => loadTurnCount(gameId)).toBe(2);
  await expect
    .poll(() => loadActionTypes(gameId))
    .toEqual(['create_invite', 'accept_invite', 'roll', 'score_category', 'roll', 'score_category']);

  const game = await loadGame(gameId);
  expect(game.status).toBe('response_window');
  const state = game.state as {
    players: Array<{ id: string; scorecard: { ones: number | null; twos: number | null } }>;
  };
  expect(state.players).toHaveLength(2);
  expect(state.players.find((player) => player.id === alice.id)?.scorecard.ones).toEqual(expect.any(Number));
  expect(state.players.find((player) => player.id === bob.id)?.scorecard.twos).toEqual(expect.any(Number));

  await completeGameForScreenshot(gameId, bob.id);
  await expect(bobPage.getByTestId('game-over-overlay')).toBeVisible();
  await expect(bobPage.getByTestId('game-over-panel')).toHaveScreenshot('game-over.png', {
    mask: [bobPage.getByTestId('game-over-home-score'), bobPage.getByTestId('game-over-opponent-score')],
    maxDiffPixelRatio: 0.12,
  });
});

async function openAuthedPage(browser: Browser, user: TestUser) {
  const context = await browser.newContext({ viewport: { height: 852, width: 393 } });
  const page = await context.newPage();

  await page.goto('/');
  await page.getByTestId('login-email-input').fill(user.email);
  await page.getByTestId('send-code-button').click();
  const code = await readLatestSignInCode(user.email);
  await page.getByTestId('login-code-input').fill(code);
  await page.getByTestId('verify-code-button').click();
  await expect(page.getByText(`Hi, ${user.displayName}`)).toBeVisible({ timeout: 30_000 });
  return page;
}

async function openGameFromLobby(page: Page, gameId: string) {
  await page.goto('/');
  await expect(page.getByTestId('refresh-games-button')).toBeVisible();
  await page.getByTestId('refresh-games-button').click();
  await expect(page.getByTestId(`game-card-${gameId}`)).toBeVisible();
  await page.getByTestId(`game-card-${gameId}`).click();
}

async function createUser(slug: string, displayName: string): Promise<TestUser> {
  const email = `${slug}@example.test`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  assertNoError(createError);
  if (!created.user) {
    throw new Error(`Unable to create ${displayName}.`);
  }

  await upsertProfile(created.user.id, displayName, slug.replace(/[^a-z0-9_]/gi, '_').slice(0, 24));

  return {
    displayName,
    email,
    id: created.user.id,
  };
}

async function upsertProfile(id: string, displayName: string, username: string) {
  const { error } = await admin.from('profiles').upsert({
    display_name: displayName,
    id,
    username,
  });
  assertNoError(error);
}

async function readLatestSignInCode(email: string) {
  let latestCode: string | null = null;
  await expect
    .poll(
      async () => {
        const response = await fetch(`${mailpitUrl}/api/v1/messages`);
        if (!response.ok) {
          throw new Error(`Unable to read Mailpit messages: ${response.status}`);
        }

        const mailbox = (await response.json()) as {
          messages?: Array<{
            Created?: string;
            Snippet?: string;
            To?: Array<{ Address?: string }>;
          }>;
        };
        const message = (mailbox.messages ?? [])
          .filter((candidate) =>
            candidate.To?.some((recipient) => recipient.Address?.toLowerCase() === email.toLowerCase()),
          )
          .sort((left, right) => Date.parse(right.Created ?? '') - Date.parse(left.Created ?? ''))[0];
        latestCode = message?.Snippet?.match(/\b\d{6}\b/)?.[0] ?? null;
        return latestCode;
      },
      { timeout: 10_000 },
    )
    .not.toBeNull();

  if (!latestCode) {
    throw new Error(`No sign-in code was delivered to ${email}.`);
  }

  return latestCode;
}

async function waitForAcceptedGame(inviteCode: string) {
  return expect
    .poll(async () => {
      const { data, error } = await admin
        .from('game_invites')
        .select('game_id, status')
        .eq('invite_code', inviteCode)
        .maybeSingle();
      assertNoError(error);
      return data?.status === 'accepted' ? data.game_id : null;
    })
    .not.toBeNull()
    .then(async () => {
      const { data, error } = await admin.from('game_invites').select('game_id').eq('invite_code', inviteCode).single();
      assertNoError(error);
      if (!data) {
        throw new Error(`Invite ${inviteCode} was not found.`);
      }
      return data.game_id;
    });
}

async function loadGame(gameId: string) {
  const { data, error } = await admin.from('games').select('*').eq('id', gameId).single();
  assertNoError(error);
  if (!data) {
    throw new Error(`Game ${gameId} was not found.`);
  }
  return data;
}

async function loadGameStatus(gameId: string) {
  const game = await loadGame(gameId);
  return game.status;
}

async function loadTurnCount(gameId: string) {
  const { count, error } = await admin.from('turns').select('id', { count: 'exact', head: true }).eq('game_id', gameId);
  assertNoError(error);
  return count ?? 0;
}

async function loadActionTypes(gameId: string) {
  const { data, error } = await admin
    .from('turn_actions')
    .select('action_type')
    .eq('game_id', gameId)
    .order('created_at');
  assertNoError(error);
  return (data ?? []).map((action) => action.action_type);
}

async function completeGameForScreenshot(gameId: string, winnerPlayerId: string) {
  const game = await loadGame(gameId);
  const state = game.state as {
    players: Array<{
      id: string;
      scorecard: Record<(typeof scoreCategories)[number], number | null>;
      suckerBonusCategories: string[];
      suckerTokens: number;
    }>;
  };
  const completedState = {
    ...state,
    currentPlayerIndex: 0,
    dice: [1, 1, 1, 1, 1],
    extraRollsAvailable: 0,
    held: [false, false, false, false, false],
    phase: 'complete',
    players: state.players.map((player) => ({
      ...player,
      scorecard: Object.fromEntries(
        scoreCategories.map((category) => [
          category,
          player.id === winnerPlayerId && category === 'chance' ? 1 : (player.scorecard[category] ?? 0),
        ]),
      ) as Record<(typeof scoreCategories)[number], number>,
    })),
    rollNumber: 0,
  };
  const completedAt = new Date().toISOString();
  const { error } = await admin
    .from('games')
    .update({
      completed_at: completedAt,
      current_player_id: null,
      state: completedState,
      status: 'complete',
      winner_id: winnerPlayerId,
    })
    .eq('id', gameId);
  assertNoError(error);

  for (const player of completedState.players) {
    const { error: playerError } = await admin
      .from('game_players')
      .update({
        final_score: player.id === winnerPlayerId ? 1 : 0,
        sucker_tokens: player.suckerTokens,
        upper_bonus_awarded: false,
      })
      .eq('game_id', gameId)
      .eq('player_id', player.id);
    assertNoError(playerError);
  }
}

function assertNoError(error: unknown) {
  if (error) {
    throw new Error(error instanceof Error ? error.message : JSON.stringify(error));
  }
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}
