import { expect, test } from '@playwright/test';

test('unavailable token actions explain timing and affordability', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/local');
  await page.getByTestId('token-menu-button').click();
  await expect(page.getByTestId('token-option-sucker-punch')).toContainText('before you start yours');
  await expect(page.getByTestId('token-option-sucker-punch')).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('availability-after.png') });
  for (let i = 0; i < 10; i += 1) {
    if (i > 0) await page.getByTestId('token-menu-button').click();
    await page.getByTestId('token-option-extra-roll').click();
  }
  await page.getByTestId('token-menu-button').click();
  await expect(page.getByTestId('token-option-extra-roll')).toContainText('Needs 1 token; you have 0');
  await expect(page.getByTestId('token-option-mulligan')).toContainText('Needs 3 tokens; you have 0');
  await expect(page.getByTestId('token-option-sucker-punch')).toContainText('Needs 3 tokens; you have 0');
  await expect(page.getByTestId('token-option-sucker-deal')).toBeEnabled();
});

for (const viewport of [
  { width: 393, height: 852 },
  { width: 375, height: 667 },
  { width: 430, height: 932 },
]) {
  test(`punch explains target and odds within ${viewport.width} by ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      Math.random = () => 0;
    });
    await page.goto('/local');
    await page.getByTestId('roll-button').click();
    await expect(page.getByTestId('home-score-box-ones')).toBeEnabled();
    await page.getByTestId('home-score-box-ones').click();
    await page.getByTestId('play-score-button').click();
    await expect(page.getByTestId('opponent-score-box-sucker')).toContainText('50', { timeout: 15_000 });
    await expect(page.getByTestId('token-menu-button')).toBeEnabled();
    await page.getByTestId('token-menu-button').click();
    await expect(page.getByTestId('token-option-sucker-punch')).toContainText('before rolling');
    await page.getByTestId('token-option-sucker-punch').click();
    const dialog = page.getByTestId('sucker-punch-chance-dialog');
    await expect(dialog).toContainText('Sucker · 50 points');
    await expect(page.getByTestId('sucker-punch-target')).toContainText('Computer');
    await expect(dialog).toContainText('Costs 3 tokens when you throw');
    for (const odds of ['1: 10%', '2: 20%', '3: 30%', '4: 45%', '5: 60%', '6: 75%'])
      await expect(dialog).toContainText(odds);
    const panel = await page.getByTestId('sucker-punch-chance-panel').boundingBox();
    expect(panel!.y).toBeGreaterThanOrEqual(0);
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: test.info().outputPath('punch-after.png') });
    await page.getByTestId('sucker-punch-chance-roll-button').click();
    await expect(dialog).toContainText(/Rolled [1-6]/);
    await expect(page.getByTestId('sucker-punch-target')).toContainText('Sucker · 50 points');
    await expect(page.getByTestId('token-menu-button')).toContainText('10');
  });
}
