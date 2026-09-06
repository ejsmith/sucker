import { expect, test } from '@playwright/test';

test('section bonus exposes one summary instead of decorative outline text', async ({ page }) => {
  await page.goto('/local');
  const panel = page.getByTestId('section-bonus-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAccessibleName(
    /^Section bonus: 35 points at 63\. (You|Player): 0 of 63\. Computer: 0 of 63\.$/,
  );
  const tree = await panel.ariaSnapshot();
  expect(tree).not.toContain('+35');
  expect(tree.match(/Section bonus/g)).toHaveLength(1);
  await page.screenshot({ path: test.info().outputPath('section-bonus.png') });
});
