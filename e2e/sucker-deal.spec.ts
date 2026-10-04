import { expect, test } from '@playwright/test';
import { scoreCategories } from '../shared/game';

test('a computer-game player can sacrifice Chance on the first turn without rolling', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('play-computer-button').click();
  await expect(page.getByTestId('rolls-left-count')).toHaveText('4');
  await expect(page.getByTestId('token-menu-button')).toHaveText('10');
  await expect(page.getByTestId('category-button-chance')).toBeDisabled();
  await page.getByTestId('token-menu-button').click();
  await page.getByTestId('token-option-sucker-deal').click();
  for (const category of scoreCategories) {
    await expect(page.getByTestId(`category-button-${category}`)).toBeEnabled();
  }
  await page.getByTestId('category-button-chance').click();
  const scored = page.getByRole('img', { name: 'Player, Chance score: 0 points, scored', exact: true });
  await expect(scored).toBeVisible();
  await expect(page.getByTestId('token-menu-button')).toHaveText('11');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem('sucker.computer-session.v1.guest');
        return raw ? JSON.parse(raw).game.players[0].scorecard.chance : null;
      }),
    )
    .toBe(0);
  await page.reload();
  await expect(scored).toBeVisible();
  await expect(page.getByTestId('token-menu-button')).toHaveText('11');
  await page.screenshot({ path: test.info().outputPath('first-turn-computer-deal.png') });
});
