import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 375, height: 667 },
  { width: 430, height: 932 },
]) {
  test(`guide controls remain visible at ${viewport.width} by ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/local');
    await page.getByTestId('game-menu-button').click();
    await page.getByTestId('game-help-menu-item').click();
    for (let index = 0; index < 4; index += 1) await page.getByTestId('how-to-play-next').click();
    const panel = await page.getByTestId('how-to-play-panel').boundingBox();
    expect(panel!.y).toBeGreaterThanOrEqual(0);
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(viewport.height);
    const next = await page.getByTestId('how-to-play-next').boundingBox();
    expect(next!.y + next!.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: test.info().outputPath('guide-tokens.png') });
    await page.getByTestId('how-to-play-reference').click();
    await expect(page.getByRole('button', { name: 'Back to guide', exact: true })).toBeInViewport();
  });
}

test('the optional first-turn guide is available before signing in', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('learn-to-play-button').click();
  const dialog = page.getByRole('dialog', { name: 'How to Play Sucker' });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('how-to-play-close')).toBeFocused();
  for (let step = 1; step <= 5; step += 1) {
    await expect(dialog).toContainText(`Step ${step} of 5`);
    if (step === 5) await expect(dialog).toContainText('Mulligan costs 3 and restarts your current turn in computer and multiplayer games.');
    await page.getByTestId('how-to-play-next').click();
  }
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('learn-to-play-button')).toBeFocused();
  await expect(page.getByTestId('play-computer-button')).toBeVisible();
});

test('in-game help preserves rolls and held dice and exposes the scoring reference', async ({ page }) => {
  await page.goto('/local');
  await page.getByTestId('roll-button').click();
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  const die = page.getByRole('button', { name: /^Die 1:/ });
  await die.click();
  const heldLabel = await die.getAttribute('aria-label');
  await page.getByTestId('game-menu-button').click();
  await page.getByTestId('game-help-menu-item').click();
  const dialog = page.getByRole('dialog', { name: 'How to Play Sucker' });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('how-to-play.png') });
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.getByTestId('how-to-play-reference').click();
  await expect(dialog).toContainText('Three of one number plus two of another: 25 points.');
  await expect(dialog).toContainText('Four consecutive numbers: 30. Five consecutive numbers: 40.');
  await expect(dialog).toContainText('even with zero or a scratch');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('game-menu-button')).toBeFocused();
  await expect(die).toHaveAttribute('aria-label', heldLabel!);
  await expect(page.getByTestId('rolls-left-count')).toHaveText('3');
});
