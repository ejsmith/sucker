import { expect, test } from '@playwright/test';

test('Fast pace shortens waiting with the same result and survives reopening', async ({ browser }) => {
  const elapsed: number[] = [];
  const replayElapsed: number[] = [];
  const results: string[][] = [];
  for (const fast of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
    try {
      await context.addInitScript(() => {
        Math.random = () => 0;
      });
      const page = await context.newPage();
      await page.goto('/local');
      await page.getByTestId('game-menu-button').click();
      await expect(page.getByTestId('computer-pace-button')).toBeEnabled();
      if (fast) await page.getByTestId('computer-pace-button').click();
      await expect(page.getByTestId('computer-pace-button')).toContainText(fast ? 'FAST' : 'NORMAL');
      await page.getByRole('button', { name: 'Close menu', exact: true }).click();
      await page.getByTestId('roll-button').click();
      await expect(page.getByTestId('home-score-box-ones')).toBeEnabled();
      await page.getByTestId('home-score-box-ones').click();
      const started = Date.now();
      await page.getByTestId('play-score-button').click();
      await expect(page.getByTestId('opponent-score-box-sucker')).toContainText('50', { timeout: 20_000 });
      await expect(page.getByTestId('roll-button')).toBeEnabled();
      elapsed.push(Date.now() - started);
      results.push(
        await Promise.all(
          ['home-score-box-ones', 'opponent-score-box-sucker', 'token-menu-button', 'player-strip'].map((id) =>
            page.getByTestId(id).innerText(),
          ),
        ),
      );
      await page.getByTestId('token-menu-button').click();
      await page.getByTestId('token-option-sucker-punch').click();
      await page.getByTestId('sucker-punch-chance-roll-button').click();
      await expect(page.getByTestId('sucker-punch-chance-roll-button')).toContainText('THROW PUNCH');
      await page.getByTestId('sucker-punch-chance-roll-button').click();
      await expect(page.getByTestId('sucker-punch-chance-dialog')).toContainText('Punch landed!');
      const replayStarted = Date.now();
      await page.getByTestId('sucker-punch-chance-roll-button').click();
      await expect(page.getByTestId('opponent-turn-reveal')).toBeVisible();
      replayElapsed.push(Date.now() - replayStarted);
      await expect(page.getByTestId('roll-button')).toBeEnabled({ timeout: 20_000 });
      await expect(page.getByTestId('token-menu-button')).toContainText('7');
      await page.getByTestId('game-menu-button').click();
      await page.reload();
      await expect(page.getByTestId('opponent-score-box-sucker')).toContainText('50');
      await page.getByTestId('game-menu-button').click();
      await expect(page.getByTestId('computer-pace-button')).toContainText(fast ? 'FAST' : 'NORMAL');
      if (fast) await page.screenshot({ path: test.info().outputPath('pace-after.png') });
    } finally {
      await context.close();
    }
  }
  console.log(
    `Normal: ${elapsed[0]} ms. Fast: ${elapsed[1]} ms. Same seeded scores and token balance: ${JSON.stringify(results)}.`,
  );
  expect(results[1]).toEqual(results[0]);
  expect(elapsed[0] - elapsed[1]).toBeGreaterThan(2000);
  console.log(`Replay reveal after landed Punch: Normal ${replayElapsed[0]} ms; Fast ${replayElapsed[1]} ms.`);
  expect(replayElapsed[0] - replayElapsed[1]).toBeGreaterThan(1500);
});

test('failed preference storage retains the active pace and explains the failure', async ({ page }) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'sucker.computerTurnSpeed.v1') throw new Error('Test storage failure');
      return setItem.call(this, key, value);
    };
  });
  await page.goto('/local');
  await page.getByTestId('game-menu-button').click();
  await page.getByTestId('computer-pace-button').click();
  await expect(page.getByText('Could not save computer pace. Try again.')).toBeVisible();
  await expect(page.getByTestId('computer-pace-button')).toContainText('NORMAL');
  await expect(page.getByTestId('computer-pace-button')).toBeEnabled();
});

for (const viewport of [
  { width: 375, height: 667 },
  { width: 430, height: 932 },
]) {
  test(`pace menu fits ${viewport.width} by ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/local');
    await page.getByTestId('game-menu-button').click();
    const menu = await page.getByTestId('game-top-menu').boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.y + menu!.height).toBeLessThanOrEqual(viewport.height);
    await page.getByTestId('computer-pace-button').click();
    await expect(page.getByTestId('computer-pace-button')).toContainText('FAST');
  });
}
