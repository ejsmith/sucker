import { expect, test } from '@playwright/test';

test('rules stay optional and preserve the current turn and held dice', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('play-computer-button')).toBeVisible();
  await expect(page.getByText('New here? Learn to play')).toHaveCount(0);
  await page.getByTestId('play-computer-button').click();
  await expect(page.getByRole('dialog', { name: 'Game rules' })).toHaveCount(0);
  await page.getByTestId('roll-button').click();
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  const die = page.getByRole('button', { name: /^Die 1:/ });
  await die.click();
  const heldLabel = await die.getAttribute('aria-label');
  await page.getByTestId('game-menu-button').click();
  await page.getByTestId('game-rules-menu-item').click();
  const dialog = page.getByRole('dialog', { name: 'Game rules' });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('rules-close')).toBeFocused();
  await expect(page.getByTestId('game-screen')).toHaveAttribute('aria-hidden', 'true');
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.getByTestId('rules-section-scoring').click();
  await expect(dialog).toContainText('even with zero or a scratch');
  await page.getByTestId('rules-section-tokens').click();
  await expect(dialog).toContainText('Counterpunch');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('game-menu-button')).toBeFocused();
  await expect(page.getByTestId('game-screen')).not.toHaveAttribute('aria-hidden', 'true');
  await expect(die).toHaveAttribute('aria-label', heldLabel!);
  await expect(page.getByTestId('rolls-left-count')).toHaveText('3');
});

for (const viewport of [
  { width: 375, height: 667 },
  { width: 393, height: 852 },
  { width: 430, height: 932 },
]) {
  test(`menu actions are separated and rules fit at ${viewport.width} by ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/local');
    await page.getByTestId('game-menu-button').click();
    const menu = page.getByTestId('game-top-menu');
    const actions = menu.getByRole('button');
    await expect(actions).toHaveCount(3);
    const boxes = await actions.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height };
      }),
    );
    for (let index = 0; index < boxes.length; index += 1) {
      expect(boxes[index].height).toBeGreaterThanOrEqual(44);
      if (index > 0) expect(boxes[index].top - boxes[index - 1].bottom).toBeGreaterThanOrEqual(6);
    }
    await page.getByTestId('game-rules-menu-item').click();
    for (const section of ['basics', 'scoring', 'tokens']) {
      await page.getByTestId(`rules-section-${section}`).click();
      const panel = await page.getByTestId('rules-panel').boundingBox();
      expect(panel!.x).toBeGreaterThanOrEqual(0);
      expect(panel!.y).toBeGreaterThanOrEqual(0);
      expect(panel!.x + panel!.width).toBeLessThanOrEqual(viewport.width);
      expect(panel!.y + panel!.height).toBeLessThanOrEqual(viewport.height);
      await expect(page.getByTestId('rules-close')).toBeInViewport();
    }
    const indicator = page.getByTestId('rules-scroll-indicator');
    const thumb = page.getByTestId('rules-scroll-thumb');
    await expect(indicator).toBeVisible();
    const initialThumb = await thumb.boundingBox();
    await page.getByText('75%', { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByText('75%', { exact: true })).toBeInViewport();
    await expect.poll(async () => (await thumb.boundingBox())!.y).toBeGreaterThan(initialThumb!.y);
    await page.getByTestId('rules-section-scoring').click();
    await expect(indicator).toBeVisible();
    await expect.poll(async () => (await thumb.boundingBox())!.y - (await indicator.boundingBox())!.y).toBe(0);
    if (viewport.height >= 852) {
      await page.getByTestId('rules-section-basics').click();
      await expect(indicator).toHaveCount(0);
    }
    await page.getByTestId('rules-close').click();
    await expect(page.getByTestId('game-menu-button')).toBeFocused();
  });
}
