const assert = require('node:assert/strict');
const test = require('node:test');

const { createGame } = require('../.build/src/game');
const { preserveLocalHeldDice } = require('../.build/src/multiplayer/heldDice');

function rolledGame(overrides = {}) {
  return {
    ...createGame(['Alice', 'Bob']),
    dice: [2, 3, 4, 5, 6],
    phase: 'scoring',
    rollNumber: 2,
    ...overrides,
  };
}

test('remote refreshes preserve the active player held-dice draft for the same roll', () => {
  const remote = rolledGame();
  const visible = {
    ...remote,
    held: [true, false, true, false, false],
  };

  const next = preserveLocalHeldDice(remote, visible, 'player-1');

  assert.deepEqual(next.held, visible.held);
  assert.notEqual(next.held, visible.held);
});

test('an advanced remote roll replaces the previous held-dice draft', () => {
  const visible = rolledGame({ held: [true, false, true, false, false] });
  const remote = rolledGame({
    dice: [2, 1, 4, 1, 6],
    held: [true, false, true, false, false],
    rollNumber: 3,
  });

  assert.equal(preserveLocalHeldDice(remote, visible, 'player-1'), remote);
});

test('remote refreshes never preserve an opponent held-dice draft', () => {
  const remote = rolledGame({ currentPlayerIndex: 1 });
  const visible = {
    ...remote,
    held: [true, false, true, false, false],
  };

  assert.equal(preserveLocalHeldDice(remote, visible, 'player-1'), remote);
});
