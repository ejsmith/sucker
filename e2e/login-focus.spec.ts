import { devices, expect, test, type Page } from '@playwright/test';
import { createGame } from '../shared/game';

for (const width of [393, 440]) {
  test(`installed PWA lobby scrolls to the screen edges (${width}px phone)`, async ({ browser }, testInfo) => {
    const height = width === 440 ? 956 : 852;
    const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width, height } });
    const page = await context.newPage();
    try {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
      });
      // The safe-area probe is intercepted at navigation, before the provider
      // measures it. This is deliberately independent of diagnostic presets.
      await page.route(/\/$/, async (route) => {
        if (!route.request().isNavigationRequest()) return route.continue();
        const response = await route.fetch();
        await route.fulfill({
          response,
          body: (await response.text()).replace(
            '</head>',
            '<style>[style*="safe-area-inset-top"] { padding: 62px 0 34px !important; }</style></head>',
          ),
        });
      });
      await mockKeyboardTestAccount(page, 8);
      await page.goto('/');
      await page.getByTestId('login-email-input').fill('keyboard@example.com');
      await page.getByTestId('send-code-button').click();
      await page.getByTestId('login-code-input').fill('123456');
      await page.getByTestId('verify-code-button').click();
      const scroll = page.getByTestId('lobby-games-scroll');
      await expect(page.getByText('8 active games')).toBeVisible();
      const shell = page.getByTestId('multiplayer-lobby-shell');
      await expect.poll(() => shell.boundingBox()).toMatchObject({ x: 0, y: 0, width, height });
      await expect.poll(() => scroll.boundingBox()).toMatchObject({ y: 0, height });
      const firstProfile = await page.getByTestId('profile-button').boundingBox();
      expect(firstProfile!.y).toBeGreaterThan(62);
      await page.screenshot({ path: testInfo.outputPath('pwa-lobby-top.png') });

      // A real content scroller must extend to the viewport edge. Outer safe
      // padding used to leave a permanent 46px band that clipped every card.
      await scroll.evaluate((node) => {
        node.scrollTop = 300;
      });
      await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
      await page.screenshot({ path: testInfo.outputPath('pwa-lobby-scrolled.png') });
      await scroll.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      const lastAction = page.getByTestId('play-computer-button');
      await expect(lastAction).toBeInViewport({ ratio: 1 });
      const lastBox = await lastAction.boundingBox();
      expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(height - 34);
      await page.screenshot({ path: testInfo.outputPath('pwa-lobby-bottom.png') });
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);

      await page.setViewportSize({ width, height: height - 62 });
      await expect.poll(() => shell.boundingBox()).toMatchObject({ x: 0, y: 0, width, height: height - 62 });
      await expect.poll(() => scroll.boundingBox()).toMatchObject({ y: 0, height: height - 62 });
      await scroll.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await expect(lastAction).toBeInViewport({ ratio: 1 });
    } finally {
      await context.close();
    }
  });
}

