const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createGame,
  getSuckerPunchCost,
  mulliganCurrentTurn,
  purchaseExtraRoll,
  rollCurrentDice,
  scratchScoreBox,
  toGameState,
} = require('../.build/src/game');
const {
  applyLocalSuckerPunch,
  scoreLocalTurn,
  scratchLocalTurn,
  shouldComputerUseSuckerPunch,
} = require('../.build/src/game/computer');
const { parseComputerSession } = require('../.build/src/game/computerSession');
const { buildSuckerPunchActionPayload, calculateSuckerActionStats } = require('../.build/shared/stats');

function submitSucker(game, category = 'sucker') {
  return scoreLocalTurn(
    rollCurrentDice(game, () => 0),
    category,
  );
}

function counterpunchWindow() {
  const scored = submitSucker(createGame(['Player', 'Computer']), 'ones');
  const missed = applyLocalSuckerPunch(scored.game, scored.pendingTurn, 1, () => 0.99, 1);
  assert.equal(missed.outcome.landed, false);
  assert.equal(missed.game.players[0].scorecard.ones, 5);
  assert.equal(missed.game.players[1].suckerTokens, 7);
  // The opportunity must survive both persistence and the attacker's intervening turn.
  return submitSucker(toGameState(JSON.parse(JSON.stringify(missed.game))), 'chance');
}

test('a missed regular punch grants a persisted 2-token counterpunch on any category', () => {
  const { game, pendingTurn } = counterpunchWindow();
  assert.equal(game.counterPunchPlayerId, game.players[0].id);
  game.players[0].suckerTokens = 2;
  const result = applyLocalSuckerPunch(game, pendingTurn, 0, () => 0, 6);
  assert.equal(result.outcome.isCounterPunch, true);
  assert.equal(result.outcome.chancePercent, 75);
  assert.equal(result.game.players[0].suckerTokens, 0);
  assert.equal(result.game.players[0].scorecard.ones, 5);
  assert.equal(result.game.players[1].scorecard.chance, null);
  assert.equal(result.game.currentPlayerIndex, 1);
  assert.equal(result.game.counterPunchPlayerId, undefined);
});

test('a missed counterpunch gives the opponent a one-token counterpunch', () => {
  const { game, pendingTurn } = counterpunchWindow();
  const result = applyLocalSuckerPunch(game, pendingTurn, 0, () => 0.99, 1);
  assert.equal(result.outcome.landed, false);
  assert.equal(result.outcome.isCounterPunch, true);
  assert.equal(result.game.players[0].suckerTokens, 8);
  assert.equal(result.game.players[1].scorecard.chance, 5);
  assert.equal(result.game.counterPunchPlayerId, game.players[1].id);
  assert.equal(result.game.counterPunchCost, 1);
  assert.equal(result.pendingTurn, null);
});

test('consecutive misses cost 3, 2, 1, 1, 1 across saved turns and count actual spending', () => {
  let state = submitSucker(createGame(['Player', 'Computer']), 'ones');
  const actions = [];
  for (const [index, cost] of [3, 2, 1, 1, 1].entries()) {
    const { game, pendingTurn } = parseComputerSession(
      JSON.stringify({
        version: 1,
        game: state.game,
        pendingTurn: state.pendingTurn,
        actions: [],
        turns: [],
        recordedGameIds: [],
      }),
    );
    const puncherIndex = game.currentPlayerIndex;
    const puncher = game.players[puncherIndex];
    assert.equal(getSuckerPunchCost(game, puncher.id), cost);
    const result = applyLocalSuckerPunch(game, pendingTurn, puncherIndex, () => 0.99, 1);
    assert.equal(result.outcome.landed, false);
    assert.equal(result.outcome.tokenCost, cost);
    assert.equal(result.game.players[puncherIndex].suckerTokens, puncher.suckerTokens - cost);
    assert.equal(result.game.counterPunchCost, Math.max(1, cost - 1));
    actions.push({
      actor_id: 'player',
      action_type: 'sucker_punch',
      payload: buildSuckerPunchActionPayload(game.players[pendingTurn.scorerIndex].id, result.outcome),
    });
    state = submitSucker(result.game, ['chance', 'twos', 'threes', 'fours', 'fives'][index]);
  }
  assert.equal(calculateSuckerActionStats(actions, 'player').sucker_tokens_spent, 8);
  state.game.players[state.game.currentPlayerIndex].suckerTokens = 1;
  const landed = applyLocalSuckerPunch(state.game, state.pendingTurn, state.game.currentPlayerIndex, () => 0, 6);
  assert.equal(landed.outcome.tokenCost, 1);
  assert.equal(landed.game.players[state.game.currentPlayerIndex].suckerTokens, 0);
  assert.equal(landed.game.counterPunchCost, undefined);
});

