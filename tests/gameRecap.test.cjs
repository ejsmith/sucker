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
  // These turns predate per-turn spend, so there is no splurge to tell.
  assert.deepEqual(alice.tokens, {
    biggestSplurge: null,
    bought: null,
    extraRolls: 1,
    left: 4,
    mulligans: 3,
    punches: 5,
    spent: 9,
  });
  assert.deepEqual(bob.tokens, {
    biggestSplurge: null,
    bought: null,
    extraRolls: 0,
    left: 9,
    mulligans: 0,
    punches: 3,
    spent: 3,
  });
});

test("the recap finds each player's biggest splurge and what their paid turns scored", () => {
  const spent = (id, turnIndex, playerId, category, score, spend, extra = {}) => ({
    ...turn(id, turnIndex, playerId, category, score, extra.status),
    dice: extra.dice ?? [1, 2, 3, 4, 6],
    extra_rolls: spend[0],
    mulligans: spend[1],
    roll_count: extra.rollCount ?? 4,
  });
  const recap = buildGameRecap({
    actions: [],
    players,
    turns: [
      spent('t1', 1, 'alice', 'chance', 22, [2, 0]),
      // Mulliganed, then replayed with its spend carried forward.
      spent('t2', 2, 'bob', 'sucker', 0, [3, 0], { status: 'mulliganed' }),
      spent('t3', 3, 'bob', 'sucker', 50, [3, 1], { dice: [4, 4, 4, 4, 4] }),
      spent('t4', 4, 'alice', 'fullHouse', 25, [0, 1], { status: 'punched' }),
      spent('t5', 5, 'alice', 'ones', 3, [0, 0]),
      // A Sucker Deal after a Mulligan never rolled.
      spent('t6', 6, 'bob', 'fours', 0, [0, 1], { rollCount: 0 }),
    ],
  });
  const [alice, bob] = recap.players;

  // The punched Full House cost the most, and says it was punched.
  assert.deepEqual(alice.tokens.biggestSplurge, {
    category: 'fullHouse',
    dealt: false,
    dice: [1, 2, 3, 4, 6],
    punched: true,
    score: 25,
    spend: { extraRolls: 0, mulligans: 1 },
  });
  // It bought nothing.
  assert.deepEqual(alice.tokens.bought, { points: 22, tokens: 5 });
  assert.deepEqual(bob.tokens.biggestSplurge, {
    category: 'sucker',
    dealt: false,
    dice: [4, 4, 4, 4, 4],
    punched: false,
    score: 50,
    spend: { extraRolls: 3, mulligans: 1 },
  });
  assert.deepEqual(bob.tokens.bought, { points: 50, tokens: 9 });
});

test('a splurge tie goes to the turn whose score stood', () => {
  const spent = (id, turnIndex, category, score, status, rollCount = 4) => ({
    ...turn(id, turnIndex, 'alice', category, score, status),
    dice: [1, 2, 3, 4, 6],
    extra_rolls: 3,
    mulligans: 0,
    roll_count: rollCount,
  });
  const [alice] = buildGameRecap({
    actions: [],
    players,
    turns: [
      spent('t1', 1, 'fullHouse', 25, 'punched'),
      spent('t2', 2, 'chance', 9, 'submitted'),
      spent('t3', 3, 'ones', 0, 'submitted', 0),
    ],
  }).players;

  assert.equal(alice.tokens.biggestSplurge.category, 'chance');
  assert.equal(alice.tokens.biggestSplurge.punched, false);
});

test('a Sucker rolled again with every die held counts once', () => {
  const roll = (actor, dice) => ({ action_type: 'roll', actor_id: actor, payload: { dice } });
  const [alice] = buildGameRecap({
    actions: [
      roll('alice', [3, 3, 3, 3, 3]),
      roll('alice', [3, 3, 3, 3, 3]),
      { action_type: 'extra_roll', actor_id: 'alice', payload: {} },
      roll('alice', [3, 3, 3, 3, 3]),
      { action_type: 'score_category', actor_id: 'alice', payload: { category: 'sucker' } },
      roll('alice', [3, 3, 3, 3, 3]),
      roll('alice', [3, 3, 3, 3, 2]),
      roll('alice', [3, 3, 3, 3, 3]),
    ],
    players,
    turns: [],
  }).players;

  assert.equal(alice.moments.suckersRolled, 3);
});

test('lead changes and the biggest lead are measured at the end of each round', () => {
  const recap = buildGameRecap({
    actions: [],
    players,
    turns: [
      // Mid-round, Alice's opening Sucker is not a 50-point lead.
      turn('t1', 1, 'alice', 'sucker', 50),
      turn('t2', 2, 'bob', 'chance', 20),
      turn('t3', 3, 'alice', 'ones', 3),
      // A tie at the end of a round doesn't change who led last.
      turn('t4', 4, 'bob', 'fullHouse', 33),
      turn('t5', 5, 'alice', 'twos', 4),
      turn('t6', 6, 'bob', 'threes', 9),
      turn('t7', 7, 'alice', 'threes', 3),
      // A punched turn never counts; its replay does.
      turn('t8', 8, 'bob', 'fours', 40, 'punched'),
      turn('t9', 9, 'bob', 'fours', 8),
    ],
  });

  // Alice by 30, a tie at 53, Bob by 5, Bob by 10.
  assert.equal(recap.leadChanges, 1);
  assert.deepEqual(recap.biggestLead, { playerId: 'alice', points: 30 });
});

test('a game with no turns has no swings', () => {
  const recap = buildGameRecap({ actions: [], players, turns: [] });
  assert.equal(recap.leadChanges, 0);
  assert.equal(recap.biggestLead, null);
});
