const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createGame,
  getSuckerPunchCost,
  getSuckerPunchKind,
  mulliganCurrentTurn,
  purchaseExtraRoll,
  rollCurrentDice,
  scratchScoreBox,
  toGameState,
} = require('../.build/src/game');
const { applyLocalSuckerPunch, scoreLocalTurn, shouldComputerUseSuckerPunch } = require('../.build/src/game/computer');
const { parseComputerSession } = require('../.build/src/game/computerSession');
const { buildSuckerPunchActionPayload, calculateSuckerActionStats } = require('../.build/shared/stats');

function submit(game, category = 'ones') {
  return scoreLocalTurn(
    rollCurrentDice(game, () => 0),
    category,
  );
}

function reload(state) {
  return parseComputerSession(JSON.stringify({ version: 1, ...state, actions: [], turns: [], recordedGameIds: [] }));
}

function takeHits(count) {
  let state = submit(createGame(['Player', 'Computer']));
  for (let hit = 1; hit <= count; hit++) {
    const punched = applyLocalSuckerPunch(state.game, state.pendingTurn, 1, () => 0, 6);
    assert.equal(punched.outcome.landed, true);
    assert.equal(punched.game.players[0].scorecard.ones, null);
    assert.equal(punched.game.players[0].revengePunchDiscount, Math.min(2, hit));
    state = submit(reload(punched).game);
  }
  // The attacker accepts the replay and plays their own turn.
  return reload(submit(state.game, 'chance'));
}

for (const hits of [1, 2, 3]) {
  for (const landed of [true, false]) {
    test(`${hits} received hit(s) persist through replays and reloads, then reset on a revenge ${landed ? 'hit' : 'miss'}`, () => {
      const { game, pendingTurn } = takeHits(hits);
      const cost = hits === 1 ? 2 : 1;
      const actor = game.players[0];
      assert.equal(getSuckerPunchCost(game, actor.id), cost);
      assert.equal(getSuckerPunchKind(game, actor.id), 'revenge');
      game.players[0].suckerTokens = cost;
      const result = applyLocalSuckerPunch(game, pendingTurn, 0, () => (landed ? 0 : 0.99), 6);
      assert.equal(result.outcome.landed, landed);
      assert.equal(result.outcome.isCounterPunch, false);
      assert.equal(result.outcome.isRevengePunch, true);
      assert.equal(result.outcome.tokenCost, cost);
      assert.equal(result.outcome.chancePercent, 75);
      assert.equal(result.game.players[0].suckerTokens, 0);
      assert.equal(result.game.players[0].revengePunchDiscount, undefined);
      assert.equal(result.game.players[0].scorecard.ones, 5);
      assert.equal(result.game.players[1].scorecard.chance, landed ? null : 5);
      assert.equal(result.game.players[1].revengePunchDiscount, landed ? 1 : undefined);
      assert.equal(result.game.counterPunchCost, landed ? undefined : 2);
      assert.equal(getSuckerPunchCost(result.game, actor.id), 3);
      const payload = buildSuckerPunchActionPayload(game.players[1].id, result.outcome);
      assert.equal(payload.isRevengePunch, true);
      assert.equal(
        calculateSuckerActionStats([{ actor_id: actor.id, action_type: 'sucker_punch', payload }], actor.id)
          .sucker_tokens_spent,
        cost,
      );
    });
  }
}

test('banked revenge survives skipped responses, extra rolls, mulligans, scratches, and normal turns', () => {
  for (const play of [
    rollCurrentDice,
    purchaseExtraRoll,
    mulliganCurrentTurn,
    (game) => scratchScoreBox(game, 'twos'),
  ]) {
    const { game } = takeHits(2);
    const next = toGameState(JSON.parse(JSON.stringify(play(game))));
    assert.equal(next.players[0].revengePunchDiscount, 2);
    assert.equal(getSuckerPunchCost(next, next.players[0].id), 1);
  }
  const first = takeHits(2);
  const second = submit(first.game, 'twos');
  const third = submit(second.game, 'threes');
  assert.equal(getSuckerPunchCost(third.game, third.game.players[0].id), 1);
  assert.equal(third.game.players[0].revengePunchDiscount, 2);
});

