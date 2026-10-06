import { expect, test, type Page } from '@playwright/test';

const playerId = '00000000-0000-4000-8000-000000000041';
const backend = 'https://apple-auth.example.test';

async function mockAuth(page: Page, needsSetup = false) {
  const user = {
    id: playerId,
    email: 'player@privaterelay.appleid.com',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: { provider: 'apple', providers: ['apple'] },
    user_metadata: {},
    identities: [{ id: 'apple-identity', provider: 'apple', user_id: playerId }],
    created_at: '2026-01-01T00:00:00Z',
  };
  const accessToken =
    [
      { alg: 'HS256', typ: 'JWT' },
      { sub: playerId, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.') + '.test-only-signature';
  const session = {
    access_token: accessToken,
    refresh_token: 'test-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    user,
  };
  let profile = {
    id: playerId,
    display_name: needsSetup ? 'Player' : 'Apple Player',
    username: null as string | null,
    avatar_url: null,
    needs_profile_setup: needsSetup,
  };
  await page.addInitScript(
    ({ backend }) => {
      (window as typeof window & { __SUCKER_E2E_MULTIPLAYER_CONFIG__?: unknown }).__SUCKER_E2E_MULTIPLAYER_CONFIG__ = {
        supabaseUrl: backend,
        supabaseAnonKey: 'test-only-key',
      };
    },
    { backend },
  );
  await page.route(/\/(?:auth|rest)\/v1\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/auth/v1/otp') return route.fulfill({ json: {} });
    if (url.pathname === '/auth/v1/verify') {
      expect(route.request().postDataJSON()).toMatchObject({ type: 'email', token: '123456' });
      return route.fulfill({ json: session });
    }
    if (url.pathname === '/auth/v1/token') {
      expect(url.searchParams.get('grant_type')).toBe('password');
      return route.fulfill({ json: session });
    }
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user });
    if (url.pathname === '/rest/v1/profiles') {
      if (route.request().method() === 'PATCH') {
        const updates = route.request().postDataJSON();
        if (updates.username === 'taken_name') {
          return route.fulfill({ status: 409, json: { code: '23505', message: 'Username already exists' } });
        }
        profile = { ...profile, ...updates };
      }
      return route.fulfill({ json: profile });
    }
    return route.fulfill({ json: [] });
  });
  await page.routeWebSocket(/\/realtime\/v1\//, () => {});
}

for (const profileAvailable of [true, false]) {
  test(`offline computer play remains available with ${profileAvailable ? 'unfinished' : 'unavailable'} Apple profile setup`, async ({
    page,
    context,
  }, testInfo) => {
    await mockAuth(page, true);
    if (!profileAvailable) {
      await page.route('**/rest/v1/profiles?**', (route) => route.abort('internetdisconnected'));
    }
    await page.goto('/');
    await page.getByTestId('toggle-password-login').click();
    await page.getByTestId('login-email-input').fill('player@privaterelay.appleid.com');
    await page.getByTestId('login-password-input').fill('test-password');
    await page.getByTestId('password-sign-in-button').click();
    await expect(page.getByTestId(profileAvailable ? 'profile-setup-page' : 'apple-profile-loading')).toBeVisible();
    await page.route(`${backend}/**`, (route) => route.abort('internetdisconnected'));
    await context.setOffline(true);
    await page.screenshot({ path: testInfo.outputPath('offline-computer-entry.png') });
    await page.getByTestId('play-computer-button').click();
    await expect(page.getByTestId('roll-button')).toBeEnabled();
    await expect(page.getByTestId('computer-save-dialog')).toHaveCount(0);
  });
}

