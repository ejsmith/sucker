import { readFile } from 'node:fs/promises';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type DbClient = SupabaseClient;
type TestUser = {
  displayName: string;
  email: string;
  id: string;
};

const supabaseUrl = requireEnv('SUPABASE_URL');
const anonKey = requireEnv('SUPABASE_ANON_KEY');
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const e2eBaseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8081';
const stageAspectRatio = 393 / 852;
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

test('local development offers reusable Test 1 and Test 2 logins at the bottom', async ({ browser }) => {
  for (const player of [1, 2, 1] as const) {
    const context = await browser.newContext({ viewport: { height: 852, width: 393 } });
    const page = await context.newPage();
    await page.goto('/');

    const shell = page.getByTestId('multiplayer-lobby-shell');
    const localLogin = page.getByTestId('local-test-login');
    const loginButton = page.getByTestId(`local-test-login-${player}`);
    await expect(localLogin).toBeVisible();
    await expect(loginButton).toHaveText(`Login as Test ${player}`);

    const [shellBox, localLoginBox] = await Promise.all([shell.boundingBox(), localLogin.boundingBox()]);
    expect(shellBox).not.toBeNull();
    expect(localLoginBox).not.toBeNull();
    expect(shellBox!.y + shellBox!.height - (localLoginBox!.y + localLoginBox!.height)).toBeLessThanOrEqual(16);

    await loginButton.click();
    await expect(page.getByText(`Hi, Test Player ${player}`)).toBeVisible();
    await context.close();
  }
});

