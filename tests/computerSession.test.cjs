const assert = require('node:assert/strict');
const test = require('node:test');
const { createGame, rollCurrentDice, toggleHold, purchaseExtraRoll } = require('../.build/src/game/rules');
const { computerSessionKey, parseComputerSession } = require('../.build/src/game/computerSession');

function snapshot() {
  let game = rollCurrentDice(createGame(['Player', 'Computer']), () => 0.5);
  game = purchaseExtraRoll(toggleHold(game, 2));
  return {
    version: 1,
    game,
    pendingTurn: null,
    actions: [{ action_type: 'extra_roll', actor_id: game.players[0].id }],
    turns: [],
    recordedGameIds: [],
  };
}

test('computer saves preserve dice, holds, purchased rolls, tokens, and history', () => {
  const original = snapshot();
  assert.deepEqual(parseComputerSession(JSON.stringify(original)), original);
});

test('computer saves preserve the pending punch opportunity', () => {
  const original = snapshot();
  original.pendingTurn = {
    id: 'turn-1',
    category: 'chance',
    dice: [1, 2, 3, 4, 5],
    score: 15,
    hadSuckerBonus: false,
    scorerIndex: 1,
    responderIndex: 0,
    status: 'submitted',
  };
  assert.deepEqual(parseComputerSession(JSON.stringify(original)), original);
});

test('computer save keys separate guest play and each account', () => {
  assert.equal(new Set([computerSessionKey(null), computerSessionKey('alice'), computerSessionKey('bob')]).size, 3);
});

test('corrupt and incompatible computer saves fail before gameplay starts', () => {
  for (const value of [
    '{',
    JSON.stringify({ ...snapshot(), version: 2 }),
    JSON.stringify({ ...snapshot(), game: { ...snapshot().game, dice: [9, 9, 9, 9, 9] } }),
    JSON.stringify({ ...snapshot(), pendingTurn: { scorerIndex: 8 } }),
    JSON.stringify({ ...snapshot(), actions: [{}] }),
  ]) {
    assert.throws(() => parseComputerSession(value));
  }
});
