import { expect, test } from '@playwright/test';

test('production export supports sign-in and local play with the Haptics Lab hidden', async ({ page }) => {
  // The export can contain real public deployment configuration. Do not send
  // test authentication or telemetry to hosted services.
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === 'http://127.0.0.1:8099' ? route.continue() : route.abort(),
  );
  // Successful local acknowledgements also cover configured telemetry on
  // unload without submitting test events to the production collector.
  await page.route(/\/api\/v2\/events(?:\/session\/heartbeat)?(?:\?|$)/, (route) =>
    route.fulfill({ status: 202, body: '' }),
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.text().includes('Unable to load Inter fonts')) errors.push(message.text());
  });
  // Exercise compiled auth UI without contacting a real account or sending mail.
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'production-smoke@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  };
  const token =
    [
      { alg: 'HS256', typ: 'JWT' },
      { sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' },
    ]
      .map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'))
      .join('.') + '.test-only-signature';
  await page.route(/\/auth\/v1\/otp(?:\?|$)/, (route) => route.fulfill({ json: {} }));
  await page.route('**/auth/v1/verify', (route) =>
    route.fulfill({
      json: { access_token: token, refresh_token: 'test-only-refresh', expires_in: 3600, token_type: 'bearer', user },
    }),
  );
  await page.route('**/auth/v1/user', (route) => route.fulfill({ json: user }));
  await page.route('**/rest/v1/**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/profiles')
        ? { id: user.id, display_name: 'Production Tester', username: 'production_tester', avatar_url: null }
        : [],
    }),
  );
  await page.routeWebSocket('**/realtime/v1/**', (socket) => socket.close());
  await page.goto('/');
  await page.getByTestId('login-email-input').fill('production-smoke@example.test');
  await page.getByTestId('send-code-button').click();
  await expect(page.getByTestId('login-code-input')).toBeVisible();
  await page.getByTestId('login-code-input').fill('123456');
  await page.getByTestId('verify-code-button').click();
  await expect(page.getByText('Hi, Production Tester')).toBeVisible();
  await page.goto('/local');
  await expect(page.getByTestId('game-screen')).toBeVisible();
  await page.getByTestId('roll-button').click();
  await expect(page.getByTestId('dice-tray').locator('svg')).toHaveCount(5);
  const savedHaptics = JSON.stringify({
    punchLanded: { preset: 'crack', durationMs: 800, strength: 100, sharpness: 50 },
    punchReceived: { preset: 'off' },
    sucker: { preset: 'doubleRev', durationMs: 850 },
  });
  await page.evaluate((raw) => localStorage.setItem('sucker.haptics.v2', raw), savedHaptics);
  await page.reload();
  await expect(page.getByTestId('game-screen')).toBeVisible();
  await page.getByTestId('game-menu-button').click();
  await expect(page.getByTestId('game-stats-menu-item')).toBeVisible();
  await expect(page.getByTestId('game-rules-menu-item')).toBeVisible();
  await expect(page.getByTestId('game-haptics-menu-item')).toHaveCount(0);
  await expect(page.getByTestId('haptics-lab')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('sucker.haptics.v2'))).toBe(savedHaptics);
  await page.screenshot({ path: test.info().outputPath('production-game-menu.png') });
  expect(await page.evaluate(() => document.fonts.check('16px Inter_900Black'))).toBe(true);
  expect(errors).toEqual([]);
});
