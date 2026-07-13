import { expect, test, type Locator, type Page } from '@playwright/test';
import { gameViewportPresets } from '../src/ui/gameLayout';
import { phoneStageMaxHeight, phoneStageMaxWidth } from '../src/ui/phoneStage';

const e2eBaseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8081';

for (const preset of gameViewportPresets) {
  test(`game layout fits the ${preset.label} viewport`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { height: preset.height, width: preset.width } });
    const page = await context.newPage();

    await openLocalGame(page, `/?viewport=${preset.key}`);

    const screen = page.getByTestId('game-screen');
    const screenBox = await visibleBox(screen);
    const expectedWidth = preset.width - preset.insets.left - preset.insets.right;
    const expectedHeight = preset.height - preset.insets.top - preset.insets.bottom;

    expect(screenBox.x).toBeCloseTo(preset.insets.left, 0);
    expect(screenBox.y).toBeCloseTo(preset.insets.top, 0);
    expect(screenBox.width).toBeCloseTo(expectedWidth, 0);
    expect(screenBox.height).toBeCloseTo(expectedHeight, 0);

    await expectLayoutStackToFit(page, screenBox);
    await expectNoOverflow(page, screen);
    await expect(screen).toHaveScreenshot(`game-${preset.key}.png`);

    await context.close();
  });
}

test('wide web layouts center and cap the game stage', async ({ browser }) => {
  const viewport = { height: 900, width: 1440 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  await openLocalGame(page, '/');

  const screen = page.getByTestId('game-screen');
  const screenBox = await visibleBox(screen);

  expect(screenBox.width).toBeLessThanOrEqual(phoneStageMaxWidth);
  expect(screenBox.height).toBeLessThanOrEqual(phoneStageMaxHeight);
  expect(screenBox.x).toBeCloseTo((viewport.width - screenBox.width) / 2, 0);
  expect(screenBox.y).toBeCloseTo((viewport.height - screenBox.height) / 2, 0);

  await expectLayoutStackToFit(page, screenBox);
  await expectNoOverflow(page, screen);
  await expect(screen).toHaveScreenshot('game-wide-web.png');

  await context.close();
});

async function openLocalGame(page: Page, path: string) {
  await page.goto(new URL(path, e2eBaseUrl).toString());
  await page.getByTestId('play-computer-button').click();
  await expect(page.getByTestId('game-screen')).toBeVisible();
  await page.waitForFunction(() => !document.querySelector('.__expo_fast_refresh_show'));
  await page.waitForTimeout(300);
}

async function expectLayoutStackToFit(page: Page, screenBox: NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>) {
  const topBar = await visibleBox(page.getByTestId('game-top-bar'));
  const playerStrip = await visibleBox(page.getByTestId('player-strip'));
  const board = await visibleBox(page.getByTestId('scorecard-board'));
  const diceTray = await visibleBox(page.getByTestId('dice-tray'));
  const controls = await visibleBox(page.getByTestId('game-controls-row'));
  const chanceScore = await visibleBox(page.getByTestId('home-score-box-chance'));
  const scoreAboveChance = await visibleBox(page.getByTestId('home-score-box-sucker'));

  expect(topBar.y).toBeGreaterThanOrEqual(screenBox.y);
  expect(bottom(topBar)).toBeLessThanOrEqual(playerStrip.y);
  expect(bottom(playerStrip)).toBeLessThanOrEqual(board.y);
  expect(bottom(board)).toBeLessThanOrEqual(diceTray.y);
  expect(bottom(diceTray)).toBeLessThanOrEqual(controls.y);
  expect(bottom(controls)).toBeLessThanOrEqual(bottom(screenBox) + 1);
  expect(chanceScore.x).toBeCloseTo(scoreAboveChance.x, 0);
  expect(chanceScore.width).toBeCloseTo(scoreAboveChance.width, 0);
}

async function expectNoOverflow(page: Page, screen: Locator) {
  const overflow = await page.evaluate(() => ({
    bodyHeight: document.body.scrollHeight - document.body.clientHeight,
    bodyWidth: document.body.scrollWidth - document.body.clientWidth,
    documentHeight: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    documentWidth: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  const screenOverflow = await screen.evaluate((node) => ({
    height: node.scrollHeight - node.clientHeight,
    width: node.scrollWidth - node.clientWidth,
  }));

  expect(overflow).toEqual({ bodyHeight: 0, bodyWidth: 0, documentHeight: 0, documentWidth: 0 });
  expect(screenOverflow).toEqual({ height: 0, width: 0 });
}

async function visibleBox(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

function bottom(box: { height: number; y: number }) {
  return box.y + box.height;
}
