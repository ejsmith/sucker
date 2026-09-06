import { expect, test, type Page } from '@playwright/test';

async function diceLabels(page: Page) {
  return page
    .getByRole('button', { name: /^Die \d:/ })
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
}

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
