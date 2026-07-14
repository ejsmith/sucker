import { expect, test, type Locator, type Page } from '@playwright/test';

const e2eBaseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8081';
const minimumTouchTarget = 44;
const stageAspectRatio = 393 / 852;
const stageMaximum = { height: 932, width: 430 };

type AcceptedViewport = {
  height: number;
  insets: { bottom: number; left: number; right: number; top: number };
  key: string;
  label: string;
  width: number;
};

// This is an acceptance matrix, intentionally independent from the production
// layout presets. A production preset change must not silently change the test contract.
const acceptedViewports = [
  { key: 'se', label: 'iPhone SE', width: 375, height: 667, insets: { top: 20, right: 0, bottom: 0, left: 0 } },
  { key: 'mini', label: 'iPhone Mini', width: 375, height: 812, insets: { top: 50, right: 0, bottom: 34, left: 0 } },
  { key: 'iphone16', label: 'iPhone 16', width: 393, height: 852, insets: { top: 59, right: 0, bottom: 34, left: 0 } },
  { key: 'iphone17', label: 'iPhone 17', width: 402, height: 874, insets: { top: 62, right: 0, bottom: 34, left: 0 } },
  { key: 'max', label: 'iPhone Max', width: 430, height: 932, insets: { top: 59, right: 0, bottom: 34, left: 0 } },
  { key: 'android', label: 'Android', width: 360, height: 800, insets: { top: 24, right: 0, bottom: 24, left: 0 } },
  {
    key: 'androidLarge',
    label: 'large Android',
    width: 412,
    height: 915,
    insets: { top: 24, right: 0, bottom: 24, left: 0 },
  },
] as const satisfies readonly AcceptedViewport[];

const dynamicStateViewports = acceptedViewports.filter(({ key }) => ['se', 'iphone16', 'max'].includes(key));
const asymmetricInsetViewport = {
  key: 'asymmetric',
  label: 'asymmetric safe area',
  width: 393,
  height: 852,
  insets: { top: 59, right: 4, bottom: 34, left: 12 },
} as const satisfies AcceptedViewport;