test('a rejected revenge attempt preserves the discount and tokens', () => {
  const { game, pendingTurn } = takeHits(1);
  for (const [state, actor] of [
    [{ ...game, players: game.players.map((player, i) => (i === 0 ? { ...player, suckerTokens: 1 } : player)) }, 0],
    [rollCurrentDice(game), 0],
    [game, 1],
  ]) {
    const result = applyLocalSuckerPunch(state, pendingTurn, actor);
    assert.equal(result.outcome, null);
    assert.equal(result.game, state);
    assert.equal(result.game.players[0].revengePunchDiscount, 1);
  }
});

test('revenge and counterpunch use the cheaper price, consume both, and keep the miss chain independent', () => {
  for (const revenge of [1, 2]) {
    for (const counter of [1, 2]) {
      for (const landed of [true, false]) {
        const { game, pendingTurn } = takeHits(revenge);
        game.counterPunchPlayerId = game.players[0].id;
        game.counterPunchCost = counter;
        const cost = Math.min(3 - revenge, counter);
        assert.equal(getSuckerPunchCost(game, game.players[0].id), cost);
        assert.equal(getSuckerPunchKind(game, game.players[0].id), 3 - revenge < counter ? 'revenge' : 'counter');
        const result = applyLocalSuckerPunch(game, pendingTurn, 0, () => (landed ? 0 : 0.99), 6);
        assert.equal(result.outcome.tokenCost, cost);
        assert.equal(result.game.players[0].revengePunchDiscount, undefined);
        assert.notEqual(result.game.counterPunchPlayerId, game.players[0].id);
        assert.equal(result.game.counterPunchCost, landed ? undefined : 1);
      }
    }
  }
});

test('a missed incoming punch does not add revenge and an expired counterpunch preserves revenge', () => {
  const { game, pendingTurn } = takeHits(1);
  game.players[1].revengePunchDiscount = 1;
  const missed = applyLocalSuckerPunch(game, pendingTurn, 0, () => 0.99, 1);
  assert.equal(missed.game.players[1].revengePunchDiscount, 1);
  const response = submit(missed.game, 'twos');
  const expired = rollCurrentDice(response.game);
  assert.equal(expired.counterPunchPlayerId, undefined);
  assert.equal(getSuckerPunchCost(expired, expired.players[1].id), 2);
});

test('computer can punch with exactly one token using banked revenge', () => {
  const state = submit(createGame(['Player', 'Computer']), 'sucker');
  state.game.players[1].revengePunchDiscount = 2;
  state.game.players[1].suckerTokens = 1;
  assert.equal(shouldComputerUseSuckerPunch(state.game, state.pendingTurn), true);
  const result = applyLocalSuckerPunch(state.game, state.pendingTurn, 1, () => 0, 6);
  assert.equal(result.outcome.tokenCost, 1);
  assert.equal(result.game.players[1].suckerTokens, 0);
  assert.equal(result.game.players[1].revengePunchDiscount, undefined);
});

test('completion expires both players revenge and counterpunch opportunities', () => {
  const game = createGame(['Player', 'Computer']);
  for (const player of game.players) {
    player.revengePunchDiscount = 2;
    for (const category of Object.keys(player.scorecard)) player.scorecard[category] = 0;
  }
  game.players[0].scorecard.ones = null;
  game.counterPunchPlayerId = game.players[1].id;
  game.counterPunchCost = 1;
  const result = submit(game);
  assert.equal(result.game.phase, 'complete');
  assert.equal(result.pendingTurn, null);
  assert.equal(result.game.counterPunchPlayerId, undefined);
  for (const player of result.game.players) {
    assert.equal(player.revengePunchDiscount, undefined);
    assert.equal(getSuckerPunchCost(result.game, player.id), 3);
  }
});

test('legacy saves have no revenge discount and malformed discounts are rejected', () => {
  const game = createGame(['Player', 'Computer']);
  assert.deepEqual(toGameState(JSON.parse(JSON.stringify(game))), game);
  for (const discount of [null, 0, 3, -1, 1.5, '1', true]) {
    assert.throws(
      () =>
        toGameState({ ...game, players: [{ ...game.players[0], revengePunchDiscount: discount }, game.players[1]] }),
      /revenge punch discount/,
    );
  }
});