test('two players can create an invite and play turns through the web UI', async ({ browser }) => {
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const alice = await createUser(`alice-${runId}`, 'Alice E2E');
  const bob = await createUser(`bob-${runId}`, 'Bob E2E');

  const alicePage = await openAuthedPage(browser, alice);
  const bobPage = await openAuthedPage(browser, bob);

  const aliceLobby = alicePage.getByTestId('multiplayer-lobby-shell');
  await expect(aliceLobby).toHaveScreenshot('lobby.png');
  await expectNoSeriousAccessibilityViolations(alicePage);

  await alicePage.setViewportSize({ width: 454, height: 576 });
  const lobbyStageScroll = alicePage.getByTestId('lobby-stage-scroll');
  await expect(lobbyStageScroll).toBeVisible();
  const resizedLobbyBox = await aliceLobby.boundingBox();
  expect(resizedLobbyBox).not.toBeNull();
  expect(resizedLobbyBox!.width).toBeCloseTo(320, 0);
  expect(Math.abs(resizedLobbyBox!.width - resizedLobbyBox!.height * stageAspectRatio)).toBeLessThanOrEqual(1);
  const lobbyScrollMetrics = await lobbyStageScroll.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(lobbyScrollMetrics.scrollWidth).toBeLessThanOrEqual(lobbyScrollMetrics.clientWidth + 1);

  await alicePage.setViewportSize({ width: 393, height: 852 });
  await expect(lobbyStageScroll).toHaveCount(0);

  await alicePage.getByTestId('start-with-friend-button').click();
  await alicePage.getByTestId('create-invite-button').click();
  const inviteCode = (await alicePage.getByTestId('generated-invite-code').innerText()).trim();
  expect(inviteCode).toMatch(/^[A-F0-9]{8}$/);

  await bobPage.getByTestId('start-with-friend-button').click();
  await bobPage.getByTestId('invite-code-input').fill(inviteCode);
  await bobPage.getByTestId('join-invite-button').click();

  const gameId = await waitForAcceptedGame(inviteCode);
  const acceptedGame = await loadGame(gameId);
  expect(acceptedGame.current_player_id).toBe(alice.id);

  await bobPage.goto('/');
  await dismissTurnNotificationPrompt(bobPage);
  const gameListItem = bobPage.getByTestId(`game-list-item-${gameId}`);
  const scorePill = bobPage.getByTestId(`score-game-${gameId}`);
  const nudgeButton = bobPage.getByTestId(`nudge-game-${gameId}`);
  await expect(gameListItem).toBeVisible();
  await expect(nudgeButton).toBeVisible();
  const [scorePillBox, nudgeButtonBox] = await Promise.all([scorePill.boundingBox(), nudgeButton.boundingBox()]);
  expect(scorePillBox).not.toBeNull();
  expect(nudgeButtonBox).not.toBeNull();
  expect(nudgeButtonBox!.x).toBeCloseTo(scorePillBox!.x, 0);
  expect(nudgeButtonBox!.width).toBeCloseTo(scorePillBox!.width, 0);
  expect(nudgeButtonBox!.height).toBeCloseTo(scorePillBox!.height, 0);
  await expect(gameListItem).toHaveScreenshot('game-list-item-with-nudge.png');
  await expect(bobPage.getByTestId('multiplayer-lobby-shell')).toHaveScreenshot('games-list.png');

  await alicePage.goto('/');
  await expect(alicePage.getByTestId(`game-card-${gameId}`)).toBeVisible();

  const emailGreetingStorageKey = 'sucker.e2e.observed-email-greeting';
  const emailGreetingObserverInput = { email: alice.email, storageKey: emailGreetingStorageKey };
  await alicePage.evaluate((storageKey) => sessionStorage.removeItem(storageKey), emailGreetingStorageKey);
  await alicePage.addInitScript(observeEmailGreeting, emailGreetingObserverInput);
  await alicePage.evaluate(observeEmailGreeting, emailGreetingObserverInput);

  await alicePage.goto(`/?game=${encodeURIComponent(gameId)}`);
  await expect(alicePage.getByTestId('game-screen')).toBeVisible();
  await alicePage.goBack();
  await expect(alicePage).toHaveURL(new URL('/', e2eBaseUrl).href);
  await expect(alicePage.getByTestId('multiplayer-lobby-shell')).toBeVisible();
  const observedEmailGreeting = await alicePage.evaluate((storageKey) => {
    const observerWindow = window as typeof window & {
      __SUCKER_E2E_EMAIL_GREETING_OBSERVER__?: MutationObserver;
    };
    observerWindow.__SUCKER_E2E_EMAIL_GREETING_OBSERVER__?.disconnect();
    delete observerWindow.__SUCKER_E2E_EMAIL_GREETING_OBSERVER__;
    return sessionStorage.getItem(storageKey);
  }, emailGreetingStorageKey);
  expect(observedEmailGreeting).toBeNull();

  await expect(alicePage.getByTestId('turn-notification-prompt')).toBeVisible();
  await expect(alicePage.getByTestId('multiplayer-lobby-shell')).toHaveScreenshot('turn-notification-prompt.png', {
    maxDiffPixelRatio: 0.07,
  });
  await dismissTurnNotificationPrompt(alicePage);

  await openGameFromLobby(alicePage, gameId);
  await expect(alicePage.getByTestId('section-bonus-panel')).toHaveScreenshot('section-bonus.png');
  await expect(alicePage.getByTestId('game-screen')).toHaveScreenshot('active-turn.png');
  await expectNoSeriousAccessibilityViolations(alicePage);

  await expect(alicePage.getByTestId('roll-button')).toBeEnabled();
  await alicePage.getByTestId('roll-button').click();
  await expect(alicePage.getByTestId('game-screen')).toHaveScreenshot('scoring.png', {
    mask: [alicePage.getByTestId('dice-tray')],
    maxDiffPixelRatio: 0.07,
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

  let releaseTurnRequest = () => {};
  const turnRequestGate = new Promise<void>((resolve) => {
    releaseTurnRequest = resolve;
  });
  const turnRoute = /\/rest\/v1\/turns\?/;
  await bobPage.route(turnRoute, async (route) => {
    await turnRequestGate;
    await route.continue();
  });
  await openGameFromNotification(bobPage, gameId);
  await expectPressableDisabled(bobPage.getByTestId('roll-button'));
  const turnResponse = bobPage.waitForResponse(
    (response) => response.url().includes('/rest/v1/turns?') && response.request().method() === 'GET',
  );
  releaseTurnRequest();
  await turnResponse;
  await bobPage.unroute(turnRoute);
  await expect(bobPage.getByTestId('opponent-score-box-ones')).not.toHaveText('', { timeout: 5_000 });
  const bobRollButton = bobPage.getByTestId('roll-button');
  await waitForPressableEnabled(bobRollButton);
  await expect(bobPage.getByTestId('game-screen')).toHaveScreenshot('response-window.png');
  await bobRollButton.click();
  const bobTwosScoreBox = bobPage.getByTestId('home-score-box-twos');
  await waitForPressableEnabled(bobTwosScoreBox);
  await bobTwosScoreBox.click();
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

  await openGameFromNotification(bobPage, gameId);
  await bobPage.getByTestId('game-back-button').click();
  await expect(bobPage).toHaveURL(new URL('/', e2eBaseUrl).href);
  await expect(bobPage.getByTestId('multiplayer-lobby-shell')).toBeVisible();
  await openGameFromLobby(bobPage, gameId);

  await completeGameForScreenshot(gameId, bob.id);
  await expect(bobPage.getByTestId('game-over-overlay')).toBeVisible();
  await expect(bobPage.getByTestId('game-over-panel')).toHaveScreenshot('game-over.png', {
    mask: [bobPage.getByTestId('game-over-home-score'), bobPage.getByTestId('game-over-opponent-score')],
    maxDiffPixelRatio: 0.12,
  });
});

test('taunt picker stays connected to the avatar without moving the scorecard', async ({ browser }) => {
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const alice = await createUser(`taunt-alice-${runId}`, 'Taunt Alice E2E');
  const bob = await createUser(`taunt-bob-${runId}`, 'Taunt Bob E2E');
  const alicePage = await openAuthedPage(browser, alice);
  const bobPage = await openAuthedPage(browser, bob);
  const gameId = await createAcceptedGame(alicePage, bobPage);

  await openGameFromLobby(alicePage, gameId);
  const board = alicePage.getByTestId('scorecard-board');
  const menuButton = alicePage.getByTestId('taunt-menu-button');
  const boardBefore = await board.boundingBox();
  expect(boardBefore).not.toBeNull();
  await expect(menuButton).toHaveCount(0);
  await alicePage.getByTestId('roll-button').click();
  await expect(menuButton).toHaveCount(0);
  await waitForPressableEnabled(alicePage.getByTestId('home-score-box-ones'));
  await alicePage.getByTestId('home-score-box-ones').click();
  await expect(alicePage.getByTestId('play-score-button')).toBeEnabled();
  await alicePage.getByTestId('play-score-button').click();
  await expect.poll(() => loadGameStatus(gameId)).toBe('response_window');
  await expect(alicePage.getByTestId('next-turns-dialog')).toBeVisible({ timeout: 15_000 });
  await expect(menuButton).toBeVisible();

  const [boardAfter, avatarBox, menuButtonBox] = await Promise.all([
    board.boundingBox(),
    alicePage.getByTestId('home-player-avatar').boundingBox(),
    menuButton.boundingBox(),
  ]);
  expect(boardAfter).toEqual(boardBefore);
  expect(avatarBox).not.toBeNull();
  expect(menuButtonBox).not.toBeNull();
  expect(menuButtonBox!.width).toBeLessThan(avatarBox!.width);
  expect(menuButtonBox!.height).toBeLessThan(avatarBox!.height);
  expect(menuButtonBox!.y).toBeGreaterThan(avatarBox!.y + avatarBox!.height / 2);
  expect(menuButtonBox!.y).toBeLessThan(avatarBox!.y + avatarBox!.height);

  await menuButton.click();
  await expect(alicePage.getByTestId('next-turns-dialog')).toHaveCount(0);
  await expect(menuButton).toHaveCount(0);
  await expect(alicePage.getByTestId('taunt-picker')).toBeVisible();
  const [panelBox, pointerBox] = await Promise.all([
    alicePage.getByTestId('taunt-picker-panel').boundingBox(),
    alicePage.getByTestId('taunt-picker-pointer').boundingBox(),
  ]);
  expect(panelBox).not.toBeNull();
  expect(pointerBox).not.toBeNull();
  expect(panelBox!.y).toBeLessThanOrEqual(boardBefore!.y + 1);
  expect(Math.abs(pointerBox!.x + pointerBox!.width / 2 - (avatarBox!.x + avatarBox!.width / 2))).toBeLessThan(5);
  expect(pointerBox!.y).toBeLessThanOrEqual(avatarBox!.y + avatarBox!.height);

  await alicePage.getByTestId('taunt-picker-close-button').click();
  await expect(alicePage.getByTestId('next-turns-dialog')).toBeVisible();

  await menuButton.click();
  await alicePage.getByTestId('taunt-option-punch-me').click();
  await expect(alicePage.getByTestId('taunt-picker')).toHaveCount(0);
  await expect(alicePage.getByTestId('next-turns-dialog')).toBeVisible();
  await expect(menuButton).toHaveCount(0);
  await openGameFromLobby(bobPage, gameId);

  await expect(bobPage.getByTestId('opponent-turn-reveal')).toBeVisible({ timeout: 15_000 });
  await expect(bobPage.getByTestId('received-taunt')).toHaveCount(0);
  await expect(bobPage.getByTestId('opponent-turn-reveal')).toHaveCount(0, { timeout: 15_000 });
  await expect(bobPage.getByTestId('score-dice-overlay')).toBeVisible();
  await expect(bobPage.getByTestId('received-taunt')).toHaveCount(0);
  await expect(bobPage.getByTestId('score-dice-overlay')).toHaveCount(0, { timeout: 5_000 });
  await expect(bobPage.getByTestId('received-taunt')).toContainText('Punch me. I dare you.');
  await bobPage.waitForTimeout(1_000);
  await expect(bobPage.getByTestId('received-taunt')).toBeVisible();
  await expect(bobPage.getByTestId('received-taunt')).toHaveCount(0, { timeout: 1_500 });
});

test('friend games work when crypto.randomUUID is unavailable', async ({ browser }) => {
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const alice = await createUser(`no-uuid-alice-${runId}`, 'No UUID Alice E2E');
  const bob = await createUser(`no-uuid-bob-${runId}`, 'No UUID Bob E2E');
  const alicePage = await openAuthedPage(browser, alice);

  await alicePage.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    });
  });
  await alicePage.reload();
  await expect(alicePage.getByText(`Hi, ${alice.displayName}`)).toBeVisible();
  expect(await alicePage.evaluate(() => typeof globalThis.crypto.randomUUID)).toBe('undefined');

  await alicePage.getByTestId('start-with-friend-button').click();
  await alicePage.getByTestId('profile-search-input').fill(bob.displayName);
  await alicePage.getByTestId('profile-search-button').click();
  await alicePage.getByTestId(`profile-play-${bob.id}`).click();

  await expect(alicePage.getByText(`Game started with ${bob.displayName}.`)).toBeVisible();
  await expect(alicePage.getByTestId(new RegExp(`^game-card-`))).toContainText(bob.displayName);
});