test.describe('font loading fallback', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Font request interception is covered in Chromium.');

  test('font load failures keep the app usable with platform fallback fonts', async ({ browser }) => {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { height: 852, width: 393 },
    });
    const page = await context.newPage();
    const failedFamilies = new Set<string>();

    await page.route(/Inter_(800ExtraBold|900Black).*\.ttf(?:\?.*)?$/, async (route) => {
      const family = route
        .request()
        .url()
        .match(/Inter_(800ExtraBold|900Black)/)?.[1];
      if (family) {
        failedFamilies.add(family);
      }
      await route.abort('failed');
    });

    try {
      await page.goto(e2eBaseUrl);
      await expect.poll(() => [...failedFamilies].sort()).toEqual(['800ExtraBold', '900Black']);
      await expect(page.getByTestId('play-computer-button')).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

test.describe('Chromium pixel baselines', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Pixel baselines are intentionally Chromium-only.');

  for (const viewport of acceptedViewports) {
    test(`game layout fits the ${viewport.label} viewport`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { height: viewport.height, width: viewport.width } });
      const page = await context.newPage();

      try {
        await openLocalGame(page, `/?viewport=${viewport.key}`);

        const screen = page.getByTestId('game-screen');
        const screenBox = await visibleBox(screen);
        expectSafeStageGeometry(screenBox, viewport);

        await expect(page.getByTestId('game-stage-scroll')).toHaveCount(0);
        await expectLayoutStackToFit(page, screenBox);
        await expectNoOverflow(page, screen);
        await expect(screen).toHaveScreenshot(`game-${viewport.key}.png`);
      } finally {
        await context.close();
      }
    });
  }

  for (const viewport of acceptedViewports) {
    test(`${viewport.label} keeps rolled and held dice flush with their slots`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { height: viewport.height, width: viewport.width } });
      const page = await context.newPage();
      await installDeterministicNonSuckerRandom(page);

      try {
        await openLocalGame(page, `/?viewport=${viewport.key}`);
        const rollButton = page.getByTestId('roll-button');
        await waitForPressableEnabled(rollButton);
        await rollButton.click();

        const diceTray = page.getByTestId('dice-tray');
        await expect(diceTray.locator('svg')).toHaveCount(5);
        for (const index of [0, 2]) {
          const die = page.getByTestId(`die-slot-${index}`);
          await waitForPressableEnabled(die);
          await die.click();
          await expect(die).toHaveAccessibleName(/, held$/);
        }

        await expect(diceTray).toHaveScreenshot(`dice-tray-${viewport.key}.png`);
      } finally {
        await context.close();
      }
    });
  }

  test('a rolling die lands at its permanent rendered size without a post-roll jump', async ({ page }) => {
    await page.setViewportSize({ height: 852, width: 393 });
    await installDeterministicNonSuckerRandom(page);
    await openLocalGame(page, '/?viewport=iphone16');

    const slot = page.getByTestId('die-slot-0');
    const slotBorderWidth = await slot.evaluate((node) => Number.parseFloat(getComputedStyle(node).borderLeftWidth));
    const rollButton = page.getByTestId('roll-button');
    await waitForPressableEnabled(rollButton);
    await rollButton.click();

    const flyingDie = page.getByTestId('flying-die-0');
    await expect(flyingDie).toBeVisible();
    await expect(slot).toHaveCSS('opacity', '1');
    await expect
      .poll(
        async () => {
          const [flyingBox, slotBox] = await Promise.all([flyingDie.boundingBox(), slot.boundingBox()]);
          if (!flyingBox || !slotBox) {
            return false;
          }
          const landingSize = Math.min(slotBox.width, slotBox.height) - slotBorderWidth * 2;

          return (
            Math.abs(flyingBox.width - landingSize) <= 0.5 &&
            Math.abs(flyingBox.height - landingSize) <= 0.5 &&
            Math.abs(centerX(flyingBox) - centerX(slotBox)) <= 0.5 &&
            Math.abs(centerY(flyingBox) - centerY(slotBox)) <= 0.5
          );
        },
        { intervals: [10, 10, 20, 20], timeout: 2500 },
      )
      .toBe(true);

    await expect(flyingDie).toHaveCount(0);
    const [finalDieBox, slotBox] = await Promise.all([visibleBox(slot.locator('svg')), visibleBox(slot)]);
    const landingSize = Math.min(slotBox.width, slotBox.height) - slotBorderWidth * 2;
    expect(Math.abs(finalDieBox.width - landingSize)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(finalDieBox.height - landingSize)).toBeLessThanOrEqual(0.5);
  });

  test('scoring animation leaves every vacated dice slot black', async ({ page }) => {
    await page.setViewportSize({ height: 852, width: 393 });
    await installDeterministicNonSuckerRandom(page);
    await openLocalGame(page, '/?viewport=iphone16');

    const rollButton = page.getByTestId('roll-button');
    await waitForPressableEnabled(rollButton);
    await rollButton.click();
    await expect(page.getByTestId('dice-tray').locator('svg')).toHaveCount(5);

    for (const index of [0, 1, 3]) {
      const die = page.getByTestId(`die-slot-${index}`);
      await waitForPressableEnabled(die);
      await die.click();
      await expect(die).toHaveAccessibleName(/, held$/);
    }

    const score = page.getByTestId('home-score-box-ones');
    await waitForPressableEnabled(score);
    await score.click();
    const playScore = page.getByTestId('play-score-button');
    await expect(playScore).toBeEnabled();
    await playScore.click();
    await expect(page.getByTestId('score-dice-overlay')).toBeVisible();

    const slotBackgrounds = await Promise.all(
      [...Array(5)].map((_, index) =>
        page.getByTestId(`die-slot-${index}`).evaluate((node) => getComputedStyle(node).backgroundColor),
      ),
    );
    expect(new Set(slotBackgrounds)).toEqual(new Set(['rgb(33, 5, 5)']));
  });

  test('wide web layouts center and cap the game stage', async ({ browser }) => {
    const viewport = { height: 900, width: 1440 };
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    try {
      await openLocalGame(page, '/');

      const screen = page.getByTestId('game-screen');
      const screenBox = await visibleBox(screen);

      expect(screenBox.width).toBeLessThanOrEqual(stageMaximum.width);
      expect(screenBox.height).toBeLessThanOrEqual(stageMaximum.height);
      expectProportionalWebStage(screenBox);
      expect(screenBox.x).toBeCloseTo((viewport.width - screenBox.width) / 2, 0);
      expect(screenBox.y).toBeCloseTo((viewport.height - screenBox.height) / 2, 0);

      await expect(page.getByTestId('game-stage-scroll')).toHaveCount(0);
      await expectLayoutStackToFit(page, screenBox);
      await expectNoOverflow(page, screen);
      await expect(screen).toHaveScreenshot('game-wide-web.png');
    } finally {
      await context.close();
    }
  });

  test('browser zoom shaped windows preserve the phone composition', async ({ browser }) => {
    const viewport = { height: 576, width: 454 };
    const context = await browser.newContext({
      deviceScaleFactor: 1.5,
      viewport: { height: 900, width: 900 },
    });
    const page = await context.newPage();

    try {
      await openLocalGame(page, '/');
      expect(await page.evaluate(() => devicePixelRatio)).toBe(1.5);
      await page.setViewportSize(viewport);

      const screen = page.getByTestId('game-screen');
      await expect.poll(async () => (await screen.boundingBox())?.width ?? 0).toBeCloseTo(320, 0);
      const screenBox = await visibleBox(screen);
      expectProportionalWebStage(screenBox);
      expect(screenBox.x).toBeCloseTo((viewport.width - screenBox.width) / 2, 0);

      const stageScroll = page.getByTestId('game-stage-scroll');
      await expect(stageScroll).toBeVisible();
      const scrollMetrics = await stageScroll.evaluate((node) => ({
        clientHeight: node.clientHeight,
        clientWidth: node.clientWidth,
        scrollHeight: node.scrollHeight,
        scrollWidth: node.scrollWidth,
      }));
      expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
      expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(scrollMetrics.clientWidth + 1);
      await expectUniformGameScale(page, screenBox);
      await expectLayoutStackToFit(page, screenBox);
      await expectNoHorizontalPageOverflow(page);
      await expect(page).toHaveScreenshot('game-browser-zoom.png');
    } finally {
      await context.close();
    }
  });

  for (const viewport of dynamicStateViewports) {
    test(`${viewport.label} renders scoring, menus, and overlays`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { height: viewport.height, width: viewport.width } });
      const page = await context.newPage();
      await installDeterministicNonSuckerRandom(page);

      try {
        await openLocalGame(page, `/?viewport=${viewport.key}`);
        const rollButton = page.getByTestId('roll-button');
        const categoryAction = page.getByRole('button', { name: /Ones category for/ });
        await expect(categoryAction).toHaveCount(1);
        await expect(categoryAction).toBeDisabled();
        await expect(page.getByLabel('Player, Ones score: Not scored')).toHaveCount(1);
        await expect(page.getByLabel('Computer, Ones score: Not scored')).toHaveCount(1);
        await expect(rollButton).toHaveAccessibleName('Roll dice');
        await waitForPressableEnabled(rollButton);
        await rollButton.click();

        const selectedScore = page.getByTestId('home-score-box-ones');
        await waitForPressableEnabled(selectedScore);
        await expect(page.getByTestId('dice-tray').locator('svg')).toHaveCount(5);
        await expect(page.getByTestId('sucker-roll-notice')).toHaveCount(0);
        await expect(categoryAction).toBeEnabled();
        await expect(selectedScore).toHaveAttribute('aria-hidden', 'true');
        await expect(page.getByTestId('opponent-score-box-ones')).toHaveAttribute('aria-hidden', 'true');
        await selectedScore.click();
        await expect(selectedScore).not.toHaveText('');
        await expect(page.getByLabel('Player, Ones score: 1 points, preview')).toHaveCount(1);
        await expect(page.getByLabel('Computer, Ones score: Not scored')).toHaveCount(1);
        await expect(categoryAction).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('play-score-button')).toBeEnabled();
        const screen = page.getByTestId('game-screen');
        await expect(screen).toHaveScreenshot(`game-${viewport.key}-scoring.png`);

        const tokenButton = page.getByTestId('token-menu-button');
        await waitForPressableEnabled(tokenButton);
        await tokenButton.click();
        const tokenMenu = page.getByTestId('token-menu-overlay');
        await expect(tokenMenu).toBeVisible();

        const screenBox = await visibleBox(screen);
        await expectContainedBy(tokenMenu, screenBox);
        await expectMinimumTouchTarget(selectedScore);
        await expectMinimumTouchTarget(page.getByTestId('opponent-score-box-ones'));
        await expectMinimumTouchTarget(page.getByTestId('token-menu-close-button'));
        await expectMinimumTouchTarget(rollButton);
        await expectMinimumTouchTarget(tokenButton);
        await expectMinimumTouchTarget(page.getByTestId('play-score-button'));
        await expectNoOverflow(page, screen);
        await expect(screen).toHaveScreenshot(`game-${viewport.key}-dynamic.png`);

        await page.getByTestId('token-menu-close-button').click();
        await page.getByTestId('game-menu-button').click();
        const headerMenu = page.getByTestId('game-top-menu');
        const statsMenuItem = page.getByTestId('game-stats-menu-item');
        await expect(headerMenu).toBeVisible();
        await expectContainedBy(headerMenu, screenBox);
        await expectMinimumTouchTarget(statsMenuItem);
        await expectContainedBy(statsMenuItem, screenBox);
        await expect(screen).toHaveScreenshot(`game-${viewport.key}-header-menu.png`);
        await statsMenuItem.click();

        const statsOverlay = page.getByTestId('stats-page-overlay');
        await expect(statsOverlay).toBeVisible();
        await expect(page.getByRole('dialog', { name: 'Game stats' })).toHaveCount(1);
        await expect(screen).toHaveAttribute('aria-hidden', 'true');
        await expect(page.getByRole('button')).toHaveCount(1);
        await expect(page.getByText('No saved stats yet')).toBeVisible();
        await expectContainedBy(statsOverlay, screenBox);
        const statsCloseButton = page.getByTestId('stats-page-close-button');
        await expectMinimumTouchTarget(statsCloseButton);
        await expect(statsCloseButton).toHaveAccessibleName('Close stats');
        await expect(statsCloseButton).toBeFocused();
        await expectNoOverflow(page, screen);
        await expect(screen).toHaveScreenshot(`game-${viewport.key}-stats-overlay.png`);
        if (viewport.key === 'iphone16') {
          await page.keyboard.press('Escape');
        } else {
          await statsCloseButton.click();
        }
        await expect(statsOverlay).toHaveCount(0);
        await expect(page.getByTestId('game-menu-button')).toBeFocused();
      } finally {
        await context.close();
      }
    });
  }
});

