const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyLocalSuckerPunch,
  computerPlayerIndex,
  defaultComputerStrategy,
  playComputerTurn,
  shouldComputerUseSuckerPunch,
  traceComputerDecision,
} = require('../.build/src/game/computer');
const { createGame, startingSuckerTokens } = require('../.build/src/game');
const {
  createComputerStrategyCandidates,
  runComputerStrategyTournament,
} = require('../.build/src/game/computerTournament');
const {
  measureComputerHeadToHeadSideBalanced,
  measureComputerStrategy,
  simulateComputerScore,
} = require('../.build/src/game/computerSimulation');

test('computer score simulation is deterministic for a seed', () => {
  assert.equal(simulateComputerScore(42), simulateComputerScore(42));
});

test('computer strategy clears a strong 1000-game average', () => {
  const result = measureComputerStrategy({ gameCount: 1000, seed: 1 });

  assert.equal(result.gameCount, 1000);
  assert.equal(Number(result.averageScore.toFixed(3)), 301.661);
  assert.equal(result.lowScore, 119);
  assert.equal(result.highScore, 579);
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

test('side-balanced head-to-head measurement counts both player slots', () => {
  const result = measureComputerHeadToHeadSideBalanced({
    candidateStrategy: defaultComputerStrategy,
    gameCount: 4,
    opponentStrategy: defaultComputerStrategy,
    seed: 7,
  });

  assert.equal(result.gameCount, 8);
  assert.equal(result.averageMargin, 0);
  assert.equal(result.wins, result.losses);
  assert.equal(result.wins + result.losses + result.ties, 8);
});

test('computer trace shows it keeps four dice toward a large straight', () => {
  const game = {
    ...createGame(['Player', 'Computer']),
    currentPlayerIndex: computerPlayerIndex,
    dice: [1, 2, 3, 4, 6],
    phase: 'scoring',
    rollNumber: 2,
  };

  const trace = traceComputerDecision(game);

  assert.deepEqual(trace.held, [true, true, true, true, false]);
  assert.equal(trace.shouldStopRolling, false);
});

test('computer hold rollout strategy can choose legal held dice', () => {
  const game = {
    ...createGame(['Player', 'Computer']),
    currentPlayerIndex: computerPlayerIndex,
    dice: [1, 2, 3, 4, 6],
    phase: 'scoring',
    rollNumber: 2,
  };
  const rolloutStrategy = {
    ...defaultComputerStrategy,
    holdRolloutRollNumberMax: 3,
    holdRolloutSimulations: 2,
  };

  const trace = traceComputerDecision(game, computerPlayerIndex, rolloutStrategy);

  assert.equal(trace.held.length, 5);
  assert.ok(trace.held.every((value) => typeof value === 'boolean'));
});

test('computer trace shows it stops on a made large straight', () => {
  const game = {
    ...createGame(['Player', 'Computer']),
    currentPlayerIndex: computerPlayerIndex,
    dice: [2, 3, 4, 5, 6],
    phase: 'scoring',
    rollNumber: 2,
  };

  const trace = traceComputerDecision(game);

  assert.equal(trace.bestCategory.category, 'largeStraight');
  assert.equal(trace.finalAction.category, 'largeStraight');
  assert.equal(trace.finalAction.type, 'score');
  assert.equal(trace.shouldStopRolling, true);
});

test('computer turn trace callback records actual turn-loop decisions', () => {
  const game = {
    ...createGame(['Player', 'Computer']),
    currentPlayerIndex: computerPlayerIndex,
  };
  const traces = [];

  playComputerTurn(game, null, () => 0, defaultComputerStrategy, (trace) => traces.push(trace));

  assert.ok(traces.some((trace) => trace.stage === 'after_roll'));
  assert.ok(traces.some((trace) => trace.stage === 'decision'));
  assert.ok(traces.every((trace) => trace.rollNumber > 0));
});

test('computer does not buy extra rolls only to chase sucker from four of a kind', () => {
  const game = createComputerScoringGame({
    dice: [3, 3, 3, 3, 2],
    rollNumber: 4,
  });

  const trace = traceComputerDecision(game);

  assert.equal(trace.shouldBuyExtraRoll, false);
});

test('computer strategy can preserve a token reserve before buying extra rolls', () => {
  const game = createComputerScoringGame({
    dice: [3, 3, 3, 3, 2],
    players: createGame(['Player', 'Computer']).players.map((player, index) =>
      index === computerPlayerIndex ? { ...player, suckerTokens: 3 } : player,
    ),
    rollNumber: 4,
  });
  const reserveStrategy = {
    ...defaultComputerStrategy,
    extraRollReserveTokens: 3,
  };

  const trace = traceComputerDecision(game, computerPlayerIndex, reserveStrategy);

  assert.equal(trace.shouldBuyExtraRoll, false);
});

test('computer strategy can configure the minimum token count for extra rolls', () => {
  const game = createComputerScoringGame({
    dice: [1, 1, 2, 3, 6],
    players: createGame(['Player', 'Computer']).players.map((player, index) =>
      index === computerPlayerIndex ? { ...player, suckerTokens: 3 } : player,
    ),
    rollNumber: 4,
  });
  const lowerMinimumStrategy = {
    ...defaultComputerStrategy,
    extraRollMinTokens: 3,
  };

  assert.equal(traceComputerDecision(game).shouldBuyExtraRoll, false);
  assert.equal(traceComputerDecision(game, computerPlayerIndex, lowerMinimumStrategy).shouldBuyExtraRoll, true);
});

test('computer strategy can configure chained extra rolls', () => {
  const game = createComputerScoringGame({
    dice: [1, 1, 2, 3, 6],
    extraRollsAvailable: 1,
    rollNumber: 5,
  });
  const traceContext = { extraRollsBought: 1 };
  const singleExtraRollStrategy = {
    ...defaultComputerStrategy,
    extraRollMaxPurchases: 1,
  };

  assert.equal(
    traceComputerDecision(game, computerPlayerIndex, singleExtraRollStrategy, traceContext).shouldBuyExtraRoll,
    false,
  );
  assert.equal(
    traceComputerDecision(game, computerPlayerIndex, defaultComputerStrategy, traceContext).shouldBuyExtraRoll,
    true,
  );
  assert.equal(
    traceComputerDecision(game, computerPlayerIndex, defaultComputerStrategy, { extraRollsBought: 3 }).shouldBuyExtraRoll,
    false,
  );
});

test('computer does not mulligan a playable twelve point score by default', () => {
  const game = createComputerScoringGame({
    dice: [3, 3, 3, 5, 3],
    rollNumber: 4,
  });
  game.players[computerPlayerIndex].scorecard.twos = 0;
  game.players[computerPlayerIndex].scorecard.threeOfAKind = 23;
  game.players[computerPlayerIndex].scorecard.fourOfAKind = 17;
  game.players[computerPlayerIndex].scorecard.fullHouse = 25;
  game.players[computerPlayerIndex].scorecard.smallStraight = 30;
  game.players[computerPlayerIndex].scorecard.largeStraight = 40;
  game.players[computerPlayerIndex].scorecard.chance = 21;

  const trace = traceComputerDecision(game);

  assert.equal(trace.bestCategory.category, 'threes');
  assert.equal(trace.bestCategory.score, 12);
  assert.equal(trace.shouldMulligan, false);
});

test('computer still mulligans truly low early scores', () => {
  const game = createComputerScoringGame({
    dice: [2, 2, 1, 3, 1],
    rollNumber: 4,
  });
  game.players[computerPlayerIndex].scorecard.fullHouse = 25;
  game.players[computerPlayerIndex].scorecard.largeStraight = 40;

  const trace = traceComputerDecision(game);

  assert.equal(trace.bestCategory.category, 'twos');
  assert.equal(trace.bestCategory.score, 4);
  assert.equal(trace.shouldMulligan, true);
});

test('computer scratches instead of scoring zero in a category', () => {
  const game = createComputerScoringGame({
    dice: [1, 1, 6, 1, 1],
    rollNumber: 4,
  });
  game.players[computerPlayerIndex].scorecard.ones = 3;
  game.players[computerPlayerIndex].scorecard.fours = 12;
  game.players[computerPlayerIndex].scorecard.fives = 15;
  game.players[computerPlayerIndex].scorecard.sixes = 12;
  game.players[computerPlayerIndex].scorecard.threeOfAKind = 11;
  game.players[computerPlayerIndex].scorecard.fourOfAKind = 14;
  game.players[computerPlayerIndex].scorecard.fullHouse = 25;
  game.players[computerPlayerIndex].scorecard.smallStraight = 30;
  game.players[computerPlayerIndex].scorecard.largeStraight = 40;
  game.players[computerPlayerIndex].scorecard.chance = 23;

  const trace = traceComputerDecision(game);

  assert.equal(trace.bestCategory.score, 0);
  assert.equal(trace.finalAction.type, 'scratch');
});

test('computer rollout strategy can choose a legal late-game final action', () => {
  const game = createComputerScoringGame({
    dice: [1, 2, 3, 5, 6],
    rollNumber: 4,
  });
  const filledCategories = [
    'ones',
    'twos',
    'threes',
    'fours',
    'threeOfAKind',
    'fourOfAKind',
    'fullHouse',
    'smallStraight',
    'largeStraight',
    'sucker',
  ];
  for (const category of filledCategories) {
    game.players[computerPlayerIndex].scorecard[category] = 10;
  }
  const rolloutStrategy = {
    ...defaultComputerStrategy,
    extraRollMaxScore: -1,
    finalActionRolloutOpenCategoryMax: 3,
    finalActionRolloutSimulations: 2,
    mulliganMaxScore: -1,
  };

  const trace = traceComputerDecision(game, computerPlayerIndex, rolloutStrategy);

  assert.ok(trace.finalAction);
  assert.ok(['score', 'scratch'].includes(trace.finalAction.type));
  assert.ok(trace.openCategories.includes(trace.finalAction.category));
});

test('computer rollout strategy can choose a late-game turn decision', () => {
  const game = createComputerScoringGame({
    dice: [1, 1, 2, 3, 6],
    rollNumber: 4,
  });
  const filledCategories = [
    'ones',
    'twos',
    'threes',
    'fours',
    'fives',
    'sixes',
    'threeOfAKind',
    'fourOfAKind',
    'fullHouse',
    'smallStraight',
    'largeStraight',
  ];
  for (const category of filledCategories) {
    game.players[computerPlayerIndex].scorecard[category] = 10;
  }
  const rolloutStrategy = {
    ...defaultComputerStrategy,
    finalActionRolloutOpenCategoryMax: 0,
    finalActionRolloutSimulations: 0,
    turnDecisionRolloutOpenCategoryMax: 2,
    turnDecisionRolloutSimulations: 2,
  };
  const traces = [];

  playComputerTurn(game, null, () => 0, rolloutStrategy, (trace) => traces.push(trace));

  const decisionTrace = traces.find((trace) => trace.stage === 'decision');
  assert.ok(decisionTrace);
  assert.ok(decisionTrace.shouldBuyExtraRoll || decisionTrace.shouldMulligan || decisionTrace.finalAction);
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

test('computer does not sucker punch non-sucker late comeback swings', () => {
  const game = createLateSubmittedPlayerTurn('largeStraight', 40);

  assert.equal(shouldComputerUseSuckerPunch(game, createPendingPlayerTurn('largeStraight', 40)), false);
});

test('local sucker punch hit removes the target score and starts replay', () => {
  const game = createSubmittedPlayerTurn('sucker', 50);
  const pendingTurn = createPendingPlayerTurn('sucker', 50);
  const result = applyLocalSuckerPunch(game, pendingTurn, computerPlayerIndex, sequenceRandom([0.99, 0]));

  assert.equal(result.outcome.landed, true);
  assert.equal(result.outcome.chanceDie, 6);
  assert.equal(result.game.currentPlayerIndex, 0);
  assert.equal(result.game.players[0].scorecard.sucker, null);
  assert.equal(result.game.players[computerPlayerIndex].suckerTokens, startingSuckerTokens - 3);
  assert.equal(result.pendingTurn.status, 'punched');
});

test('local blocked sucker punch keeps the target score and attacker turn', () => {
  const game = createSubmittedPlayerTurn('sucker', 50);
  const pendingTurn = createPendingPlayerTurn('sucker', 50);
  const result = applyLocalSuckerPunch(game, pendingTurn, computerPlayerIndex, sequenceRandom([0, 0.99]));

  assert.equal(result.outcome.landed, false);
  assert.equal(result.outcome.chanceDie, 1);
  assert.equal(result.game.currentPlayerIndex, computerPlayerIndex);
  assert.equal(result.game.players[0].scorecard.sucker, 50);
  assert.equal(result.game.players[computerPlayerIndex].suckerTokens, startingSuckerTokens - 3);
  assert.equal(result.pendingTurn, null);
});

test('computer does not take a cheap sucker deal at full token balance', () => {
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

  assert.equal(computer.scorecard.ones, null);
  assert.equal(computer.scorecard.chance, 12);
  assert.equal(computer.suckerTokens, startingSuckerTokens);
  assert.equal(result.pendingTurn.category, 'chance');
});

test('computer scratches the lowest opportunity cost category for cheap sucker deals', () => {
  const noTokenSpendStrategy = {
    ...defaultComputerStrategy,
    extraRollMaxScore: -1,
    mulliganMaxScore: -1,
  };
  const game = {
    ...createGame(['Player', 'Computer']),
    currentPlayerIndex: computerPlayerIndex,
    dice: [1, 1, 3, 4, 6],
    phase: 'scoring',
    players: createGame(['Player', 'Computer']).players.map((player, index) =>
      index === computerPlayerIndex ? { ...player, suckerTokens: 7 } : player,
    ),
    rollNumber: 4,
  };

  const result = playComputerTurn(game, null, Math.random, noTokenSpendStrategy);
  const computer = result.game.players[computerPlayerIndex];

  assert.equal(computer.scorecard.ones, 0);
  assert.equal(computer.scorecard.twos, null);
  assert.equal(computer.scorecard.chance, null);
  assert.equal(computer.suckerTokens, 8);
});

test('computer does not keep farming sucker deals after ones are scratched', () => {
  const noTokenSpendStrategy = {
    ...defaultComputerStrategy,
    extraRollMaxScore: -1,
    mulliganMaxScore: -1,
  };
  const baseGame = createGame(['Player', 'Computer']);
  const game = {
    ...baseGame,
    currentPlayerIndex: computerPlayerIndex,
    dice: [2, 2, 3, 5, 6],
    phase: 'scoring',
    players: baseGame.players.map((player, index) =>
      index === computerPlayerIndex
        ? {
            ...player,
            scorecard: {
              ...player.scorecard,
              ones: 0,
            },
            suckerTokens: 7,
          }
        : player,
    ),
    rollNumber: 4,
  };

  const result = playComputerTurn(game, null, Math.random, noTokenSpendStrategy);
  const computer = result.game.players[computerPlayerIndex];

  assert.equal(computer.scorecard.twos, null);
  assert.equal(computer.scorecard.threes, null);
  assert.equal(computer.scorecard.chance, 18);
  assert.equal(computer.suckerTokens, 7);
  assert.equal(result.pendingTurn.category, 'chance');
});

test('computer strategy can defer cheap sucker deals until after token spending checks', () => {
  const game = {
    ...createGame(['Player', 'Computer']),
    currentPlayerIndex: computerPlayerIndex,
    dice: [1, 1, 2, 3, 5],
    phase: 'scoring',
    rollNumber: 4,
  };
  const traces = [];
  const deferredDealStrategy = {
    ...defaultComputerStrategy,
    suckerDealBeforeTokenSpending: false,
  };

  playComputerTurn(game, null, () => 0, deferredDealStrategy, (trace) => traces.push(trace));

  const decisionTrace = traces.find((trace) => trace.stage === 'decision');
  assert.equal(decisionTrace.shouldBuyExtraRoll, true);
  assert.equal(decisionTrace.finalAction, null);
});

function createComputerScoringGame(overrides) {
  return {
    ...createGame(['Player', 'Computer']),
    currentPlayerIndex: computerPlayerIndex,
    dice: overrides.dice,
    extraRollsAvailable: overrides.extraRollsAvailable ?? 0,
    held: overrides.held ?? [false, false, false, false, false],
    phase: 'scoring',
    players: overrides.players ?? createGame(['Player', 'Computer']).players,
    rollNumber: overrides.rollNumber,
  };
}

function createSubmittedPlayerTurn(category, score, options = {}) {
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
            suckerTokens: options.scorerTokens ?? player.suckerTokens,
          }
        : player,
    ),
  };
}

function createPendingPlayerTurn(category, score) {
  return {
    category,
    dice: category === 'sucker' ? [1, 1, 1, 1, 1] : [1, 2, 3, 4, 5],
    hadSuckerBonus: false,
    id: `test-${category}`,
    responderIndex: computerPlayerIndex,
    score,
    scorerIndex: 0,
    status: 'submitted',
  };
}

function sequenceRandom(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
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
