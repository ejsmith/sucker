import { expect, test } from '@playwright/test';

test('last turn identifies a scratched category', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/local');
  await page.getByTestId('roll-button').click();
  await expect(page.getByTestId('home-score-box-ones')).toBeEnabled();
  await page.getByTestId('token-menu-button').click();
  await page.getByTestId('token-option-sucker-deal').click();
  await page.getByTestId('home-score-box-ones').click();
  await page.getByTestId('game-menu-button').click();
  await page.getByTestId('game-last-turn-menu-item').click();
  await expect(page.getByTestId('last-turn-summary')).toContainText('You scratched Ones for 0 points');
  await page.screenshot({ path: test.info().outputPath('scratch-summary.png') });
});

for (const viewport of [
  { width: 393, height: 852 },
  { width: 375, height: 667 },
  { width: 430, height: 932 },
]) {
  test(`turn context preserves board geometry at ${viewport.width} by ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/local');
    await expect(page.getByTestId('player-strip')).toContainText('10 Tokens · Your turn');
    const board = await page.getByTestId('scorecard-board').boundingBox();
    await page.getByTestId('game-menu-button').click();
    await page.getByTestId('game-last-turn-menu-item').click();
    const dialog = page.getByRole('dialog', { name: 'Last turn', exact: true });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('last-turn-close')).toBeFocused();
    await expect(page.getByTestId('last-turn-summary')).toContainText('No turn has been completed');
    await expect(page.getByTestId('current-turn-summary')).toContainText('Your turn · Ready to roll');
    await expect(page.getByTestId('last-turn-close')).toBeInViewport();
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('game-menu-button')).toBeFocused();
    expect(await page.getByTestId('scorecard-board').boundingBox()).toEqual(board);
  });
}

test('last turn describes the computer result and preserves the current roll', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto('/local');
  await page.getByTestId('roll-button').click();
  await expect(page.getByTestId('home-score-box-ones')).toBeEnabled();
  await page.getByTestId('home-score-box-ones').click();
  await page.getByTestId('play-score-button').click();
  await expect(page.getByTestId('opponent-score-box-sucker')).toContainText('50', { timeout: 15_000 });
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  await page.getByTestId('game-menu-button').click();
  await page.getByTestId('game-last-turn-menu-item').click();
  await expect(page.getByTestId('last-turn-summary')).toContainText('Computer played Sucker for 50 points.');
  await page.screenshot({ path: test.info().outputPath('last-turn-after.png') });
  await page.getByTestId('last-turn-close').click();
  await page.getByTestId('roll-button').click();
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  await page.getByRole('button', { name: /^Die 1:/ }).click();
  const held = await page.getByRole('button', { name: /^Die 1:/ }).getAttribute('aria-label');
  await page.getByTestId('game-menu-button').click();
  await page.getByTestId('game-last-turn-menu-item').click();
  await expect(page.getByTestId('current-turn-summary')).toContainText('Your turn · Roll 1 of 4');
  await page.getByTestId('last-turn-close').click();
  await expect(page.getByRole('button', { name: /^Die 1:/ })).toHaveAttribute('aria-label', held!);
  await expect(page.getByTestId('rolls-left-count')).toHaveText('3');
});