test('unequal horizontal safe-area insets size and position the game stage', async ({ page }) => {
  await page.setViewportSize({ height: asymmetricInsetViewport.height, width: asymmetricInsetViewport.width });
  await openLocalGame(page, `/?viewport=${asymmetricInsetViewport.key}`);

  const screen = page.getByTestId('game-screen');
  const screenBox = await visibleBox(screen);
  expectSafeStageGeometry(screenBox, asymmetricInsetViewport);
  await expect(page.getByTestId('game-stage-scroll')).toHaveCount(0);
  await expectLayoutStackToFit(page, screenBox);
  await expectNoOverflow(page, screen);
});

test('a short desktop viewport keeps the full game reachable in a vertical stage scroller', async ({ page }) => {
  await page.setViewportSize({ height: 450, width: 720 });
  await installDeterministicNonSuckerRandom(page);
  await openLocalGame(page, '/');

  const stageScroll = page.getByTestId('game-stage-scroll');
  await expect(stageScroll).toBeVisible();
  const scrollMetrics = await stageScroll.evaluate((node) => ({
    clientHeight: node.clientHeight,
    clientWidth: node.clientWidth,
    scrollHeight: node.scrollHeight,
    scrollWidth: node.scrollWidth,
  }));
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
  expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(scrollMetrics.clientWidth + 1);
  await expectNoHorizontalPageOverflow(page);

  const controls = page.getByTestId('game-controls-row');
  await controls.scrollIntoViewIfNeeded();
  await expect(controls).toBeInViewport({ ratio: 1 });
  expect(await stageScroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

  const screenBox = await visibleBox(page.getByTestId('game-screen'));
  expectProportionalWebStage(screenBox);
  for (const testId of ['roll-button', 'token-menu-button', 'play-score-button']) {
    const control = page.getByTestId(testId);
    await expect(control).toBeInViewport({ ratio: 1 });
    await expectContainedBy(control, screenBox);
    await expectMinimumTouchTarget(control);
  }

  const rollButton = page.getByTestId('roll-button');
  await waitForPressableEnabled(rollButton);
  await rollButton.click();
  await expect(page.getByTestId('dice-tray').locator('svg')).toHaveCount(5);
});

test.describe('mobile WebKit geometry', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', 'This suite exercises the mobile WebKit engine.');

  for (const viewport of dynamicStateViewports) {
    test(`${viewport.label} honors safe-stage geometry in mobile WebKit`, async ({ page }) => {
      await page.setViewportSize({ height: viewport.height, width: viewport.width });
      await openLocalGame(page, `/?viewport=${viewport.key}`);

      expect(await page.evaluate(() => devicePixelRatio)).toBeGreaterThan(1);

      // locator.tap() requires a touch-enabled browser context, so exercising a
      // real control verifies the device descriptor without relying on WebKit's
      // platform-dependent navigator.maxTouchPoints value.
      const tokenButton = page.getByTestId('token-menu-button');
      await waitForPressableEnabled(tokenButton);
      await tokenButton.tap();
      const tokenMenu = page.getByTestId('token-menu-overlay');
      await expect(tokenMenu).toBeVisible();
      await page.getByTestId('token-menu-close-button').tap();
      await expect(tokenMenu).toHaveCount(0);

      const screen = page.getByTestId('game-screen');
      const screenBox = await visibleBox(screen);
      expectSafeStageGeometry(screenBox, viewport);
      await expect(page.getByTestId('game-stage-scroll')).toHaveCount(0);
      await expectLayoutStackToFit(page, screenBox);
      await expectNoOverflow(page, screen);
      await expectMinimumTouchTarget(page.getByTestId('roll-button'));
      await expectMinimumTouchTarget(page.getByTestId('token-menu-button'));
      await expectMinimumTouchTarget(page.getByTestId('play-score-button'));
    });
  }
});

