const assert = require('node:assert/strict');
const test = require('node:test');

const {
  computerPlayerIndex,
  defaultComputerStrategy,
  playComputerTurn,
  shouldComputerUseSuckerPunch,
} = require('../.build/src/game/computer');
const { createGame, startingSuckerTokens } = require('../.build/src/game');
const {
  createComputerStrategyCandidates,
  runComputerStrategyTournament,
} = require('../.build/src/game/computerTournament');
const { measureComputerStrategy, simulateComputerScore } = require('../.build/src/game/computerSimulation');

test('computer score simulation is deterministic for a seed', () => {
  assert.equal(simulateComputerScore(42), simulateComputerScore(42));
});

test('computer strategy clears a strong 1000-game average', () => {
  const result = measureComputerStrategy({ gameCount: 1000, seed: 1 });

  assert.equal(result.gameCount, 1000);
  assert.equal(Number(result.averageScore.toFixed(3)), 281.826);
  assert.equal(result.lowScore, 121);
  assert.equal(result.highScore, 534);
});

test('computer tournament advances the strongest candidate', () => {
  const candidates = createComputerStrategyCandidates().slice(0, 4);
  const result = runComputerStrategyTournament({
    candidates,
    rounds: [{ advanceCount: 1, gameCount: 10, seed: 1 }],
  });

  assert.equal(result.rounds.length, 1);
  assert.equal(result.rounds[0].scores.length, 4);
  assert.equal(result.winner, result.rounds[0].scores[0]);
});

test('computer saves sucker punch tokens on early medium scores', () => {
  const game = createSubmittedPlayerTurn('smallStraight', 30);

  assert.equal(shouldComputerUseSuckerPunch(game, createPendingPlayerTurn('smallStraight', 30)), false);
});

test('computer does not sucker punch early non-sucker scores', () => {
  const game = createSubmittedPlayerTurn('largeStraight', 40);

  assert.equal(shouldComputerUseSuckerPunch(game, createPendingPlayerTurn('largeStraight', 40)), false);
});

test('computer uses sucker punch on sucker scores', () => {
  const game = createSubmittedPlayerTurn('sucker', 50);

  assert.equal(shouldComputerUseSuckerPunch(game, createPendingPlayerTurn('sucker', 50)), true);
});

test('computer can sucker punch late comeback swings', () => {
  const game = createLateSubmittedPlayerTurn('largeStraight', 40);

  assert.equal(shouldComputerUseSuckerPunch(game, createPendingPlayerTurn('largeStraight', 40)), true);
});

test('computer takes a cheap sucker deal instead of early low chance', () => {
  const noTokenSpendStrategy = {
    ...defaultComputerStrategy,
    extraRollMaxScore: -1,
    mulliganMaxScore: -1,
  };
  const game = {
    ...createGame(['Player', 'Computer']),
    currentPlayerIndex: computerPlayerIndex,
    dice: [1, 1, 2, 3, 5],
    phase: 'scoring',
    rollNumber: 4,
  };

  const result = playComputerTurn(game, null, Math.random, noTokenSpendStrategy);
  const computer = result.game.players[computerPlayerIndex];

  assert.equal(computer.scorecard.ones, 0);
  assert.equal(computer.scorecard.chance, null);
  assert.equal(computer.suckerTokens, startingSuckerTokens + 1);
  assert.equal(result.pendingTurn, null);
});

test('computer gains a token from a cheap sucker deal when starting below full', () => {
  const noTokenSpendStrategy = {
    ...defaultComputerStrategy,
    extraRollMaxScore: -1,
    mulliganMaxScore: -1,
  };
  const game = {
    ...createGame(['Player', 'Computer']),
    currentPlayerIndex: computerPlayerIndex,
    dice: [1, 1, 2, 3, 5],
    phase: 'scoring',
    players: createGame(['Player', 'Computer']).players.map((player, index) =>
      index === computerPlayerIndex ? { ...player, suckerTokens: 7 } : player,
    ),
    rollNumber: 4,
  };

  const result = playComputerTurn(game, null, Math.random, noTokenSpendStrategy);
  const computer = result.game.players[computerPlayerIndex];

  assert.equal(computer.scorecard.ones, 0);
  assert.equal(computer.suckerTokens, 8);
});

function createSubmittedPlayerTurn(category, score) {
  const game = createGame(['Player', 'Computer']);
  return {
    ...game,
    currentPlayerIndex: computerPlayerIndex,
    players: game.players.map((player, index) =>
      index === 0
        ? {
            ...player,
            scorecard: {
              ...player.scorecard,
              [category]: score,
            },
          }
        : player,
    ),
  };
}

function createPendingPlayerTurn(category, score) {
  return {
    category,
    dice: [1, 2, 3, 4, 5],
    hadSuckerBonus: false,
    id: `test-${category}`,
    responderIndex: computerPlayerIndex,
    score,
    scorerIndex: 0,
    status: 'submitted',
  };
}

function createLateSubmittedPlayerTurn(category, score) {
  const game = createSubmittedPlayerTurn(category, score);
  const filledCategories = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'threeOfAKind', 'fourOfAKind'];

  return {
    ...game,
    players: game.players.map((player, index) =>
      index === 0
        ? {
            ...player,
            scorecard: filledCategories.reduce(
              (scorecard, filledCategory) => ({
                ...scorecard,
                [filledCategory]: scorecard[filledCategory] ?? 10,
              }),
              {
                ...player.scorecard,
                [category]: score,
              },
            ),
          }
        : player,
    ),
  };
}
