import { expect, test } from '@playwright/test';
import { createGame } from '../shared/game';
import { scoreLocalTurn } from '../src/game/computer';

test('enabling reduced motion during a Punch notice prevents its delayed wipe', async ({ page }) => {
  const game = createGame(['Player', 'Computer']);
  game.dice = [6, 6, 6, 6, 6];
  game.phase = 'scoring';
  game.rollNumber = 1;
  const scored = scoreLocalTurn(game, 'sucker');
  await page.addInitScript((session) => {
    localStorage.setItem('sucker.computer-session.v1.guest', JSON.stringify(session));
    Math.random = () => 0;
  }, { version: 1, game: scored.game, pendingTurn: scored.pendingTurn, actions: [], turns: [], recordedGameIds: [] });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/local');
  await expect(page.getByTestId('sucker-punch-notice')).toBeVisible({ timeout: 20_000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    const state = window as typeof window & { impactOpacity?: number };
    state.impactOpacity = 0;
    new MutationObserver(() => {
      for (const node of document.querySelectorAll('[data-testid="sucker-punch-impact"]')) {
        state.impactOpacity = Math.max(state.impactOpacity ?? 0, Number(getComputedStyle(node).opacity));
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
  });
  await expect(page.getByTestId('sucker-punch-notice')).toHaveCount(0);
  await expect(page.getByTestId('sucker-punch-score-wipe')).toHaveCount(0);
  const opacity = await page.evaluate(() => (window as typeof window & { impactOpacity?: number }).impactOpacity);
  console.log(`Reduce Motion enabled during notice; delayed impact maximum opacity: ${opacity}`);
  expect(opacity).toBe(0);
});

test('enabling reduced motion during an opponent reveal prevents new score flights', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.goto('/local');
  await page.getByTestId('roll-button').click();
  await page.getByTestId('home-score-box-ones').click();
  await page.getByTestId('play-score-button').click();
  await expect(page.getByTestId('opponent-turn-reveal')).toBeVisible({ timeout: 20_000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    const state = window as typeof window & { revealFlights?: number };
    state.revealFlights = 0;
    new MutationObserver(() => {
      state.revealFlights = Math.max(state.revealFlights ?? 0, document.querySelectorAll('[data-testid="score-dice-overlay"]').length);
    }).observe(document.body, { childList: true, subtree: true });
  });
  await expect(page.getByTestId('roll-button')).toBeEnabled();
  const flights = await page.evaluate(() => (window as typeof window & { revealFlights?: number }).revealFlights);
  console.log(`Reduce Motion enabled during opponent reveal; new score-flight overlays: ${flights}`);
  expect(flights).toBe(0);
  await expect(page.getByTestId('opponent-score-box-sucker')).toContainText('50');
});

test('enabling reduced motion cancels an active score flight and commits the score', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.goto('/local');
  await page.getByTestId('roll-button').click();
  await page.getByTestId('home-score-box-ones').click();
  await page.getByTestId('play-score-button').click();
  await expect(page.getByTestId('score-dice-overlay')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(200);
  expect(await page.getByTestId('score-dice-overlay').count()).toBe(0);
  await expect(page.getByTestId('home-score-box-ones')).toContainText('5');
});

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