for (const userAgent of ['iPhone', 'Android', 'Macintosh']) {
  for (const installed of [false, true]) {
    test(`all text-entry screens preserve their size (${userAgent}, ${installed ? 'installed PWA' : 'browser'})`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript(
        ({ installed, userAgent }) => {
          Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent });
          Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
          Object.defineProperty(navigator, 'standalone', { configurable: true, value: installed });
          Object.defineProperty(screen, 'orientation', {
            configurable: true,
            value: Object.assign(new EventTarget(), { type: 'portrait-primary' }),
          });
        },
        { installed, userAgent },
      );
      await mockKeyboardTestAccount(page);
      await page.setViewportSize({ width: 393, height: 852 });
      await page.goto('/');
      const email = page.getByTestId('login-email-input');
      await expect(email).toBeVisible({ timeout: 20_000 });
      // Match actual keyboard entry. WebKit's bulk fill can race the initial
      // focus render and return with this controlled email field still empty.
      await email.click();
      await expect(email).toBeFocused();
      await email.pressSequentially('keyboard@example.com');
      await expect(email).toHaveValue('keyboard@example.com');
      await expect(page.getByTestId('send-code-button')).toBeEnabled();
      await page.getByTestId('send-code-button').click();
      await expect(page.getByTestId('login-code-input')).toBeVisible();
      await expectFieldOverlay(page, 'login-code-input', '123456');
      await page.getByTestId('verify-code-button').click();
      await expect(page.getByTestId('profile-button')).toBeVisible();
      await page.getByTestId('start-with-friend-button').click();
      await expectFieldOverlay(page, 'profile-search-input', 'friend');
      await expectFieldOverlay(page, 'invite-code-input', 'ABC123');
      await page.getByRole('button', { name: 'Back from Start With Friend', exact: true }).click();
      await page.getByTestId('profile-button').click();
      for (const [testId, value] of [
        ['display-name-input', 'Keyboard Test'],
        ['username-input', 'keyboard_test'],
        ['new-password-input', 'test-only-password'],
        ['confirm-password-input', 'test-only-password'],
      ]) {
        if (testId === 'new-password-input') {
          await page.getByTestId('toggle-password-editor').click();
          await expect(page.getByTestId('new-password-input')).toBeVisible();
        }
        await expectFieldOverlay(
          page,
          testId,
          value,
          installed && userAgent === 'iPhone' && testId === 'display-name-input'
            ? testInfo.outputPath('profile-keyboard-overlay.png')
            : undefined,
        );
      }
    });

    test(`focus preserves the displayed frame after a viewport settles (${userAgent}, ${installed ? 'installed PWA' : 'browser'})`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript(
        ({ installed, userAgent }) => {
          Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent });
          Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
          Object.defineProperty(navigator, 'standalone', { configurable: true, value: installed });
          Object.defineProperty(screen, 'orientation', {
            configurable: true,
            value: Object.assign(new EventTarget(), { type: 'portrait-primary' }),
          });
        },
        { installed, userAgent },
      );
      await page.setViewportSize({ width: 393, height: 852 });
      await page.goto('/');
      const email = page.getByTestId('login-email-input');
      const shell = page.getByTestId('multiplayer-lobby-shell');
      await expect(email).toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => (await shell.boundingBox())?.height).toBeCloseTo(852, 0);

      // Browser toolbars retain the full frame; an installed PWA must instead
      // follow its genuinely settled viewport before any field is focused.
      await page.setViewportSize({ width: 393, height: 797 });
      await expect.poll(async () => (await shell.boundingBox())?.height).toBeCloseTo(installed ? 797 : 852, 0);
      await expect.poll(async () => (await shell.boundingBox())?.width).toBeCloseTo(393, 0);
      const displayedShell = await shell.boundingBox();
      const displayedEmail = await email.boundingBox();
      await email.click();
      await expect(email).toBeFocused();
      await expect.poll(() => shell.boundingBox()).toEqual(displayedShell);
      await expect.poll(() => email.boundingBox()).toEqual(displayedEmail);
      await email.pressSequentially('toolbar@example.com');
      for (const height of [500, 350]) {
        await page.setViewportSize({ width: 393, height });
        await expect.poll(() => shell.boundingBox()).toEqual(displayedShell);
        await expect.poll(() => email.boundingBox()).toEqual(displayedEmail);
        await expect(email).toBeFocused();
        await expect(email).toHaveValue('toolbar@example.com');
        await expect(page.getByTestId('pwa-landscape-guard')).toHaveCount(0);
      }
      await page.setViewportSize({ width: 393, height: 797 });
      await email.evaluate((node: HTMLInputElement) => node.blur());
      await expect.poll(() => shell.boundingBox()).toEqual(displayedShell);
      if (userAgent === 'iPhone') {
        await page.screenshot({ path: testInfo.outputPath('settled-frame-after-keyboard.png') });
      }
    });

    test(`login retains keyboard focus through viewport resizing (${userAgent}, ${installed ? 'installed PWA' : 'browser'})`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript(
        ({ installed, userAgent }) => {
          Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent });
          Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
          Object.defineProperty(navigator, 'standalone', { configurable: true, value: installed });
          Object.defineProperty(screen, 'orientation', {
            configurable: true,
            value: Object.assign(new EventTarget(), { type: 'portrait-primary' }),
          });
        },
        { installed, userAgent },
      );
      await page.setViewportSize({ width: 393, height: 852 });
      await page.goto('/');

      const email = page.getByTestId('login-email-input');
      const shell = page.getByTestId('multiplayer-lobby-shell');
      await expect(email).toBeVisible({ timeout: 20_000 });
      const initialShell = await shell.boundingBox();
      const initialEmail = await email.boundingBox();
      if (installed && userAgent === 'iPhone') {
        await page.screenshot({ path: testInfo.outputPath('before-keyboard.png') });
      }
      await email.click();
      await expect(email).toBeFocused();
      // Changing the layout must preserve the actual input node as well as its value.
      const originalInput = await email.elementHandle();
      await page.keyboard.type('qa@');
      await page.setViewportSize({ width: 393, height: 500 });
      await expect(page.getByTestId('lobby-stage-scroll')).toHaveCount(0);
      await expect.poll(() => shell.boundingBox()).toEqual(initialShell);
      await expect.poll(() => email.boundingBox()).toEqual(initialEmail);
      if (installed && userAgent === 'iPhone') {
        await page.screenshot({ path: testInfo.outputPath('keyboard-overlay.png') });
      }
      await expect(email).toBeFocused();
      await page.keyboard.type('example.com');
      await expect(email).toHaveValue('qa@example.com');
      expect(await email.evaluate((node, original) => node === original, originalInput)).toBe(true);

      // A keyboard can also make the CSS viewport landscape while the phone stays upright.
      await page.setViewportSize({ width: 393, height: 350 });
      await expect(page.getByTestId('pwa-landscape-guard')).toHaveCount(0);
      await expect.poll(() => shell.boundingBox()).toEqual(initialShell);
      await expect(email).toBeFocused();
      await page.setViewportSize({ width: 393, height: 852 });
      await expect(email).toBeFocused();
      await expect(email).toHaveValue('qa@example.com');

      await page.getByTestId('toggle-password-login').click();
      const password = page.getByTestId('login-password-input');
      const initialPassword = await password.boundingBox();
      await email.click();
      await page.setViewportSize({ width: 393, height: 500 });
      await email.press('Tab');
      await expect(password).toBeFocused();
      await expect.poll(() => shell.boundingBox()).toEqual(initialShell);
      await expect.poll(() => password.boundingBox()).toEqual(initialPassword);
      await page.keyboard.type('test-only-password');
      await expect(password).toHaveValue('test-only-password');

      // Once editing ends, genuine viewport changes must still be respected.
      await page.setViewportSize({ width: 393, height: 852 });
      await password.evaluate((node: HTMLInputElement) => node.blur());
      if (installed) {
        await page.setViewportSize({ width: 393, height: 797 });
        await expect.poll(async () => (await shell.boundingBox())?.height).toBeCloseTo(797, 0);
      }

      // Actual device rotation is blocked in both browser tabs and PWAs. This
      // is distinct from a portrait phone whose keyboard reduces its viewport.
      await page.evaluate(() => {
        Object.defineProperty(screen.orientation, 'type', { configurable: true, value: 'landscape-primary' });
        screen.orientation.dispatchEvent(new Event('change'));
      });
      await page.setViewportSize({ width: 852, height: 393 });
      await expect(page.getByTestId('pwa-landscape-guard')).toBeVisible();
      await expect(email).toHaveCount(1);
      await expect(email).toBeHidden();
      await page.evaluate(() => {
        Object.defineProperty(screen.orientation, 'type', { configurable: true, value: 'portrait-primary' });
        screen.orientation.dispatchEvent(new Event('change'));
      });
      await page.setViewportSize({ width: 393, height: 852 });
      await expect(page.getByTestId('pwa-landscape-guard')).toHaveCount(0);
      await expect(page.getByTestId('login-email-input')).toBeVisible();
      await expect(email).toHaveValue('qa@example.com');
      await expect(password).toHaveValue('test-only-password');
      expect(await email.evaluate((node, original) => node === original, originalInput)).toBe(true);
    });
  }
}

