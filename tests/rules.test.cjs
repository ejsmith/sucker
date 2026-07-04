const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createGame,
  scoreCategory,
  scoreCategoryForScorecard,
  scoreTurn,
  scratchScoreBox,
  toggleHold,
  totalScore,
  toGameState,
  toHeldDice,
  upperBonus,
  maxRollsPerTurn,
  mulliganCurrentTurn,
  purchaseExtraRoll,
  rollsRemaining,
  startingSuckerTokens,
  suckerTokenCosts,
} = require('../.build/src/game');

test('scores upper categories by matching faces', () => {
  assert.equal(scoreCategory([1, 1, 3, 5, 1], 'ones'), 3);
  assert.equal(scoreCategory([6, 2, 6, 6, 4], 'sixes'), 18);
});

test('scores lower categories', () => {
  assert.equal(scoreCategory([3, 3, 3, 4, 5], 'threeOfAKind'), 18);
  assert.equal(scoreCategory([3, 3, 3, 3, 5], 'fourOfAKind'), 17);
  assert.equal(scoreCategory([2, 2, 2, 5, 5], 'fullHouse'), 25);
  assert.equal(scoreCategory([1, 2, 3, 4, 6], 'smallStraight'), 30);
  assert.equal(scoreCategory([2, 3, 4, 5, 6], 'largeStraight'), 40);
  assert.equal(scoreCategory([4, 4, 4, 4, 4], 'sucker'), 50);
  assert.equal(scoreCategory([1, 2, 3, 4, 6], 'chance'), 16);
});

test('returns zero when category conditions are not met', () => {
  assert.equal(scoreCategory([1, 1, 2, 3, 4], 'threeOfAKind'), 0);
  assert.equal(scoreCategory([1, 1, 2, 2, 3], 'fullHouse'), 0);
  assert.equal(scoreCategory([1, 2, 3, 5, 6], 'largeStraight'), 0);
});

test('turn scoring advances to the next player', () => {
  const game = {
    ...createGame(['Erin', 'Sam']),
    dice: [6, 6, 6, 2, 1],
    rollNumber: 2,
    phase: 'scoring',
  };

  const next = scoreTurn(game, 'threeOfAKind');

  assert.equal(next.players[0].scorecard.threeOfAKind, 21);
  assert.equal(next.currentPlayerIndex, 1);
  assert.equal(next.rollNumber, 0);
  assert.deepEqual(next.held, [false, false, false, false, false]);
});

test('players start with sucker tokens and can roll up to four times', () => {
  let game = createGame(['Erin', 'Sam']);
  assert.equal(game.players[0].suckerTokens, startingSuckerTokens);
  assert.equal(maxRollsPerTurn, 4);

  for (let i = 0; i < maxRollsPerTurn; i += 1) {
    game = rollDeterministic(game);
  }

  const blocked = rollDeterministic(game);
  assert.equal(blocked.rollNumber, 4);
});

test('scoring a sucker does not earn a sucker token', () => {
  const game = {
    ...createGame(['Erin', 'Sam']),
    dice: [6, 6, 6, 6, 6],
    rollNumber: 2,
    phase: 'scoring',
  };

  const next = scoreTurn(game, 'sucker');

  assert.equal(next.players[0].scorecard.sucker, 50);
  assert.equal(next.players[0].suckerTokens, startingSuckerTokens);
});

test('scoring zero in a category does not earn a sucker token', () => {
  const game = {
    ...createGame(['Erin', 'Sam']),
    dice: [1, 2, 3, 4, 5],
    rollNumber: 2,
    phase: 'scoring',
  };

  const next = scoreTurn(game, 'sixes');

  assert.equal(next.players[0].scorecard.sixes, 0);
  assert.equal(next.players[0].suckerTokens, startingSuckerTokens);
});

test('sucker deal scratches a selected score box and earns one token', () => {
  const game = {
    ...createGame(['Erin', 'Sam']),
    dice: [6, 6, 6, 6, 6],
    rollNumber: 2,
    phase: 'scoring',
  };

  const next = scratchScoreBox(game, 'sucker');

  assert.equal(next.players[0].scorecard.sucker, 0);
  assert.equal(next.players[0].suckerTokens, startingSuckerTokens + 1);
  assert.equal(next.currentPlayerIndex, 1);
  assert.equal(next.rollNumber, 0);
});