async function openLocalGame(page: Page, path: string) {
  await page.goto(new URL(path, e2eBaseUrl).toString());
  await page.getByTestId('play-computer-button').click();
  await expect(page.getByTestId('game-screen')).toBeVisible();
  await page.waitForFunction(() => !document.querySelector('.__expo_fast_refresh_show'));
  await page.waitForTimeout(300);
}

async function installDeterministicNonSuckerRandom(page: Page) {
  await page.addInitScript(() => {
    const values = [0.01, 0.2, 0.4, 0.6, 0.8];
    let index = 0;
    Math.random = () => values[index++ % values.length];
  });
}

function expectSafeStageGeometry(
  screenBox: NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>,
  viewport: AcceptedViewport,
) {
  const expectedWidth = viewport.width - viewport.insets.left - viewport.insets.right;
  const expectedHeight = viewport.height - viewport.insets.top - viewport.insets.bottom;

  expect(screenBox.x).toBeCloseTo(viewport.insets.left, 0);
  expect(screenBox.y).toBeCloseTo(viewport.insets.top, 0);
  expect(screenBox.width).toBeCloseTo(expectedWidth, 0);
  expect(screenBox.height).toBeCloseTo(expectedHeight, 0);
}

function expectProportionalWebStage(screenBox: { height: number; width: number }) {
  expectPixelMatch(screenBox.width, screenBox.height * stageAspectRatio);
}

