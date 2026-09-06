import { expect, test } from '@playwright/test';

for (const installed of [false, true]) {
  test(`login retains keyboard focus through viewport resizing (${installed ? 'installed PWA' : 'browser'})`, async ({
    page,
  }) => {
    await page.addInitScript((isInstalled) => {
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 1 });
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: isInstalled });
      Object.defineProperty(screen, 'orientation', {
        configurable: true,
        value: Object.assign(new EventTarget(), { type: 'portrait-primary' }),
      });
    }, installed);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto('/');

    const email = page.getByTestId('login-email-input');
    await email.click();
    await expect(email).toBeFocused();
    // Changing the layout must preserve the actual input node as well as its value.
    const originalInput = await email.elementHandle();
    await page.keyboard.type('qa@');
    await page.setViewportSize({ width: 393, height: 500 });
    if (installed) {
      await expect(page.getByTestId('lobby-stage-scroll')).toBeVisible();
    }
    await expect(email).toBeFocused();
    await page.keyboard.type('example.com');
    await expect(email).toHaveValue('qa@example.com');
    expect(await email.evaluate((node, original) => node === original, originalInput)).toBe(true);

    // A keyboard can also make the CSS viewport landscape while the phone stays upright.
    await page.setViewportSize({ width: 393, height: 350 });
    await expect(page.getByTestId('pwa-landscape-guard')).toHaveCount(0);
    await expect(email).toBeFocused();
    await page.setViewportSize({ width: 393, height: 852 });
    await expect(email).toBeFocused();
    await expect(email).toHaveValue('qa@example.com');

    await page.getByTestId('toggle-password-login').click();
    const password = page.getByTestId('login-password-input');
    await password.click();
    await page.setViewportSize({ width: 393, height: 500 });
    await expect(password).toBeFocused();
    await page.keyboard.type('test-only-password');
    await expect(password).toHaveValue('test-only-password');

    if (installed) {
      await page.evaluate(() => {
        Object.defineProperty(screen.orientation, 'type', { configurable: true, value: 'landscape-primary' });
        screen.orientation.dispatchEvent(new Event('change'));
      });
      await expect(page.getByTestId('pwa-landscape-guard')).toBeVisible();
    }
  });
}

test('desktop PWA follows its window orientation on a landscape monitor', async ({ browser }) => {
  const context = await browser.newContext({ isMobile: false, hasTouch: false, viewport: { width: 393, height: 852 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });
      Object.defineProperty(screen, 'orientation', {
        configurable: true,
        value: Object.assign(new EventTarget(), { type: 'landscape-primary' }),
      });
    });
    await page.goto('/');
    await expect(page.getByTestId('login-email-input')).toBeVisible();
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