for (const installed of [false, true]) {
  test(`portrait guard preserves an in-progress local game (${installed ? 'installed PWA' : 'browser'})`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((installed) => {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone' });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: installed });
      Object.defineProperty(screen, 'orientation', {
        configurable: true,
        value: Object.assign(new EventTarget(), { type: 'portrait-primary' }),
      });
      const values = [0.01, 0.2, 0.4, 0.6, 0.8];
      let index = 0;
      Math.random = () => values[index++ % values.length];
    }, installed);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto('/');
    await page.getByTestId('play-computer-button').click();
    const game = page.getByTestId('game-screen');
    const roll = page.getByTestId('roll-button');
    const die = page.getByTestId('die-slot-0');
    await expect(game).toBeVisible();
    await roll.click();
    await expect(die).toBeEnabled();
    await die.click();
    await expect(die).toHaveAttribute('aria-label', /, held$/);
    const heldDieLabel = await die.getAttribute('aria-label');
    const rollText = await roll.textContent();

    for (const orientation of ['landscape-primary', 'landscape-secondary']) {
      await page.evaluate((orientation) => {
        Object.defineProperty(screen.orientation, 'type', { configurable: true, value: orientation });
        screen.orientation.dispatchEvent(new Event('change'));
      }, orientation);
      await page.setViewportSize({ width: 852, height: 393 });
      await expect(page.getByTestId('pwa-landscape-guard')).toBeVisible();
      await expect(game).toHaveCount(1);
      await expect(game).toBeHidden();
      await expect(page.getByRole('button', { name: heldDieLabel!, exact: true })).toHaveCount(0);
      if (orientation === 'landscape-primary') {
        await page.screenshot({ path: testInfo.outputPath('landscape-blocker.png') });
      }
      await page.evaluate(() => {
        Object.defineProperty(screen.orientation, 'type', { configurable: true, value: 'portrait-primary' });
        screen.orientation.dispatchEvent(new Event('change'));
      });
      await page.setViewportSize({ width: 393, height: 852 });
      await expect(page.getByTestId('pwa-landscape-guard')).toHaveCount(0);
      await expect(game).toBeVisible();
      await expect(die).toHaveAttribute('aria-label', heldDieLabel!);
      await expect(roll).toHaveText(rollText!);
    }
    await page.screenshot({ path: testInfo.outputPath('portrait-game-restored.png') });
    await die.click();
    await expect(die).toHaveAttribute('aria-label', /, not held$/);
  });
}

