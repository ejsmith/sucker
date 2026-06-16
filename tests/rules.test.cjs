const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createGame,
  scoreCategory,
  scoreCategoryForScorecard,
  scoreTurn,
  toggleHold,
  totalScore,
  upperBonus,
  maxRollsPerTurn,
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

test('players start with a sucker token and can roll up to four times', () => {
  let game = createGame(['Erin', 'Sam']);
  assert.equal(game.players[0].suckerTokens, 1);
  assert.equal(maxRollsPerTurn, 4);

  for (let i = 0; i < maxRollsPerTurn; i += 1) {
    game = rollDeterministic(game);
  }

  const blocked = rollDeterministic(game);
  assert.equal(blocked.rollNumber, 4);
});

test('scoring a sucker earns one sucker token', () => {
  const game = {
    ...createGame(['Erin', 'Sam']),
    dice: [6, 6, 6, 6, 6],
    rollNumber: 2,
    phase: 'scoring',
  };

  const next = scoreTurn(game, 'sucker');

  assert.equal(next.players[0].scorecard.sucker, 50);
  assert.equal(next.players[0].suckerTokens, 2);
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
  assert.equal(next.players[0].suckerTokens, 2);
  assert.deepEqual(next.players[0].suckerBonusCategories, ['fourOfAKind']);
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

function rollDeterministic(game) {
  return require('../.build/src/game').rollCurrentDice(game, () => 0);
}
