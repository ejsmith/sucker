import { expect, test, type Page } from '@playwright/test';

const actorId = '00000000-0000-4000-8000-000000000001';

async function openLobby(page: Page) {
  const user = {
    id: actorId,
    email: 'network@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  };
  const accessToken =
    [
      { alg: 'HS256', typ: 'JWT' },
      { sub: actorId, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.') + '.test-only-signature';
  await page.addInitScript(
    ({ accessToken }) => {
      (window as typeof window & { __SUCKER_E2E_MULTIPLAYER_CONFIG__?: unknown }).__SUCKER_E2E_MULTIPLAYER_CONFIG__ = {
        accessToken,
        refreshToken: 'test-only-refresh',
      };
    },
    { accessToken },
  );
  await page.route(/\/(?:auth|rest)\/v1\//, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
    if (url.pathname === '/rest/v1/profiles') {
      return route.fulfill({
        json: { id: actorId, display_name: 'Network Tester', username: 'network_tester', avatar_url: null },
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.routeWebSocket(/\/realtime\/v1\//, (socket) => socket.close());
  await page.goto('/');
  await expect(page.getByText('Hi, Network Tester')).toBeVisible();
}

test('idle offline signals stay quiet; only a slow player request shows feedback', async ({ page }, testInfo) => {
  let release!: () => void;
  let requested!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route(/\/functions\/v1\/game-action/, async (route) => {
    requested();
    await response;
    await route.fulfill({ json: { inviteCode: 'ABC12345' } });
  });
  await openLobby(page);
  const banner = page.getByTestId('network-status-banner');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  // A passive offline signal must not become a banner even after the delay.
  await page.waitForTimeout(3200);
  await expect(banner).toHaveCount(0);
  await expect(page.getByText(/Offline —/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('idle-offline.png') });

  await page.getByTestId('start-with-friend-button').click();
  await page.getByTestId('create-invite-button').click();
  // The server is tried even when NetInfo's browser signal says offline.
  await request;
  await page.waitForTimeout(500);
  await expect(banner).toHaveCount(0);
  await expect(banner).toHaveText('Server is taking longer than usual…', { timeout: 5000 });
  await page.screenshot({ path: testInfo.outputPath('slow-request.png') });
  release();
  await expect(page.getByTestId('generated-invite-code')).toHaveText('ABC12345');
  await expect(banner).toHaveCount(0);
});

test('background recovery stays quiet while its server response is delayed', async ({ page }) => {
  let release!: () => void;
  let requested!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route(/\/functions\/v1\/game-action/, async (route) => {
    requested();
    await response;
    await route.fulfill({ json: { inviteCode: 'ABC12345' } });
  });
  await openLobby(page);
  await page.evaluate(
    ({ actorId }) => {
      localStorage.setItem(
        'sucker:pending-multiplayer-actions:v2',
        JSON.stringify([
          {
            type: 'create_invite',
            actorId,
            actionKey: JSON.stringify(['create_invite']),
            requestId: '00000000-0000-4000-8000-000000000002',
            createdAt: new Date().toISOString(),
          },
        ]),
      );
      document.dispatchEvent(new Event('visibilitychange'));
    },
    { actorId },
  );
  await request;
  await page.waitForTimeout(3200);
  await expect(page.getByTestId('network-status-banner')).toHaveCount(0);
  await expect(page.getByText('Synchronizing game actions…')).toHaveCount(0);
  release();
  await expect(page.getByTestId('generated-invite-code')).toHaveText('ABC12345');
});