test('awarding the section bonus stays legible and keeps the game usable', async ({ browser }) => {
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const alice = await createUser(`bonus-alice-${runId}`, 'Bonus Alice E2E');
  const bob = await createUser(`bonus-bob-${runId}`, 'Bonus Bob E2E');
  const alicePage = await openAuthedPage(browser, alice);
  const bobPage = await openAuthedPage(browser, bob);
  const gameId = await createAcceptedGame(alicePage, bobPage);

  await seedUpperBonusSetup(gameId, alice.id);
  await openGameFromLobby(alicePage, gameId);
  await expect(alicePage.getByTestId('roll-button')).toBeEnabled();
  await alicePage.getByTestId('roll-button').click();
  await waitForPressableEnabled(alicePage.getByTestId('home-score-box-ones'));
  await alicePage.getByTestId('home-score-box-ones').click();
  await expect(alicePage.getByTestId('play-score-button')).toBeEnabled();
  await alicePage.getByTestId('play-score-button').click();

  const bonusPanel = alicePage.getByTestId('section-bonus-panel');
  await expect(bonusPanel).toContainText('63/63', { timeout: 15_000 });
  await expect(alicePage.getByTestId('score-dice-overlay')).toHaveCount(0);
  await expect(alicePage.getByText('Something went wrong')).toHaveCount(0);
  await expect(bonusPanel).toHaveScreenshot('section-bonus-awarded.png');
});

