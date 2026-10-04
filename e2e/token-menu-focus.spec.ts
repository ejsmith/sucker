import { expect, test } from '@playwright/test';

test('token menu contains keyboard focus and restores it when dismissed', async ({ page }) => {
  await page.goto('/local');
  const opener = page.getByTestId('token-menu-button');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Sucker Tokens', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('token-menu-close-button')).toBeFocused();
  await expect(page.getByTestId('game-screen')).toHaveAttribute('aria-hidden', 'true');
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: test.info().outputPath('token-menu-focused.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.getByTestId('game-screen')).not.toHaveAttribute('aria-hidden', 'true');
  await opener.click();
  await page.getByTestId('token-option-extra-roll').click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toHaveText('9');
  await expect(opener).toBeFocused();
});

for (const viewport of [
  { width: 375, height: 667 },
  { width: 430, height: 932 },
]) {
  test(`token modal stays within the visible viewport at ${viewport.width} by ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/local');
    await page.getByTestId('token-menu-button').click();
    const stage = await page.getByTestId('game-screen').boundingBox();
    const overlay = await page.getByTestId('token-menu-overlay').boundingBox();
    expect(stage).not.toBeNull();
    expect(overlay).not.toBeNull();
    for (const key of ['x', 'width'] as const) expect(overlay![key]).toBeCloseTo(stage![key], 0);
    expect(overlay!.y).toBeGreaterThanOrEqual(0);
    expect(overlay!.y + overlay!.height).toBeLessThanOrEqual(viewport.height);
    const close = await page.getByTestId('token-menu-close-button').boundingBox();
    expect(close!.x).toBeGreaterThanOrEqual(stage!.x);
    expect(close!.y).toBeGreaterThanOrEqual(stage!.y);
    const lastOption = await page.getByTestId('token-option-sucker-punch').boundingBox();
    expect(lastOption!.y + lastOption!.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: test.info().outputPath('token-menu-viewport.png') });
    await page.getByTestId('token-menu-close-button').click();
    await expect(page.getByTestId('token-menu-button')).toBeFocused();
  });
}