test('unfinished Apple signup resumes setup and remembers a chosen name without a username', async ({ page }) => {
  await mockAuth(page, true);
  await page.goto('/');
  await page.getByTestId('toggle-password-login').click();
  await page.getByTestId('login-email-input').fill('player@privaterelay.appleid.com');
  await page.getByTestId('login-password-input').fill('test-password');
  await page.getByTestId('password-sign-in-button').click();
  await expect(page.getByTestId('profile-setup-page')).toBeVisible();
  await expect(page.getByTestId('display-name-input')).toHaveValue('');
  await expect(page.getByTestId('username-input')).toHaveValue('');
  await expect(page.getByTestId('complete-profile-setup-button')).toBeDisabled();
  await expect(page.getByTestId('start-with-friend-button')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('profile-setup-page')).toBeVisible();
  await page.getByTestId('display-name-input').fill('   ');
  await expect(page.getByTestId('complete-profile-setup-button')).toBeDisabled();
  await page.getByTestId('display-name-input').fill('Lucky Roller');
  await page.getByTestId('complete-profile-setup-button').click();
  await expect(page.getByText('Hi, Lucky Roller')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Hi, Lucky Roller')).toBeVisible();
  await expect(page.getByTestId('profile-setup-page')).toHaveCount(0);
});

test('Apple setup keeps the chosen name after a username conflict and can retry', async ({ page }) => {
  await mockAuth(page, true);
  await page.goto('/');
  await page.getByTestId('login-email-input').fill('player@privaterelay.appleid.com');
  await page.getByTestId('send-code-button').click();
  await page.getByTestId('login-code-input').fill('123456');
  await page.getByTestId('verify-code-button').click();
  await page.getByTestId('display-name-input').fill('Alex');
  await page.getByTestId('username-input').fill('taken_name');
  await page.getByTestId('complete-profile-setup-button').click();
  await expect(page.getByText('That username is taken. Try another, or leave it blank.')).toBeVisible();
  await expect(page.getByTestId('display-name-input')).toHaveValue('Alex');
  await expect(page.getByTestId('username-input')).toHaveValue('taken_name');
  await page.getByTestId('username-input').fill('alex_rolls');
  await page.getByTestId('complete-profile-setup-button').click();
  await expect(page.getByText('Hi, Alex')).toBeVisible();
  await page.getByTestId('profile-button').click();
  await expect(page.getByTestId('username-input')).toHaveValue('alex_rolls');
});

test('web offers email sign-in without Apple controls or copy and restores the session', async ({ page }) => {
  await mockAuth(page);
  await page.goto('/');
  await expect(page.getByTestId('login-email-input')).toBeVisible();
  await expect(page.getByTestId('apple-sign-in-button')).toHaveCount(0);
  await expect(page.getByText(/connect Apple|or use email/i)).toHaveCount(0);
  await expect(page.getByTestId('play-computer-button')).toBeInViewport();
  const screenshot = test.info().outputPath('email-login.png');
  await page.screenshot({ path: screenshot });
  await test.info().attach('email-login', { path: screenshot, contentType: 'image/png' });
  await page.getByTestId('login-email-input').fill('player@privaterelay.appleid.com');
  await page.getByTestId('send-code-button').click();
  await page.getByTestId('login-code-input').fill('123456');
  await page.getByTestId('verify-code-button').click();
  await expect(page.getByText('Hi, Apple Player')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Hi, Apple Player')).toBeVisible();
});

test('web password sign-in works and hides Apple account controls even for a linked player', async ({ page }) => {
  await mockAuth(page);
  await page.goto('/');
  await page.getByTestId('toggle-password-login').click();
  await page.getByTestId('login-email-input').fill('existing@example.test');
  await page.getByTestId('login-password-input').fill('test-password');
  await page.getByTestId('password-sign-in-button').click();
  await expect(page.getByText('Hi, Apple Player')).toBeVisible();
  await page.getByTestId('profile-button').click();
  await expect(page.getByTestId('open-password-page-button')).toBeVisible();
  await expect(page.getByTestId('account-password-section')).toHaveCount(0);
  await expect(page.getByTestId('account-apple-section')).toHaveCount(0);
  await expect(page.getByTestId('connect-apple-button')).toHaveCount(0);
  await expect(page.getByText(/Apple connected|Connect Apple|Continue with Apple/)).toHaveCount(0);
  await page.goto('/?error=access_denied');
  await expect(page.getByText('Hi, Apple Player')).toBeVisible();
});

test('canceled and failed auth callbacks leave email sign-in usable', async ({ page }) => {
  await mockAuth(page);
  await page.goto('/?error=access_denied');
  await expect(page.getByTestId('login-email-input')).toBeVisible();
  await expect(page.getByText('access_denied', { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL((url) => url.search === '');
  await page.goto(
    '/?error=access_denied&error_code=identity_already_exists&error_description=Apple+is+already+connected',
  );
  await expect(page.getByText('Apple is already connected', { exact: true })).toBeVisible();
  await page.getByTestId('login-email-input').fill('existing@example.test');
  await expect(page.getByTestId('send-code-button')).toBeEnabled();
});