test('keep playing rows show queued opponent profile avatars', async ({ browser }) => {
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const alice = await createUser(`queue-alice-${runId}`, 'Queue Alice E2E');
  const bob = await createUser(`queue-bob-${runId}`, 'Queue Bob E2E');
  const charlie = await createUser(`queue-charlie-${runId}`, 'Queue Charlie E2E');
  const avatarUrl = await seedProfileAvatar(charlie.id);
  const pages: Page[] = [];

  try {
    const alicePage = await openAuthedPage(browser, alice);
    pages.push(alicePage);
    expect(await alicePage.evaluate(async () => (await navigator.serviceWorker.getRegistration()) === undefined)).toBe(
      true,
    );
    const bobPage = await openAuthedPage(browser, bob);
    pages.push(bobPage);
    const charliePage = await openAuthedPage(browser, charlie);
    pages.push(charliePage);
    const currentGameId = await createAcceptedGame(alicePage, bobPage);
    const queuedGameId = await createAcceptedGame(alicePage, charliePage);
    const fallbackGameId = await createAcceptedGame(alicePage, bobPage);
    expect((await loadGame(currentGameId)).current_player_id).toBe(alice.id);
    expect((await loadGame(queuedGameId)).current_player_id).toBe(alice.id);
    expect((await loadGame(fallbackGameId)).current_player_id).toBe(alice.id);

    await openGameFromLobby(alicePage, currentGameId);
    await waitForPressableEnabled(alicePage.getByTestId('roll-button'));
    await alicePage.getByTestId('roll-button').click();
    const onesScoreBox = alicePage.getByTestId('home-score-box-ones');
    await waitForPressableEnabled(onesScoreBox);
    await onesScoreBox.click();
    await expect(alicePage.getByTestId('play-score-button')).toBeEnabled();
    await alicePage.getByTestId('play-score-button').click();

    const dialog = alicePage.getByTestId('next-turns-dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByTestId(/^next-turn-game-/)).toHaveCount(2);
    const queuedGameRow = dialog.getByTestId(`next-turn-game-${queuedGameId}`);
    await expect(queuedGameRow).toHaveAccessibleName(/Queue Charlie E2E/);
    const fallbackGameRow = dialog.getByTestId(`next-turn-game-${fallbackGameId}`);
    await expect(fallbackGameRow).toHaveAccessibleName(/Queue Bob E2E/);

    const avatarImage = queuedGameRow.getByTestId(`next-turn-avatar-${queuedGameId}-image`);
    await expect(avatarImage).toBeVisible();
    await expect
      .poll(async () =>
        avatarImage.evaluate((node) => {
          const image = node instanceof HTMLImageElement ? node : node.querySelector('img');
          return image?.complete && image.naturalWidth > 0 ? image.currentSrc || image.src : '';
        }),
      )
      .toBe(avatarUrl);
    await expect(fallbackGameRow.getByTestId(`next-turn-avatar-${fallbackGameId}-image`)).toHaveCount(0);
    await expect(dialog.getByLabel("Queue Charlie E2E's profile avatar", { exact: true })).toHaveCount(0);

    await queuedGameRow.click();
    await expect(alicePage).toHaveURL(`${e2eBaseUrl}/game/${queuedGameId}`);
    await expect(alicePage.getByTestId('next-turns-dialog')).toHaveCount(0);
  } finally {
    await Promise.all(pages.map((page) => page.context().close()));
  }
});

test('local computer token menu enables turn-start actions after computer scores a turn', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { height: 852, width: 393 } });
  await context.addInitScript(() => {
    Math.random = () => 0;
  });
  const page = await context.newPage();

  await page.goto(e2eBaseUrl);
  await page.getByTestId('play-computer-button').click();
  await expect(page.getByTestId('game-screen')).toBeVisible();

  await waitForPressableEnabled(page.getByTestId('token-menu-button'));
  await page.getByTestId('token-menu-button').click();
  await waitForPressableEnabled(page.getByTestId('token-option-extra-roll'));
  await waitForPressableEnabled(page.getByTestId('token-option-mulligan'));
  await waitForPressableEnabled(page.getByTestId('token-option-sucker-deal'));
  await expectPressableDisabled(page.getByTestId('token-option-sucker-punch'));
  await page.getByTestId('token-menu-close-button').click();

  await page.getByTestId('roll-button').click();
  await waitForPressableEnabled(page.getByTestId('home-score-box-ones'));
  await page.getByTestId('home-score-box-ones').click();
  await expect(page.getByTestId('play-score-button')).toBeEnabled();
  await page.getByTestId('play-score-button').click();

  await expect(page.getByTestId('opponent-score-box-sucker')).toContainText('50', { timeout: 15_000 });
  await waitForPressableEnabled(page.getByTestId('token-menu-button'));
  await page.getByTestId('token-menu-button').click();

  await waitForPressableEnabled(page.getByTestId('token-option-extra-roll'));
  await waitForPressableEnabled(page.getByTestId('token-option-mulligan'));
  await waitForPressableEnabled(page.getByTestId('token-option-sucker-deal'));
  const suckerPunchOption = page.getByTestId('token-option-sucker-punch');
  await waitForPressableEnabled(suckerPunchOption);
  await suckerPunchOption.click();
  await expect(page.getByTestId('sucker-punch-chance-dialog')).toBeVisible();
  const suckerPunchDieTrack = page.getByTestId('sucker-punch-chance-die-track');
  await expect(suckerPunchDieTrack).toBeVisible();
  await expect
    .poll(async () =>
      page.getByTestId('sucker-punch-chance-dialog').evaluate((node) => {
        const panel = node.firstElementChild;
        return panel ? getComputedStyle(panel).transform : null;
      }),
    )
    .toBe('none');
  await page.getByTestId('sucker-punch-chance-roll-button').click();
  await expect
    .poll(async () => suckerPunchDieTrack.evaluate((node) => getComputedStyle(node).transform), {
      intervals: [50, 50, 50, 100],
      timeout: 800,
    })
    .not.toBe('none');
  await expect(page.getByTestId('sucker-punch-chance-dialog')).toContainText(/Rolled [1-6]/, {
    timeout: 3_000,
  });
  await expect(page.getByTestId('sucker-punch-chance-dialog')).toContainText(/\d+% chance to land\./);
  await expect(page.getByTestId('sucker-punch-chance-roll-button')).toContainText('THROW PUNCH');
  await expect(suckerPunchDieTrack).toBeVisible();
  await page.getByTestId('sucker-punch-chance-roll-button').click();
  await expect(page.getByTestId('sucker-punch-chance-dialog')).toContainText(/Punch landed!|Punch blocked!/, {
    timeout: 3_000,
  });
  await expect(page.getByTestId('sucker-punch-result-image')).toBeVisible();
  await expect(page.getByTestId('sucker-punch-chance-roll-button')).toContainText('CONTINUE');
  await page.getByTestId('sucker-punch-chance-roll-button').click();
  await expect(page.getByTestId('sucker-punch-chance-dialog')).toBeHidden();
  const punchedOpponentScore = page.getByTestId('opponent-score-box-sucker');
  await expect(punchedOpponentScore).toContainText('50');
  await page.waitForTimeout(1_700);
  await expect(punchedOpponentScore).not.toContainText('50');
});

