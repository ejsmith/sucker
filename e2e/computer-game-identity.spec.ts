import { expect, test } from '@playwright/test';

test('separate local games started in the same millisecond have stable distinct identities', async ({
  browser,
  baseURL,
}) => {
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  const ids: string[] = [];
  try {
    for (const context of contexts) {
      const page = await context.newPage();
      await page.addInitScript(() => {
        Date.now = () => 1788674400000;
      });
      await page.goto('/local');
      await expect(page.getByTestId('roll-button')).toBeEnabled();
      const savedId = () =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('sucker.computer-session.v1.guest') ?? 'null')?.game.id as
              | string
              | undefined,
        );
      await expect.poll(savedId).toBeTruthy();
      const id = (await savedId())!;
      ids.push(id);
      await page.reload();
      await expect(page.getByTestId('roll-button')).toBeEnabled();
      await expect.poll(savedId).toBe(id);
    }
    console.log(
      JSON.stringify(
        {
          fixedClock: 1788674400000,
          firstGame: ids[0],
          secondGame: ids[1],
          distinct: ids[0] !== ids[1],
          stableThroughReload: true,
        },
        null,
        2,
      ),
    );
    expect(ids[0]).not.toBe(ids[1]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
