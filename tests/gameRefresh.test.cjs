const assert = require('node:assert/strict');
const test = require('node:test');
const { createGameRefresh } = require('../.build/src/multiplayer/gameRefresh');

test('reconnect and preparation-only recovery fetch the current game', async () => {
  let current = { version: 7 };
  const refresh = createGameRefresh(
    async () => ({ version: 8 }),
    (game) => {
      current = game;
    },
  );
  await refresh.refresh();
  assert.equal(current.version, 8);
});

test('a realtime event prevents a slower refresh from replacing newer state', async () => {
  let resolve;
  let current = { version: 7 };
  const refresh = createGameRefresh(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    (game) => {
      current = game;
    },
  );
  const pending = refresh.refresh();
  refresh.invalidate();
  current = { version: 9 };
  resolve({ version: 8 });
  await pending;
  assert.equal(current.version, 9);
});

test('a refresh cannot update a game after navigation', async () => {
  let resolve;
  let applied = false;
  const refresh = createGameRefresh(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    () => {
      applied = true;
    },
  );
  const pending = refresh.refresh();
  refresh.dispose();
  resolve({ version: 8 });
  await pending;
  assert.equal(applied, false);
});