test('landed Sucker Punch wipes the score after the notification', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { height: 852, width: 393 } });
  await context.addInitScript(() => {
    Math.random = () => 0;
  });
  const page = await context.newPage();

  await page.goto('/local');
  await expect(page.getByTestId('game-screen')).toBeVisible();
  await page.getByTestId('roll-button').click();
  const suckerScoreBox = page.getByTestId('home-score-box-sucker');
  await waitForPressableEnabled(suckerScoreBox);
  await suckerScoreBox.click();
  await expect(page.getByTestId('play-score-button')).toBeEnabled();
  await page.getByTestId('play-score-button').click();

  const notice = page.getByTestId('sucker-punch-notice');
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await expect(notice).toContainText('Punch landed!');
  await expect(page.getByTestId('sucker-punch-recipient-result-image')).toBeVisible();
  await expect(page.getByTestId('sucker-punch-recipient-result-image')).toHaveAttribute('aria-label', 'Punch landed');
  await expect(notice).toBeHidden({ timeout: 5_000 });
  await page.waitForTimeout(200);
  await expect(suckerScoreBox).toContainText('50');
  await page.waitForTimeout(100);
  const impact = page.getByTestId('sucker-punch-impact');
  await expect(impact).toBeVisible();
  const impactCenterBeforeGrowth = await impact.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.waitForTimeout(180);
  const impactCenterAfterGrowth = await impact.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  expect(impactCenterAfterGrowth.x).toBeCloseTo(impactCenterBeforeGrowth.x, 1);
  expect(impactCenterAfterGrowth.y).toBeCloseTo(impactCenterBeforeGrowth.y, 1);
  await page.waitForTimeout(1_420);
  await expect(suckerScoreBox).not.toContainText('50');
});

test('blocked Sucker Punch shows the blocked artwork to the target', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { height: 852, width: 393 } });
  await context.addInitScript(() => {
    Math.random = () => 0.99;
  });
  const page = await context.newPage();

  await page.goto('/local');
  await expect(page.getByTestId('game-screen')).toBeVisible();
  await page.getByTestId('roll-button').click();
  const suckerScoreBox = page.getByTestId('home-score-box-sucker');
  await waitForPressableEnabled(suckerScoreBox);
  await suckerScoreBox.click();
  await expect(page.getByTestId('play-score-button')).toBeEnabled();
  await page.getByTestId('play-score-button').click();

  const notice = page.getByTestId('sucker-punch-blocked-notice');
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await expect(notice).toContainText('Punch blocked!');
  await expect(page.getByTestId('sucker-punch-recipient-result-image')).toBeVisible();
  await expect(page.getByTestId('sucker-punch-recipient-result-image')).toHaveAttribute('aria-label', 'Punch blocked');
  await expect(notice).toBeHidden({ timeout: 5_000 });
  await expect(suckerScoreBox).toContainText('50');
});