test('zero scores and scratches both offer a discounted counterpunch', () => {
  for (const submit of [(game) => submitSucker(game, 'twos'), (game) => scratchLocalTurn(game, 'twos')]) {
    const initial = submitSucker(createGame(['Player', 'Computer']), 'ones');
    const missed = applyLocalSuckerPunch(initial.game, initial.pendingTurn, 1, () => 0.99, 1);
    const scored = submit(missed.game);
    assert.equal(scored.pendingTurn.score, 0);
    const result = applyLocalSuckerPunch(scored.game, scored.pendingTurn, 0, () => 0, 6);
    assert.equal(result.outcome.tokenCost, 2);
    assert.equal(result.game.players[1].scorecard.twos, null);
  }
});

test('starting the next turn expires the discount, including a scratch or mulligan before rolling', () => {
  for (const startTurn of [
    rollCurrentDice,
    purchaseExtraRoll,
    mulliganCurrentTurn,
    (game) => scratchScoreBox(game, 'twos'),
  ]) {
    const { game } = counterpunchWindow();
    const next = startTurn(game);
    assert.equal(next.counterPunchPlayerId, undefined);
    assert.equal(toGameState(JSON.parse(JSON.stringify(next))).counterPunchPlayerId, undefined);
    assert.equal(next.counterPunchCost, undefined);
    const scored = submitSucker(next, 'threes');
    const missed = applyLocalSuckerPunch(
      scored.game,
      scored.pendingTurn,
      scored.game.currentPlayerIndex,
      () => 0.99,
      1,
    );
    assert.equal(missed.outcome.tokenCost, 3);
    assert.equal(missed.game.counterPunchCost, 2);
  }
});

test('a counterpunch cannot be thrown after rolling or by the wrong responder', () => {
  const { game, pendingTurn } = counterpunchWindow();
  const rolled = rollCurrentDice(game);
  assert.equal(applyLocalSuckerPunch(rolled, pendingTurn, 0).outcome, null);
  assert.equal(applyLocalSuckerPunch(game, pendingTurn, 1).outcome, null);
  game.players[0].suckerTokens = 1;
  assert.equal(applyLocalSuckerPunch(game, pendingTurn, 0).outcome, null);
  assert.equal(game.counterPunchPlayerId, game.players[0].id);
  game.counterPunchCost = 1;
  game.players[0].suckerTokens = 0;
  assert.equal(applyLocalSuckerPunch(game, pendingTurn, 0).outcome, null);
});

test('a landed regular punch does not grant a counterpunch', () => {
  const scored = submitSucker(createGame(['Player', 'Computer']));
  const result = applyLocalSuckerPunch(scored.game, scored.pendingTurn, 1, () => 0, 6);
  assert.equal(result.game.counterPunchPlayerId, undefined);
  assert.equal(result.outcome.isCounterPunch, false);
});

test('computer can take a counterpunch opportunity with exactly 2 tokens', () => {
  const game = createGame(['Player', 'Computer']);
  game.currentPlayerIndex = 1;
  const scored = submitSucker(game);
  const missed = applyLocalSuckerPunch(scored.game, scored.pendingTurn, 0, () => 0.99, 1);
  const response = submitSucker(missed.game);
  response.game.players[1].suckerTokens = 2;
  assert.equal(shouldComputerUseSuckerPunch(response.game, response.pendingTurn), true);
  const result = applyLocalSuckerPunch(response.game, response.pendingTurn, 1, () => 0, 6);
  assert.equal(result.outcome.isCounterPunch, true);
  assert.equal(result.game.players[1].suckerTokens, 0);
});

test('legacy saves remain valid and malformed counterpunch owners are rejected', () => {
  const game = createGame(['Player', 'Computer']);
  assert.deepEqual(toGameState(JSON.parse(JSON.stringify(game))), game);
  assert.throws(() => toGameState({ ...game, counterPunchPlayerId: 'unknown' }), /counterpunch player/);
  for (const cost of [0, 3, '1', 1.5]) {
    assert.throws(
      () => toGameState({ ...game, counterPunchPlayerId: game.players[0].id, counterPunchCost: cost }),
      /counterpunch cost/,
    );
  }
  assert.throws(() => toGameState({ ...game, counterPunchCost: 1 }), /counterpunch cost/);
});