test('extra sucker adds 50 when sucker is already scored elsewhere', () => {
  const game = {
    ...createGame(['Erin', 'Sam']),
    dice: [4, 4, 4, 4, 4],
    rollNumber: 2,
    phase: 'scoring',
  };
  game.players[0].scorecard.sucker = 50;

  assert.equal(scoreCategoryForScorecard(game.dice, 'fourOfAKind', game.players[0].scorecard), 70);

  const next = scoreTurn(game, 'fourOfAKind');

  assert.equal(next.players[0].scorecard.fourOfAKind, 70);
  assert.equal(next.players[0].suckerTokens, startingSuckerTokens);
  assert.deepEqual(next.players[0].suckerBonusCategories, ['fourOfAKind']);
});

test('extra roll spends a token and adds one roll after available rolls are used', () => {
  let game = createGame(['Erin', 'Sam']);

  for (let i = 0; i < maxRollsPerTurn; i += 1) {
    game = rollDeterministic(game);
  }
  game = toggleHold(toggleHold(game, 0), 2);

  const purchased = purchaseExtraRoll(game);

  assert.equal(purchased.rollNumber, 4);
  assert.equal(rollsRemaining(purchased), 1);
  assert.equal(purchased.players[0].suckerTokens, startingSuckerTokens - suckerTokenCosts.extraRoll);
  assert.deepEqual(purchased.dice, game.dice);
  assert.deepEqual(purchased.held, game.held);

  const next = require('../.build/src/game').rollCurrentDice(purchased, () => 0.99);

  assert.equal(next.rollNumber, 5);
  assert.equal(rollsRemaining(next), 0);
  assert.deepEqual(next.dice, [game.dice[0], 6, game.dice[2], 6, 6]);
});

test('mulligan spends tokens and resets the current turn', () => {
  const game = {
    ...createGame(['Erin', 'Sam']),
    dice: [2, 3, 4, 5, 6],
    held: [true, false, true, false, true],
    rollNumber: 3,
    phase: 'scoring',
  };

  const next = mulliganCurrentTurn(game);

  assert.equal(next.rollNumber, 0);
  assert.equal(next.phase, 'rolling');
  assert.equal(next.players[0].suckerTokens, startingSuckerTokens - suckerTokenCosts.mulligan);
  assert.deepEqual(next.dice, [1, 1, 1, 1, 1]);
  assert.deepEqual(next.held, [false, false, false, false, false]);
});

test('dice cannot be held before first roll', () => {
  const game = createGame(['Erin', 'Sam']);

  assert.deepEqual(toggleHold(game, 0).held, [false, false, false, false, false]);
});

test('upper bonus is included in total score', () => {
  const scorecard = createGame(['Erin']).players[0].scorecard;
  scorecard.ones = 3;
  scorecard.twos = 6;
  scorecard.threes = 9;
  scorecard.fours = 12;
  scorecard.fives = 15;
  scorecard.sixes = 18;

  assert.equal(upperBonus(scorecard), 35);
  assert.equal(totalScore(scorecard), 98);
});

test('stored game state is validated before use', () => {
  const game = createGame(['Erin', 'Sam']);

  assert.deepEqual(toGameState(game), game);
  assert.throws(() => toGameState({ ...game, dice: [1, 2, 3] }), /invalid dice/);
  assert.throws(() => toGameState({ ...game, currentPlayerIndex: 3 }), /invalid current player/);
});

test('stored game state defaults legacy missing extra rolls to zero', () => {
  const game = createGame(['Erin', 'Sam']);
  const { extraRollsAvailable, ...legacyGame } = game;

  assert.equal(extraRollsAvailable, 0);
  assert.deepEqual(toGameState(legacyGame), game);
  assert.deepEqual(toGameState({ ...game, extraRollsAvailable: null }), game);
  assert.throws(() => toGameState({ ...game, extraRollsAvailable: -1 }), /invalid extra rolls/);
  assert.throws(() => toGameState({ ...game, extraRollsAvailable: 1.5 }), /invalid extra rolls/);
});

test('stored held dice must be a five boolean tuple', () => {
  assert.deepEqual(toHeldDice([true, false, true, false, true]), [true, false, true, false, true]);
  assert.throws(() => toHeldDice([true, false]), /invalid held dice/);
  assert.throws(() => toHeldDice([true, false, true, false, 1]), /invalid held dice/);
});

function rollDeterministic(game) {
  return require('../.build/src/game').rollCurrentDice(game, () => 0);
}
