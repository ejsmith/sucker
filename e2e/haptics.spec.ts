import { expect, test } from '@playwright/test';

test('the game hides Haptics Lab and preserves saved haptic choices', async ({ page }) => {
  await page.goto('/local');
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  const savedHaptics = JSON.stringify({
    punchLanded: { preset: 'crack', durationMs: 800, strength: 100, sharpness: 50 },
    punchReceived: { preset: 'off' },
    sucker: { preset: 'doubleRev', durationMs: 850 },
  });
  await page.evaluate((raw) => localStorage.setItem('sucker.haptics.v2', raw), savedHaptics);
  await page.reload();
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  await page.getByTestId('game-menu-button').click();
  await expect(page.getByTestId('game-stats-menu-item')).toBeVisible();
  await expect(page.getByTestId('game-rules-menu-item')).toBeVisible();
  await expect(page.getByTestId('game-haptics-menu-item')).toHaveCount(0);
  await expect(page.getByTestId('haptics-lab')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('game-menu.png') });
  await page.getByRole('button', { name: 'Close menu', exact: true }).click();
  await page.getByTestId('roll-button').click();
  await expect(page.getByTestId('dice-tray').locator('svg')).toHaveCount(5);
  expect(await page.evaluate(() => localStorage.getItem('sucker.haptics.v2'))).toBe(savedHaptics);
});