async function expectUniformGameScale(page: Page, screenBox: NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>) {
  const category = await visibleBox(page.getByTestId('category-button-ones'));
  const topBar = await visibleBox(page.getByTestId('game-top-bar'));
  const controls = await visibleBox(page.getByTestId('game-controls-row'));
  const scale = category.width / 64;

  expectPixelMatch(category.height, 68 * scale);
  expectPixelMatch(screenBox.width, 393 * scale);
  expectPixelMatch(topBar.width, 381 * scale);
  expectPixelMatch(topBar.height, 56 * scale);
  expectPixelMatch(controls.width, 381 * scale);
  expectPixelMatch(controls.height, 60 * scale);
}

function expectPixelMatch(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
}

async function expectLayoutStackToFit(page: Page, screenBox: NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>) {
  const topBar = await visibleBox(page.getByTestId('game-top-bar'));
  const backChevron = await visibleBox(page.getByTestId('game-back-chevron'));
  const menuDots = await visibleBox(page.getByTestId('game-menu-dots'));
  const playerStrip = await visibleBox(page.getByTestId('player-strip'));
  const board = await visibleBox(page.getByTestId('scorecard-board'));
  const diceTray = await visibleBox(page.getByTestId('dice-tray'));
  const controls = await visibleBox(page.getByTestId('game-controls-row'));
  const chanceScore = await visibleBox(page.getByTestId('home-score-box-chance'));
  const scoreAboveChance = await visibleBox(page.getByTestId('home-score-box-sucker'));

  expect(topBar.y).toBeGreaterThanOrEqual(screenBox.y);
  expectPixelMatch(centerY(backChevron), centerY(topBar));
  expectPixelMatch(centerY(menuDots), centerY(topBar));
  expectPixelMatch(centerY(backChevron), centerY(menuDots));
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

async function expectNoHorizontalPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow).toEqual({ body: 0, document: 0 });
}

async function expectContainedBy(
  locator: Locator,
  containerBox: { height: number; width: number; x: number; y: number },
) {
  const box = await visibleBox(locator);
  expect(box.x).toBeGreaterThanOrEqual(containerBox.x - 1);
  expect(box.y).toBeGreaterThanOrEqual(containerBox.y - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(containerBox.x + containerBox.width + 1);
  expect(bottom(box)).toBeLessThanOrEqual(bottom(containerBox) + 1);
}

async function expectMinimumTouchTarget(locator: Locator) {
  const box = await visibleBox(locator);
  expect(box.width).toBeGreaterThanOrEqual(minimumTouchTarget);
  expect(box.height).toBeGreaterThanOrEqual(minimumTouchTarget);
}

async function waitForPressableEnabled(locator: Locator) {
  await expect
    .poll(async () => locator.evaluate((node) => node.getAttribute('aria-disabled') === 'true'), { timeout: 15_000 })
    .toBe(false);
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

function centerX(box: { width: number; x: number }) {
  return box.x + box.width / 2;
}

function centerY(box: { height: number; y: number }) {
  return box.y + box.height / 2;
}
