import { expect, test } from '@playwright/test';

test('reduced motion keeps rolling dice in their slots', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/local');
  await page.evaluate(() => {
    const state = window as typeof window & { motionFlights?: number };
    state.motionFlights = 0;
    const observer = new MutationObserver(() => {
      state.motionFlights = Math.max(
        state.motionFlights ?? 0,
        document.querySelectorAll('[data-testid^="flying-die-"]').length,
      );
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await page.getByTestId('roll-button').click();
  await page.screenshot({ path: test.info().outputPath('reduced-motion-roll.png') });
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  const flights = await page.evaluate(() => (window as typeof window & { motionFlights?: number }).motionFlights);
  console.log(`Reduced-motion preference enabled; observed ${flights} flying dice.`);
  expect(flights).toBe(0);
  await expect(page.getByTestId('rolls-left-count')).toHaveText('3');
});

test('reduced motion preserves scores and Punch results without score flights', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto('/local');
  await page.evaluate(() => {
    const state = window as typeof window & { scoreFlights?: number; punchTransforms?: string[] };
    state.scoreFlights = 0;
    state.punchTransforms = [];
    new MutationObserver(() => {
      state.scoreFlights = Math.max(
        state.scoreFlights ?? 0,
        document.querySelectorAll('[data-testid="score-dice-overlay"]').length,
      );
      const die = document.querySelector('[data-testid="sucker-punch-chance-die-track"]');
      if (die) state.punchTransforms!.push(getComputedStyle(die).transform);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  });
  await page.getByTestId('roll-button').click();
  await page.getByTestId('home-score-box-ones').click();
  await page.getByTestId('play-score-button').click();
  await expect(page.getByTestId('opponent-score-box-sucker')).toContainText('50', { timeout: 20_000 });
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  await expect(page.getByTestId('home-score-box-ones')).toContainText('5');
  expect(await page.evaluate(() => (window as typeof window & { scoreFlights?: number }).scoreFlights)).toBe(0);
  await page.getByTestId('token-menu-button').click();
  await page.getByTestId('token-option-sucker-punch').click();
  await page.getByTestId('sucker-punch-chance-roll-button').click();
  await expect(page.getByTestId('sucker-punch-chance-roll-button')).toContainText('THROW PUNCH');
  await expect(page.getByTestId('sucker-punch-chance-panel')).toContainText('10% chance');
  const transforms = await page.evaluate(
    () => (window as typeof window & { punchTransforms?: string[] }).punchTransforms,
  );
  expect(transforms!.every((value) => value === 'none' || value === 'matrix(1, 0, 0, 1, 0, 0)')).toBe(true);
  await page.getByTestId('sucker-punch-chance-roll-button').click();
  await expect(page.getByTestId('sucker-punch-chance-roll-button')).toContainText('CONTINUE');
  await page.screenshot({ path: test.info().outputPath('reduced-motion-punch.png') });
  await page.getByTestId('sucker-punch-chance-roll-button').click();
  await expect(page.getByTestId('token-menu-button')).toContainText('7');
});