test('a player can add and remove a profile avatar in the PWA', async ({ browser }) => {
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const player = await createUser(`avatar-${runId}`, 'Avatar E2E');
  const impersonator = await createUser(`avatar-copy-${runId}`, 'Avatar Copy E2E');
  const page = await openAuthedPage(browser, player);

  await page.getByTestId('profile-button').click();
  await expect(page.getByTestId('profile-avatar')).toBeVisible();
  await expect(page.getByTestId('profile-avatar-image')).toHaveCount(0);

  await page.getByTestId('profile-avatar-button').click();
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('choose-avatar-library').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles('assets/icon.png');

  await expect(page.getByText('Profile photo updated.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('profile-avatar-image')).toBeVisible();
  await expect(page.getByTestId('multiplayer-lobby-shell')).toHaveScreenshot('profile-avatar.png', {
    mask: [page.getByTestId('username-input')],
    maskColor: '#FFF3C2',
  });
  await expect
    .poll(async () => {
      const { data, error } = await admin.from('profiles').select('avatar_url').eq('id', player.id).single();
      assertNoError(error);
      return data?.avatar_url ?? null;
    })
    .toMatch(/\/storage\/v1\/object\/public\/avatars\//);
  const { data: avatarProfile, error: avatarProfileError } = await admin
    .from('profiles')
    .select('avatar_url')
    .eq('id', player.id)
    .single();
  assertNoError(avatarProfileError);
  const avatarUrl = avatarProfile?.avatar_url ?? null;

  const { error: copyError } = await admin.from('profiles').update({ avatar_url: avatarUrl }).eq('id', impersonator.id);
  assertNoError(copyError);
  const impersonatorPage = await openAuthedPage(browser, impersonator);
  await impersonatorPage.getByTestId('profile-button').click();
  await expect(impersonatorPage.getByTestId('profile-avatar-image')).toHaveCount(0);

  await page.reload();
  await page.getByTestId('profile-button').click();
  await expect(page.getByTestId('profile-avatar-image')).toBeVisible();
  await page.getByTestId('screen-header-back-button').click();
  await page.getByTestId('play-computer-button').click();
  await expect(page.getByTestId('home-player-avatar-image')).toBeVisible();
  await page.getByLabel('Back to games').click();
  await page.getByTestId('profile-button').click();
  await page.getByTestId('profile-avatar-button').click();
  await page.getByTestId('remove-avatar').click();
  await expect(page.getByText('Profile photo removed.')).toBeVisible();
  await expect(page.getByTestId('profile-avatar-image')).toHaveCount(0);
  await expect
    .poll(async () => {
      const { data, error } = await admin.storage.from('avatars').list(player.id);
      assertNoError(error);
      return data?.filter((object) => object.name !== '.emptyFolderPlaceholder').length ?? 0;
    })
    .toBe(0);
});

test('player avatars open separate overall stats pages', async ({ browser }) => {
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const alice = await createUser(`stats-alice-${runId}`, 'Alice Stats E2E');
  const bob = await createUser(`stats-bob-${runId}`, 'Bob Stats E2E');
  await Promise.all([seedProfileAvatar(alice.id), seedProfileAvatar(bob.id)]);

  const alicePage = await openAuthedPage(browser, alice);
  const bobPage = await openAuthedPage(browser, bob);
  const gameId = await createAcceptedGame(alicePage, bobPage);

  const inserted = await Promise.all([
    admin.from('head_to_head_stats').insert({
      average_score: 150,
      games_played: 2,
      highest_score: 190,
      losses: 1,
      opponent_id: bob.id,
      player_id: alice.id,
      total_score: 300,
      wins: 1,
    }),
    admin.from('head_to_head_stats').insert({
      average_score: 165,
      games_played: 2,
      highest_score: 210,
      losses: 1,
      opponent_id: alice.id,
      player_id: bob.id,
      total_score: 330,
      wins: 1,
    }),
  ]);
  inserted.forEach((result) => assertNoError(result.error));

  await openGameFromLobby(alicePage, gameId);
  await alicePage.getByTestId('game-menu-button').click();
  await alicePage.getByTestId('game-stats-menu-item').click();

  const headToHeadPage = alicePage.getByTestId('stats-page-overlay');
  await expect(headToHeadPage).toBeVisible();
  await expect(headToHeadPage.getByText('Current Game')).toHaveCount(0);
  await expect(headToHeadPage.getByText('Overall Player Stats')).toHaveCount(0);
  await alicePage.getByTestId('stats-page-close-button').click();

  const homeAvatarButton = alicePage.getByTestId('home-player-avatar-stats-button');
  const opponentAvatarButton = alicePage.getByTestId('opponent-player-avatar-stats-button');
  await expect(homeAvatarButton).toHaveAccessibleName(`View ${alice.displayName}'s stats`);
  await expect(opponentAvatarButton).toHaveAccessibleName(`View ${bob.displayName}'s stats`);

  await homeAvatarButton.click();
  const playerStatsPage = alicePage.getByTestId('player-stats-page-overlay');
  await expect(playerStatsPage).toBeVisible();
  await expect(alicePage.getByTestId('player-stats-name')).toHaveText(alice.displayName);
  await expect(alicePage.getByTestId('player-stats-avatar-image')).toBeVisible();
  await expect(playerStatsPage.getByText('1-1')).toBeVisible();
  await expectNoSeriousAccessibilityViolations(alicePage);

  await alicePage.getByTestId('player-stats-back-button').click();
  await expect(playerStatsPage).toHaveCount(0);
  await expect(homeAvatarButton).toBeFocused();

  await opponentAvatarButton.click();
  await expect(playerStatsPage).toBeVisible();
  await expect(alicePage.getByTestId('player-stats-name')).toHaveText(bob.displayName);
  await expect(alicePage.getByTestId('player-stats-avatar-image')).toBeVisible();
  await expect(playerStatsPage.getByText('165')).toBeVisible();
  await expectNoSeriousAccessibilityViolations(alicePage);

  await alicePage.context().close();
  await bobPage.context().close();
});

async function openAuthedPage(browser: Browser, user: TestUser) {
  const context = await browser.newContext({ viewport: { height: 852, width: 393 } });
  const session = await createSession(user.email);
  await context.addInitScript(() => {
    const testWindow = window as Window & { PushManager?: unknown };
    const testNavigator = navigator as Navigator & { serviceWorker?: unknown };

    Object.defineProperty(testWindow, 'Notification', {
      configurable: true,
      value: {
        permission: 'default',
        requestPermission: async () => 'default',
      },
    });

    if (!('PushManager' in testWindow)) {
      Object.defineProperty(testWindow, 'PushManager', {
        configurable: true,
        value: function PushManager() {},
      });
    }

    if (!('serviceWorker' in testNavigator)) {
      Object.defineProperty(testNavigator, 'serviceWorker', {
        configurable: true,
        value: {},
      });
    }
  });
  await context.addInitScript(
    ({ accessToken, refreshToken, supabaseAnonKey, supabaseUrl }) => {
      (
        window as typeof window & {
          __SUCKER_E2E_MULTIPLAYER_CONFIG__?: {
            accessToken: string;
            refreshToken: string;
            supabaseAnonKey: string;
            supabaseUrl: string;
          };
        }
      ).__SUCKER_E2E_MULTIPLAYER_CONFIG__ = { accessToken, refreshToken, supabaseAnonKey, supabaseUrl };
    },
    {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      supabaseAnonKey: anonKey,
      supabaseUrl,
    },
  );
  const page = await context.newPage();
  const failedResponses = captureFailedResponses(page);

  await page.goto('/');
  try {
    await expect(page.getByText(`Hi, ${user.displayName}`)).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    const details = await describePage(page, failedResponses);
    const message = error instanceof Error ? error.message : String(error);
    await context.close().catch(() => undefined);
    throw new Error(`Authenticated lobby did not render.\n${details}\nOriginal error: ${message}`);
  }
  return page;
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      description: violation.description,
      id: violation.id,
      nodes: violation.nodes.map((node) => ({
        failureSummary: node.failureSummary,
        html: node.html,
        target: node.target.join(' '),
      })),
    }));
  expect(violations).toEqual([]);
}

