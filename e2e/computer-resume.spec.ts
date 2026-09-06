import { expect, test, type Page } from '@playwright/test';
import { createGame, scoreCategories } from '../shared/game';
import { scoreLocalTurn } from '../src/game/computer';

for (const landed of [false, true]) {
  test(`resolved computer punch survives reload before dismissal (${landed ? 'landed' : 'missed'})`, async ({
    page,
  }) => {
    const game = createGame(['Player', 'Computer']);
    game.currentPlayerIndex = 1;
    game.dice = [6, 6, 6, 6, 6];
    game.phase = 'scoring';
    game.rollNumber = 1;
    const scored = scoreLocalTurn(game, 'sucker');
    const saved = {
      version: 1,
      game: scored.game,
      pendingTurn: scored.pendingTurn,
      actions: [],
      recordedGameIds: [],
      turns: [
        {
          player_id: game.players[1].id,
          category: 'sucker',
          score: 50,
          status: 'submitted',
          turn_index: 1,
          turn_id: scored.pendingTurn!.id,
        },
      ],
    };
    await page.addInitScript(
      ({ session, hit }) => {
        if (!localStorage.getItem('sucker.computer-session.v1.guest')) {
          localStorage.setItem('sucker.computer-session.v1.guest', JSON.stringify(session));
        }
        const original = Math.random;
        Math.random = () => (hit ? original() * 0.001 : 0.99 + original() * 0.001);
      },
      { session: saved, hit: landed },
    );
    await page.goto('/local');
    await page.getByTestId('token-menu-button').click();
    await page.getByTestId('token-option-sucker-punch').click();
    await page.getByTestId('sucker-punch-chance-roll-button').click();
    await expect(page.getByTestId('sucker-punch-chance-roll-button')).toContainText('THROW PUNCH');
    await page.getByTestId('sucker-punch-chance-roll-button').click();
    await expect(page.getByTestId('sucker-punch-chance-dialog')).toContainText(
      landed ? 'Punch landed!' : 'Punch blocked!',
    );
    await page.screenshot({ path: test.info().outputPath('punch-result.png') });
    await page.reload();
    await expect(page.getByTestId('roll-button')).toBeEnabled({ timeout: 25_000 });
    await page.screenshot({ path: test.info().outputPath('punch-reloaded.png') });
    await expect(page.getByTestId('token-menu-button')).toHaveText('7');
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('sucker.computer-session.v1.guest')!));
    expect(
      restored.actions.filter((action: { action_type: string }) => action.action_type === 'sucker_punch'),
    ).toHaveLength(1);
    expect(restored.turns[0].status).toBe(landed ? 'punched' : 'submitted');
    if (landed) expect(restored.pendingTurn?.id).not.toBe(scored.pendingTurn!.id);
    else expect(restored.pendingTurn).toBeNull();
  });
}

test('Play Computer starts a fresh game after a saved completed game', async ({ page }) => {
  const game = createGame(['Player', 'Computer']);
  game.phase = 'complete';
  for (const player of game.players) {
    for (const category of scoreCategories) player.scorecard[category] = 0;
  }
  const saved = { version: 1, game, pendingTurn: null, actions: [], turns: [], recordedGameIds: [game.id] };
  await page.addInitScript((session) => {
    if (!localStorage.getItem('sucker.computer-session.v1.guest')) {
      localStorage.setItem('sucker.computer-session.v1.guest', JSON.stringify(session));
    }
  }, saved);
  await page.goto('/');
  await expect(page.getByTestId('play-computer-button')).toHaveText('Play Computer');
  await page.getByTestId('play-computer-button').click();
  await page.screenshot({ path: test.info().outputPath('completed-game-entry.png') });
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  await expect(page.getByTestId('game-over-overlay')).toHaveCount(0);
  await expect(page.getByTestId('category-button-chance')).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  await expect(page.getByTestId('game-over-overlay')).toHaveCount(0);
});

async function diceLabels(page: Page) {
  return page
    .getByRole('button', { name: /^Die \d:/ })
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
}

test('a resolved roll survives reloading during the dice animation', async ({ page }) => {
  await page.goto('/local');
  await page.getByTestId('roll-button').click();
  await page.reload();
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('interrupted-roll.png') });
  await expect(page.getByTestId('roll-button')).toContainText('3');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sucker.computer-session.v1.guest')!));
  expect(saved.game.rollNumber).toBe(1);
  expect(saved.actions.filter((action: { action_type: string }) => action.action_type === 'roll')).toHaveLength(1);
});

test('an unreadable computer save requires explicit replacement', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sucker.computer-session.v1.guest', '{invalid'));
  await page.goto('/local');
  await expect(
    page.getByText('Your saved computer game could not be opened. Retry or start a new game.'),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('sucker.computer-session.v1.guest'))).toBe('{invalid');
  await page.getByTestId('confirm-new-computer-game').click();
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  await expect(page.getByTestId('token-menu-button')).toHaveText('10');
});

test('computer game keeps rolls, held dice, and tokens through navigation and reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('play-computer-button').click();
  await page.getByTestId('roll-button').click();
  const firstDie = page.getByRole('button', { name: /^Die 1:/ });
  await expect(firstDie).toBeEnabled();
  await firstDie.click();
  const expectedDice = await diceLabels(page);
  await page.getByTestId('token-menu-button').click();
  await page.getByTestId('token-option-extra-roll').click();
  await expect(page.getByTestId('token-menu-button')).toHaveText('9');
  await page.getByRole('button', { name: 'Back to games', exact: true }).click();
  await expect(page.getByTestId('play-computer-button')).toHaveText('Resume Computer Game');
  await page.getByTestId('play-computer-button').click();
  await expect(page.getByTestId('token-menu-button')).toHaveText('9');
  expect(await diceLabels(page)).toEqual(expectedDice);
  await page.reload();
  await expect(page.getByTestId('token-menu-button')).toHaveText('9');
  expect(await diceLabels(page)).toEqual(expectedDice);
  await expect(page.getByTestId('roll-button')).toContainText('4');

  await page.getByTestId('game-menu-button').click();
  await page.getByTestId('new-computer-game-button').click();
  await page.getByRole('button', { name: 'Keep Playing', exact: true }).click();
  await expect(page.getByTestId('token-menu-button')).toHaveText('9');
  await page.getByTestId('new-computer-game-button').click();
  await page.getByTestId('confirm-new-computer-game').click();
  await expect(page.getByTestId('token-menu-button')).toHaveText('10');
  await expect(page.getByTestId('category-button-chance')).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId('token-menu-button')).toHaveText('10');
});

test('computer scorecard survives reopening after the computer responds', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('play-computer-button').click();
  await page.getByTestId('roll-button').click();
  await page.getByTestId('category-button-chance').click();
  const preview = await page.getByRole('img', { name: /^Player, Chance score:.*preview$/ }).getAttribute('aria-label');
  await page.getByTestId('play-score-button').click();
  const scored = preview!.replace('preview', 'scored');
  await expect(page.getByRole('img', { name: scored, exact: true })).toBeVisible();
  await expect(page.getByTestId('roll-button')).toBeEnabled({ timeout: 25_000 });
  const strip = await page.getByTestId('player-strip').innerText();
  await page.getByRole('button', { name: 'Back to games', exact: true }).click();
  await page.getByTestId('play-computer-button').click();
  await expect(page.getByRole('img', { name: scored, exact: true })).toBeVisible();
  await expect(page.getByTestId('player-strip')).toHaveText(strip, { useInnerText: true });
  await page.reload();
  await expect(page.getByRole('img', { name: scored, exact: true })).toBeVisible();
});