async function expectFieldOverlay(page: Page, testId: string, value: string, screenshotPath?: string) {
  const field = page.getByTestId(testId);
  const shell = page.getByTestId('multiplayer-lobby-shell');
  await field.scrollIntoViewIfNeeded();
  await field.click();
  const originalInput = await field.elementHandle();
  const fieldSize = await field.boundingBox();
  const shellSize = await shell.boundingBox();
  expect(fieldSize).not.toBeNull();
  expect(shellSize).not.toBeNull();
  await page.setViewportSize({ width: 393, height: 500 });
  await expect(field).toBeFocused();
  // A browser may pan a covered field into view, but must not rescale it.
  await expect
    .poll(async () => {
      const box = await field.boundingBox();
      return { width: box?.width, height: box?.height };
    })
    .toEqual({ width: fieldSize!.width, height: fieldSize!.height });
  await expect
    .poll(async () => {
      const box = await shell.boundingBox();
      return { width: box?.width, height: box?.height };
    })
    .toEqual({ width: shellSize!.width, height: shellSize!.height });
  await field.fill(value);
  await expect(field).toHaveValue(value);
  expect(await field.evaluate((node, original) => node === original, originalInput)).toBe(true);
  if (screenshotPath) await page.screenshot({ path: screenshotPath });
  await field.evaluate((node: HTMLInputElement) => node.blur());
  // Blur happens before the software keyboard finishes closing. The app must
  // not flash a smaller layout in that interval.
  const closingSize = await shell.evaluate(async (node) => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  expect(closingSize).toEqual({ width: shellSize!.width, height: shellSize!.height });
  await page.setViewportSize({ width: 393, height: 852 });
  await expect.poll(() => shell.boundingBox()).toMatchObject({ width: shellSize!.width, height: shellSize!.height });
}

async function mockKeyboardTestAccount(page: Page, gameCount = 0) {
  // Test-only responses: no emails, accounts, or profile changes reach Supabase.
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'keyboard@example.com',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const games = Array.from({ length: gameCount }, (_, index) => {
    const state = createGame(['Keyboard Tester', `Opponent ${index + 1}`]);
    state.players[0].id = user.id;
    return {
      id: `00000000-0000-4000-8000-${String(index + 2).padStart(12, '0')}`,
      state,
      status: 'active',
      created_by: user.id,
      current_player_id: user.id,
      created_at: user.created_at,
      updated_at: user.created_at,
      completed_at: null,
      last_turn_id: null,
      last_nudged_at: null,
      winner_id: null,
      sucker_tokens_spent: {},
    };
  });
  const accessToken =
    [
      { alg: 'HS256', typ: 'JWT' },
      { sub: user.id, exp: expiresAt, role: 'authenticated' },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.') + '.test-only-signature';
  await page.route(/\/(?:auth|rest)\/v1\//, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let body: unknown;
    if (pathname === '/auth/v1/otp') body = {};
    else if (pathname === '/auth/v1/verify') {
      body = {
        access_token: accessToken,
        refresh_token: 'test-only-refresh',
        expires_in: 3600,
        expires_at: expiresAt,
        token_type: 'bearer',
        user,
      };
    } else if (pathname === '/auth/v1/user') body = user;
    else if (pathname === '/rest/v1/profiles') {
      body = { id: user.id, display_name: 'Keyboard Tester', username: 'keyboard_tester', avatar_url: null };
    } else if (pathname === '/rest/v1/games') {
      body = new URL(route.request().url()).searchParams.get('status') === 'eq.complete' ? [] : games;
    } else if (pathname === '/rest/v1/head_to_head_stats' || pathname === '/rest/v1/turn_actions') body = [];
    else {
      await route.abort();
      return;
    }
    await route.fulfill({ json: body });
  });
  await page.routeWebSocket(/\/realtime\/v1\//, (socket) => socket.close());
}

for (const hasTouch of [false, true]) {
  test(`desktop PWA follows its window orientation on a landscape monitor (touch: ${hasTouch})`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      isMobile: false,
      hasTouch,
      userAgent: devices['Desktop Chrome'].userAgent,
      viewport: { width: 393, height: 852 },
    });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
        Object.defineProperty(screen, 'orientation', {
          configurable: true,
          value: Object.assign(new EventTarget(), { type: 'landscape-primary' }),
        });
      });
      await page.goto('/');
      await expect(page.getByTestId('login-email-input')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('pwa-landscape-guard')).toHaveCount(0);
      await page.setViewportSize({ width: 852, height: 393 });
      await expect(page.getByTestId('pwa-landscape-guard')).toBeVisible();
      await page.setViewportSize({ width: 393, height: 852 });
      await expect(page.getByTestId('login-email-input')).toBeVisible();
      await expect(page.getByTestId('pwa-landscape-guard')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}
