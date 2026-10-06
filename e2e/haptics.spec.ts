import { expect, test, type Page } from '@playwright/test';

async function openLab(page: Page) {
  await page.getByTestId('game-menu-button').click();
  await page.getByTestId('game-haptics-menu-item').click();
  await expect(page.getByTestId('haptics-lab')).toBeVisible();
}

test('custom haptics migrate, tune, and save independently without changing the game', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'sucker.haptics.v1',
      JSON.stringify({
        punchLanded: { preset: 'rigid', gapMs: 100, delayMs: 0 },
        punchReceived: { preset: 'off', gapMs: 100, delayMs: 0 },
        sucker: { preset: 'success', gapMs: 100, delayMs: 0 },
      }),
    ),
  );
  await page.goto('/local');
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  const gameBefore = await page.evaluate(() => localStorage.getItem('sucker.computer-session.v1.guest'));
  expect(gameBefore).not.toBeNull();
  await openLab(page);
  await expect(page.getByRole('radio', { name: 'Crack effect', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('tab', { name: 'Getting punched' }).click();
  await expect(page.getByRole('radio', { name: 'Off effect', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Rumble effect', exact: true }).click();
  await page.getByRole('button', { name: 'Tune effect', exact: true }).click();
  await page.getByRole('button', { name: 'Decrease strength', exact: true }).click();
  await page.getByRole('button', { name: 'Decrease sharpness', exact: true }).click();
  await page.getByRole('button', { name: 'Increase duration', exact: true }).click();
  await page.getByRole('button', { name: 'Increase start delay', exact: true }).click();
  const tryButton = page.getByRole('button', { name: 'Try choice', exact: true });
  await expect(tryButton).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Use this in games', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('haptics-tuning.png') });
  await page.getByRole('button', { name: 'Use this in games', exact: true }).click();
  await expect(page.getByTestId('haptic-saved-choice')).toContainText(
    'Rumble · 500 ms · 75% strength · 25% sharpness · 25 ms delay',
  );
  await tryButton.click();
  await expect(page.getByTestId('haptic-moment-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Stop preview', exact: true }).click();
  await page.getByRole('button', { name: 'Close Haptics Lab', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('sucker.computer-session.v1.guest'))).toEqual(gameBefore);
  await page.reload();
  await openLab(page);
  await page.getByRole('tab', { name: 'Getting punched' }).click();
  await expect(page.getByTestId('haptic-saved-choice')).toContainText(
    'Rumble · 500 ms · 75% strength · 25% sharpness · 25 ms delay',
  );
  await page.getByRole('tab', { name: 'Landing a punch' }).click();
  await expect(page.getByTestId('haptic-saved-choice')).toContainText('Saved: Crack · 100 ms');
  await page.getByRole('tab', { name: 'Rolling a Sucker' }).click();
  await expect(page.getByTestId('haptic-saved-choice')).toContainText('Saved: Build & pop · 450 ms');
  const panel = await page.getByTestId('haptics-lab').boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.y).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(393);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(852);
  await page.screenshot({ path: test.info().outputPath('haptics-lab.png') });
});

test('failed saves and abandoned drafts leave the saved effect active', async ({ page }) => {
  await page.goto('/local');
  await openLab(page);
  await page.getByRole('radio', { name: 'Double hit effect', exact: true }).click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'sucker.haptics.v2') throw new Error('storage unavailable');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Use this in games', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save. Your previous choice is still active.');
  await expect(page.getByTestId('haptic-saved-choice')).toContainText('Saved: Crack');
  await page.getByRole('button', { name: 'Close Haptics Lab', exact: true }).click();
  await openLab(page);
  await expect(page.getByRole('radio', { name: 'Crack effect', exact: true })).toHaveAttribute('aria-checked', 'true');
});
