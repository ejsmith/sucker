import { expect, test, type Page } from '@playwright/test';

async function openLab(page: Page) {
  await page.getByTestId('game-menu-button').click();
  await page.getByTestId('game-haptics-menu-item').click();
  await expect(page.getByTestId('haptics-lab')).toBeVisible();
}

test('custom haptics migrate, tune, and save independently without changing the game', async ({ page }) => {
  const invalidAttributeErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('non-boolean attribute')) {
      invalidAttributeErrors.push(message.text());
    }
  });
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
  await expect(page.getByRole('tab', { name: 'Tune effect', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Choose effect', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Crack effect', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('tab', { name: 'Getting punched' }).click();
  await expect(page.getByRole('radio', { name: 'Off effect', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Rumble effect', exact: true }).click();
  await page.getByRole('tab', { name: 'Tune effect', exact: true }).click();
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
    'Rumble · 460 ms · 95% strength · 45% sharpness · 10 ms delay',
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
    'Rumble · 460 ms · 95% strength · 45% sharpness · 10 ms delay',
  );
  await page.getByRole('tab', { name: 'Landing a punch' }).click();
  await expect(page.getByTestId('haptic-saved-choice')).toContainText('Saved: Crack · 100 ms');
  await page.getByRole('tab', { name: 'Rolling a Sucker' }).click();
  await expect(page.getByTestId('haptic-saved-choice')).toContainText('Saved: Double rev · 900 ms');
  const panel = await page.getByTestId('haptics-lab').boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.y).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(393);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(852);
  await page.screenshot({ path: test.info().outputPath('haptics-lab.png') });
  expect(invalidAttributeErrors).toEqual([]);
});

test('failed saves and abandoned drafts leave the saved effect active', async ({ page }) => {
  await page.goto('/local');
  await openLab(page);
  await page.getByRole('tab', { name: 'Choose effect', exact: true }).click();
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
  await page.getByRole('tab', { name: 'Choose effect', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Crack effect', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('mix and repeat edits preview in place, persist, and can be restored independently', async ({ page }) => {
  await page.goto('/local');
  await openLab(page);
  await page.getByRole('button', { name: 'Decrease strength', exact: true }).click();
  await expect(page.getByTestId('haptic-saved-choice')).toHaveText('Playing: Edited choice');
  await expect(page.getByTestId('haptic-moment-preview')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Decrease strength', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Hits, rumble, and repeats', exact: true }).click();
  await page.getByRole('button', { name: 'Decrease hit strength', exact: true }).click();
  await page.getByRole('button', { name: 'Decrease rumble strength', exact: true }).click();
  await page.getByRole('button', { name: 'Increase repeat count', exact: true }).click();
  await page.getByRole('button', { name: 'Increase repeat count', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Increase repeat count', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Increase repeat spacing', exact: true }).click();
  await expect(page.getByTestId('haptic-pattern-preview')).toHaveAttribute(
    'aria-label',
    '550 millisecond pattern, 3 strikes',
  );
  await expect(page.getByRole('button', { name: 'Use this in games', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('haptics-advanced.png') });
  await page.getByRole('button', { name: 'Use this in games', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sucker.haptics.v2')!));
  expect(saved.punchLanded).toMatchObject({
    preset: 'crack',
    strength: 95,
    hitStrength: 95,
    rumbleStrength: 95,
    repeatCount: 3,
    repeatGapMs: 125,
  });
  expect(saved.punchReceived).toMatchObject({ preset: 'bodyBlow', strength: 100, repeatCount: 1 });

  await page.getByRole('switch', { name: 'Preview changes', exact: true }).click();
  await page.getByRole('button', { name: 'Reset this effect', exact: true }).click();
  await expect(page.getByTestId('haptic-saved-choice')).toContainText('Saved: Crack · 550 ms');
  await expect(page.getByRole('button', { name: 'Stop preview', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('haptic-pattern-preview')).toHaveAttribute(
    'aria-label',
    '100 millisecond pattern, 1 strikes',
  );
  await page.getByRole('button', { name: 'Restore saved', exact: true }).click();
  await expect(page.getByTestId('haptic-pattern-preview')).toHaveAttribute(
    'aria-label',
    '550 millisecond pattern, 3 strikes',
  );
  await expect(page.getByRole('button', { name: 'Saved for gameplay', exact: true })).toBeDisabled();
  await page.reload();
  await openLab(page);
  await expect(page.getByTestId('haptic-pattern-preview')).toHaveAttribute(
    'aria-label',
    '550 millisecond pattern, 3 strikes',
  );
  await expect(page.getByTestId('haptic-saved-choice')).toContainText('Saved: Crack · 550 ms · 95% strength');
});

test('a long repeated effect keeps its preview open for the complete timeline', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'sucker.haptics.v2',
      JSON.stringify({
        sucker: { preset: 'buildPop', durationMs: 900, repeatCount: 3, repeatGapMs: 400 },
      }),
    ),
  );
  await page.goto('/local');
  await openLab(page);
  await page.getByRole('tab', { name: 'Rolling a Sucker', exact: true }).click();
  await expect(page.getByTestId('haptic-pattern-preview')).toHaveAttribute(
    'aria-label',
    '3500 millisecond pattern, 15 strikes',
  );
  await page.getByRole('button', { name: 'Try choice', exact: true }).click();
  await expect(page.getByTestId('haptic-moment-preview')).toBeVisible();
  // The original Sucker preview ends at 1250 ms; this pattern must keep playing.
  await page.waitForTimeout(1800);
  await expect(page.getByTestId('haptic-moment-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Stop preview', exact: true }).click();
  await expect(page.getByTestId('haptic-moment-preview')).toHaveCount(0);
  await expect(page.getByTestId('haptic-saved-choice')).toContainText('Saved: Build & pop · 3500 ms');
});

test('an existing Sucker choice can switch to Double rev, tune, and survive a reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('sucker.haptics.v2')) {
      localStorage.setItem('sucker.haptics.v2', JSON.stringify({ sucker: { preset: 'buildPop' } }));
    }
  });
  await page.goto('/local');
  await openLab(page);
  await page.getByRole('tab', { name: 'Rolling a Sucker', exact: true }).click();
  await expect(page.getByTestId('haptic-saved-choice')).toContainText('Saved: Build & pop · 450 ms');
  await page.getByRole('tab', { name: 'Choose effect', exact: true }).click();
  await page.getByRole('radio', { name: 'Double rev effect', exact: true }).click();
  await page.screenshot({ path: test.info().outputPath('haptics-double-rev-choice.png') });
  await page.getByRole('tab', { name: 'Tune effect', exact: true }).click();
  await expect(page.getByTestId('haptic-pattern-preview')).toHaveAttribute(
    'aria-label',
    '900 millisecond pattern, 0 strikes',
  );
  await page.getByRole('button', { name: 'Hits, rumble, and repeats', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Decrease hit strength', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Decrease rumble strength', exact: true }).click();
  await page.getByRole('button', { name: 'Decrease duration', exact: true }).click();
  await page.getByRole('button', { name: 'Use this in games', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sucker.haptics.v2')!));
  expect(saved.sucker).toMatchObject({ preset: 'doubleRev', durationMs: 890, rumbleStrength: 95, repeatCount: 1 });
  expect(saved.punchReceived.preset).toBe('bodyBlow');
  await page.reload();
  await openLab(page);
  await page.getByRole('tab', { name: 'Rolling a Sucker', exact: true }).click();
  await expect(page.getByTestId('haptic-saved-choice')).toContainText('Saved: Double rev · 890 ms');
  await page.screenshot({ path: test.info().outputPath('haptics-double-rev-tuning.png') });
});