function captureFailedResponses(page: Page) {
  const failedResponses: string[] = [];
  page.on('response', (response) => {
    if (response.status() < 400) {
      return;
    }

    void response
      .text()
      .then((body) => {
        failedResponses.push(`${response.status()} ${response.url()}\n${body.slice(0, 2_000)}`);
      })
      .catch((error) => {
        failedResponses.push(
          `${response.status()} ${response.url()}\nUnable to read response body: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  });
  return failedResponses;
}

async function describePage(page: Page, failedResponses: string[]) {
  const testIds = await page
    .locator('[data-testid]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute('data-testid'))
        .filter(Boolean)
        .slice(0, 20),
    )
    .catch(() => []);
  const bodyText = await page
    .locator('body')
    .innerText({ timeout: 1_000 })
    .catch((error) => `Unable to read body text: ${error instanceof Error ? error.message : String(error)}`);
  const bodyHtml = await page
    .locator('body')
    .evaluate((body) => body.innerHTML.slice(0, 1_000))
    .catch((error) => `Unable to read body HTML: ${error instanceof Error ? error.message : String(error)}`);

  return [
    `url: ${page.url()}`,
    `title: ${await page.title().catch(() => '')}`,
    `test ids: ${testIds.join(', ') || '(none)'}`,
    `body text: ${bodyText.slice(0, 1_000)}`,
    `body html: ${bodyHtml}`,
    `failed responses: ${failedResponses.join('\n---\n') || '(none)'}`,
    `script responses: ${await describeScriptResponses(page)}`,
  ].join('\n');
}

async function describeScriptResponses(page: Page) {
  const scriptUrls = await page
    .locator('script[src]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLScriptElement).src).filter(Boolean))
    .catch(() => []);

  if (scriptUrls.length === 0) {
    return '(none)';
  }

  const responses = await Promise.all(
    scriptUrls.map(async (scriptUrl) => {
      try {
        const response = await page.request.get(scriptUrl, { timeout: 15_000 });
        const body = await response.text();
        return `${response.status()} ${scriptUrl}\n${body.slice(0, 2_000)}`;
      } catch (error) {
        return `${scriptUrl}\nUnable to request script: ${error instanceof Error ? error.message : String(error)}`;
      }
    }),
  );

  return responses.join('\n---\n');
}

async function waitForPressableEnabled(locator: Locator) {
  await expect
    .poll(async () => {
      return locator.evaluate((node) => node.getAttribute('aria-disabled') === 'true');
    })
    .toBe(false);
}

async function expectPressableDisabled(locator: Locator) {
  await expect
    .poll(async () => {
      return locator.evaluate((node) => node.getAttribute('aria-disabled') === 'true');
    })
    .toBe(true);
}

async function openGameFromLobby(page: Page, gameId: string) {
  await page.goto('/');
  await expect(page.getByTestId('refresh-games-button')).toBeVisible();
  await dismissTurnNotificationPrompt(page);
  await page.getByTestId('refresh-games-button').click();
  await expect(page.getByTestId(`game-card-${gameId}`)).toBeVisible();
  await dismissTurnNotificationPrompt(page);
  await page.getByTestId(`game-card-${gameId}`).click();
}

async function createAcceptedGame(creatorPage: Page, joinerPage: Page) {
  await creatorPage.goto('/');
  await expect(creatorPage.getByTestId('refresh-games-button')).toBeVisible();
  await dismissTurnNotificationPrompt(creatorPage);
  await creatorPage.getByTestId('start-with-friend-button').click();
  await creatorPage.getByTestId('create-invite-button').click();
  const inviteCode = (await creatorPage.getByTestId('generated-invite-code').innerText()).trim();
  expect(inviteCode).toMatch(/^[A-F0-9]{8}$/);

  await joinerPage.goto('/');
  await expect(joinerPage.getByTestId('refresh-games-button')).toBeVisible();
  await dismissTurnNotificationPrompt(joinerPage);
  await joinerPage.getByTestId('start-with-friend-button').click();
  await joinerPage.getByTestId('invite-code-input').fill(inviteCode);
  await joinerPage.getByTestId('join-invite-button').click();

  return waitForAcceptedGame(inviteCode);
}

async function openGameFromNotification(page: Page, gameId: string) {
  await page.evaluate((targetGameId) => {
    navigator.serviceWorker.dispatchEvent(
      new MessageEvent('message', {
        data: {
          gameId: targetGameId,
          type: 'sucker.notification-click',
          url: `/?game=${encodeURIComponent(targetGameId)}`,
        },
      }),
    );
  }, gameId);
  await expect(page.getByTestId('game-screen')).toBeVisible();
}

async function dismissTurnNotificationPrompt(page: Page) {
  const prompt = page.getByTestId('turn-notification-prompt');
  const appeared = await prompt
    .waitFor({ state: 'visible', timeout: 1_000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await page.getByTestId('turn-notification-not-now').click();
  }
}

function observeEmailGreeting({ email, storageKey }: { email: string; storageKey: string }) {
  const observerWindow = window as typeof window & {
    __SUCKER_E2E_EMAIL_GREETING_OBSERVER__?: MutationObserver;
  };
  const startObserving = () => {
    observerWindow.__SUCKER_E2E_EMAIL_GREETING_OBSERVER__?.disconnect();
    const checkGreeting = () => {
      if (document.body.textContent?.includes(`Hi, ${email}`)) {
        sessionStorage.setItem(storageKey, 'true');
      }
    };
    const observer = new MutationObserver(checkGreeting);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    observerWindow.__SUCKER_E2E_EMAIL_GREETING_OBSERVER__ = observer;
    checkGreeting();
  };

  if (document.body) {
    startObserving();
  } else {
    document.addEventListener('DOMContentLoaded', startObserving, { once: true });
  }
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

async function seedProfileAvatar(profileId: string) {
  const avatarPath = `${profileId}/keep-playing.png`;
  const { error: uploadError } = await admin.storage
    .from('avatars')
    .upload(avatarPath, await readFile('assets/icon.png'), {
      contentType: 'image/png',
      upsert: true,
    });
  assertNoError(uploadError);

  const avatarUrl = admin.storage.from('avatars').getPublicUrl(avatarPath).data.publicUrl;
  const { error: profileError } = await admin.from('profiles').update({ avatar_url: avatarUrl }).eq('id', profileId);
  assertNoError(profileError);
  return avatarUrl;
}

async function upsertProfile(id: string, displayName: string, username: string) {
  const { error } = await admin.from('profiles').upsert({
    display_name: displayName,
    id,
    username,
  });
  assertNoError(error);
}

async function createSession(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    email,
    type: 'magiclink',
    options: { redirectTo: e2eBaseUrl },
  });
  assertNoError(error);

  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) {
    throw new Error(`Unable to generate a sign-in token for ${email}.`);
  }

  const client = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: verified, error: verifyError } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  assertNoError(verifyError);
  if (!verified.session) {
    throw new Error(`Unable to create a test session for ${email}.`);
  }
  return verified.session;
}

async function waitForAcceptedGame(inviteCode: string) {
  const gameId = await expect
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

  await expect
    .poll(async () => {
      const game = await loadGame(gameId);
      return game.status === 'active' ? game.current_player_id : null;
    })
    .not.toBeNull();
  return gameId;
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

async function seedUpperBonusSetup(gameId: string, playerId: string) {
  const game = await loadGame(gameId);
  const state = game.state as {
    currentPlayerIndex: number;
    players: Array<{
      id: string;
      scorecard: Record<(typeof scoreCategories)[number], number | null>;
    }>;
  };
  const playerIndex = state.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) {
    throw new Error(`Player ${playerId} was not found in game ${gameId}.`);
  }

  const seededState = {
    ...state,
    currentPlayerIndex: playerIndex,
    dice: [1, 1, 1, 1, 1],
    extraRollsAvailable: 0,
    held: [false, false, false, false, false],
    phase: 'rolling',
    players: state.players.map((player) =>
      player.id === playerId
        ? {
            ...player,
            scorecard: {
              ...player.scorecard,
              fives: 15,
              fours: 20,
              ones: null,
              sixes: 0,
              threes: 15,
              twos: 8,
            },
          }
        : player,
    ),
    rollNumber: 0,
  };
  const { error } = await admin
    .from('games')
    .update({ current_player_id: playerId, state: seededState, status: 'active' })
    .eq('id', gameId);
  assertNoError(error);
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
