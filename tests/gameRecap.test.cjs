const assert = require('node:assert/strict');
const test = require('node:test');
const { createGame } = require('../.build/shared/game');
const { buildGameRecap } = require('../.build/shared/gameRecap');

const game = createGame(['Alice', 'Bob']);
const players = game.players.map((player, index) => ({
  ...player,
  id: index === 0 ? 'alice' : 'bob',
  suckerTokens: index === 0 ? 4 : 9,
}));

function turn(id, turnIndex, playerId, category, score, status = 'submitted') {
  return { category, id, player_id: playerId, score, status, turn_index: turnIndex };
}

test('the recap tallies punches, moments, and the token ledger for each player', () => {
  const recap = buildGameRecap({
    players,
    turns: [
      turn('t1', 1, 'alice', 'chance', 20),
      turn('t2', 2, 'bob', 'sucker', 50, 'punched'),
      turn('t3', 3, 'bob', 'ones', 0),
      turn('t4', 4, 'alice', 'sucker', 50),
    ],
    actions: [
      { action_type: 'roll', actor_id: 'alice', payload: { dice: [2, 2, 2, 2, 2] } },
      { action_type: 'extra_roll', actor_id: 'alice', payload: { suckerHunt: false } },
      { action_type: 'mulligan', actor_id: 'alice', payload: {} },
      { action_type: 'roll', actor_id: 'bob', payload: { dice: [6, 6, 6, 6, 6] } },
      {
        action_type: 'sucker_punch',
        actor_id: 'alice',
        payload: { landed: true, targetPlayerId: 'bob', targetTurnId: 't2', tokenCost: 3 },
      },
      {
        action_type: 'sucker_punch',
        actor_id: 'bob',
        payload: { landed: false, targetPlayerId: 'alice', targetTurnId: 't4', tokenCost: 3 },
      },
      {
        action_type: 'sucker_punch',
        actor_id: 'alice',
        payload: { isCounterPunch: true, landed: true, targetPlayerId: 'bob', targetTurnId: 't3', tokenCost: 2 },
      },
      { action_type: 'scratch_category', actor_id: 'bob', payload: { category: 'ones' } },
    ],
  });
  const [alice, bob] = recap.players;

  assert.deepEqual(alice.punches, {
    biggestHit: { category: 'sucker', score: 50 },
    counterpunchesLanded: 1,
    landed: 2,
    thrown: 2,
  });
  assert.deepEqual(bob.punches, { biggestHit: null, counterpunchesLanded: 0, landed: 0, thrown: 1 });
  // A punched turn never counts as anyone's best turn.
  assert.deepEqual(bob.moments, { bestTurn: null, suckerDeals: 1, suckersRolled: 1 });
  assert.deepEqual(alice.moments, { bestTurn: { category: 'sucker', score: 50 }, suckerDeals: 0, suckersRolled: 1 });
  assert.deepEqual(alice.tokens, { earned: 0, extraRolls: 1, left: 4, mulligans: 3, punches: 5, spent: 9 });
  assert.deepEqual(bob.tokens, { earned: 1, extraRolls: 0, left: 9, mulligans: 0, punches: 3, spent: 3 });
});

test('lead changes skip ties and track the biggest lead either way', () => {
  const recap = buildGameRecap({
    actions: [],
    players,
    turns: [
      turn('t1', 1, 'alice', 'chance', 20),
      turn('t2', 2, 'bob', 'chance', 20),
      turn('t3', 3, 'alice', 'ones', 3),
      turn('t4', 4, 'bob', 'sucker', 50),
      turn('t5', 5, 'alice', 'fullHouse', 25),
    ],
  });

  assert.equal(recap.leadChanges, 1);
  assert.deepEqual(recap.biggestLead, { playerId: 'bob', points: 47 });
});

test('a game with no turns has no swings', () => {
  const recap = buildGameRecap({ actions: [], players, turns: [] });
  assert.equal(recap.leadChanges, 0);
  assert.equal(recap.biggestLead, null);
});
