import { expect, test } from '@playwright/test';

for (const choice of ['score', 'scratch'] as const) {
  test(`zero-point ${choice} explains and applies the correct token outcome`, async ({ page }) => {
    await page.addInitScript(() => {
      Math.random = () => 0.2;
    });
    await page.goto('/local');
    await page.getByTestId('roll-button').click();
    await expect(page.getByTestId('roll-button')).toBeEnabled();
    await page.getByTestId('category-button-ones').click();
    await page.getByTestId('play-score-button').click();
    const dialog = page.getByRole('dialog', { name: 'Choose how to score zero' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('A normal zero earns no token.');
    await expect(dialog).toContainText('earns 1 token');
    await expect(page.getByTestId('zero-score-cancel')).toBeFocused();
    await page.screenshot({ path: test.info().outputPath('zero-score-choice.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('play-score-button')).toBeFocused();
    await expect(page.getByTestId('token-menu-button')).toHaveText('10');
    await page.getByTestId('play-score-button').click();
    await page.getByTestId(choice === 'score' ? 'zero-score-confirm' : 'zero-score-scratch').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('img', { name: 'You, Ones score: 0 points, scored', exact: true })).toBeVisible();
    await expect(page.getByTestId('token-menu-button')).toHaveText(choice === 'score' ? '10' : '11');
  });
}

test('positive scores keep their existing direct submission', async ({ page }) => {
  await page.goto('/local');
  await page.getByTestId('roll-button').click();
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  await page.getByTestId('category-button-chance').click();
  await page.getByTestId('play-score-button').click();
  await expect(page.getByTestId('zero-score-dialog')).toHaveCount(0);
  await expect(page.getByTestId('category-button-chance')).toBeDisabled();
});
