const {
  availableCategories,
  createGame,
  maxAvailableRolls,
  mulliganCurrentTurn,
  purchaseExtraRoll,
  scoreCategories,
  scoreCategoryForScorecard,
  totalScore,
} = require('../.build/src/game');
const {
  defaultComputerStrategy,
  playAutomatedTurn,
  scoreLocalTurn,
  scratchLocalTurn,
} = require('../.build/src/game/computer');
const { createSeededRandom } = require('../.build/src/game/computerSimulation');

const gameCount = readPositiveInteger(process.argv[2], 20);
const seed = readPositiveInteger(process.argv[3], 1);
const stateLimit = readPositiveInteger(process.argv[4], 40);
const rolloutCount = readPositiveInteger(process.argv[5], 3);
const mode = process.argv[6] ?? 'sample';

const states =
  mode === 'losses'
    ? collectLosingHeadToHeadDecisionStates(gameCount, seed, stateLimit)
    : collectDecisionStates(gameCount, seed, stateLimit);
const rows = evaluateStates(states, rolloutCount);

console.log(
  `AI counterfactual (${mode}, ${gameCount} games, seed ${seed}, ${states.length} states, ${rolloutCount} rollouts/state)`,
);
console.log('');
printAggregates(rows);
printExamples(rows);

function collectDecisionStates(count, firstSeed, limit) {
  const collected = [];

  for (let gameIndex = 0; gameIndex < count && collected.length < limit; gameIndex += 1) {
    const gameSeed = firstSeed + gameIndex;
    const random = createSeededRandom(gameSeed);
    let game = createGame(['Opponent', 'Candidate']);
    let pendingTurn = null;
    let turnIndex = 0;

    while (game.phase !== 'complete' && collected.length < limit) {
      const activePlayerIndex = game.currentPlayerIndex;
      const result = playAutomatedTurn(game, activePlayerIndex, pendingTurn, random, defaultComputerStrategy, (trace) => {
        if (trace.stage !== 'decision' || collected.length >= limit) {
          return;
        }

        const currentAction = currentActionFromTrace(trace);
        if (!currentAction) {
          return;
        }

        collected.push({
          currentAction,
          game: cloneGame(trace.game),
          gameIndex: gameIndex + 1,
          seed: gameSeed,
          trace: cloneTrace(trace),
          turnIndex: turnIndex + 1,
        });
      });

      game = result.game;
      pendingTurn = result.pendingTurn;
      turnIndex += 1;
    }
  }

  return collected;
}

function collectLosingHeadToHeadDecisionStates(count, firstSeed, limit) {
  const collected = [];

  for (let seedIndex = 0; seedIndex < count && collected.length < limit; seedIndex += 1) {
    const gameSeed = firstSeed + seedIndex;
    for (const candidatePlayerIndex of [1, 0]) {
      if (collected.length >= limit) {
        break;
      }

      const gameStates = collectHeadToHeadGameDecisionStates(gameSeed, seedIndex + 1, candidatePlayerIndex);
      if (gameStates.margin < 0) {
        collected.push(...gameStates.states.slice(0, limit - collected.length));
      }
    }
  }

  return collected;
}

function collectHeadToHeadGameDecisionStates(gameSeed, gameIndex, candidatePlayerIndex) {
  const random = createSeededRandom(gameSeed);
  let game = createGame(candidatePlayerIndex === 1 ? ['Opponent', 'Candidate'] : ['Candidate', 'Opponent']);
  let pendingTurn = null;
  let turnIndex = 0;
  const states = [];

  while (game.phase !== 'complete') {
    const activePlayerIndex = game.currentPlayerIndex;
    const result = playAutomatedTurn(game, activePlayerIndex, pendingTurn, random, defaultComputerStrategy, (trace) => {
      if (activePlayerIndex !== candidatePlayerIndex || trace.stage !== 'decision') {
        return;
      }

      const currentAction = currentActionFromTrace(trace);
      if (!currentAction) {
        return;
      }

      states.push({
        candidatePlayerIndex,
        currentAction,
        game: cloneGame(trace.game),
        gameIndex,
        seed: gameSeed,
        trace: cloneTrace(trace),
        turnIndex: turnIndex + 1,
      });
    });

    game = result.game;
    pendingTurn = result.pendingTurn;
    turnIndex += 1;
  }

  const opponentIndex = game.players.findIndex((_player, index) => index !== candidatePlayerIndex);
  return {
    margin: totalScore(game.players[candidatePlayerIndex].scorecard) - totalScore(game.players[opponentIndex].scorecard),
    states,
  };
}

function evaluateStates(decisionStates, simulationsPerState) {
  const rows = [];

  for (const state of decisionStates) {
    const actions = actionCandidates(state.game, state.trace, state.currentAction);
    const baseline = evaluateAction(state, state.currentAction, simulationsPerState);

    for (const action of actions) {
      const key = actionKey(action);
      if (key === actionKey(state.currentAction)) {
        continue;
      }

      const result = evaluateAction(state, action, simulationsPerState);
      rows.push({
        action,
        baseline,
        deltaMargin: result.averageMargin - baseline.averageMargin,
        deltaWinValue: result.averageWinValue - baseline.averageWinValue,
        result,
        state,
      });
    }
  }

  return rows;
}

function evaluateAction(state, action, simulationsPerState) {
  let marginTotal = 0;
  let winValueTotal = 0;

  for (let index = 0; index < simulationsPerState; index += 1) {
    const random = createSeededRandom(counterfactualSeed(state, index));
    const applied = applyAction(cloneGame(state.game), action);
    const result = continueGame(applied.game, applied.pendingTurn, random, state.game.currentPlayerIndex);
    marginTotal += result.margin;
    winValueTotal += result.winValue;
  }

  return {
    averageMargin: marginTotal / simulationsPerState,
    averageWinValue: winValueTotal / simulationsPerState,
  };
}

function continueGame(game, pendingTurn, random, playerIndex) {
  let nextGame = game;
  let nextPendingTurn = pendingTurn;
  let guard = 0;

  while (nextGame.phase !== 'complete' && guard < 100) {
    const activePlayerIndex = nextGame.currentPlayerIndex;
    const result = playAutomatedTurn(
      nextGame,
      activePlayerIndex,
      nextPendingTurn,
      random,
      defaultComputerStrategy,
    );
    nextGame = result.game;
    nextPendingTurn = result.pendingTurn;
    guard += 1;
  }

  const opponentIndex = nextGame.players.findIndex((_player, index) => index !== playerIndex);
  const playerScore = totalScore(nextGame.players[playerIndex].scorecard);
  const opponentScore = opponentIndex >= 0 ? totalScore(nextGame.players[opponentIndex].scorecard) : 0;
  const margin = playerScore - opponentScore;

  return {
    margin,
    winValue: margin > 0 ? 1 : margin === 0 ? 0.5 : 0,
  };
}

function actionCandidates(game, trace, currentAction) {
  const scorecard = game.players[game.currentPlayerIndex].scorecard;
  const byKey = new Map();
  const add = (action) => byKey.set(actionKey(action), action);

  add(currentAction);

  const rankedCategories = trace.rankedCategories.slice(0, 4).map((choice) => choice.category);
  for (const category of rankedCategories) {
    if (scorecard[category] !== null) {
      continue;
    }

    add({ category, type: 'scratch' });
    if (scoreCategoryForScorecard(game.dice, category, scorecard) > 0) {
      add({ category, type: 'score' });
    }
  }

  if (canBuyExtraRoll(game)) {
    add({ type: 'extraRoll' });
  }

  if (canUseMulligan(game, trace)) {
    add({ type: 'mulligan' });
  }

  return [...byKey.values()];
}

function applyAction(game, action) {
  if (action.type === 'extraRoll') {
    return { game: purchaseExtraRoll(game), pendingTurn: null };
  }

  if (action.type === 'mulligan') {
    return { game: mulliganCurrentTurn(game), pendingTurn: null };
  }

  if (action.type === 'scratch') {
    return scratchLocalTurn(game, action.category);
  }

  return scoreLocalTurn(game, action.category);
}

function currentActionFromTrace(trace) {
  if (trace.shouldMulligan) {
    return { type: 'mulligan' };
  }

  if (trace.shouldBuyExtraRoll) {
    return { type: 'extraRoll' };
  }

  return trace.finalAction;
}

function canBuyExtraRoll(game) {
  const player = game.players[game.currentPlayerIndex];
  return (
    game.phase !== 'complete' &&
    game.rollNumber >= maxAvailableRolls(game) &&
    player &&
    player.suckerTokens > 0
  );
}

function canUseMulligan(game, trace) {
  const player = game.players[game.currentPlayerIndex];
  return (
    game.phase !== 'complete' &&
    game.rollNumber > 0 &&
    trace.mulligansUsed === 0 &&
    player &&
    player.suckerTokens >= 3
  );
}

function printAggregates(rows) {
  console.log('Top broad alternatives');
  printAggregateSet(rows, broadAggregateKey, 3, 10);
  console.log('');
  console.log('Top contextual alternatives');
  printAggregateSet(rows, aggregateKey, 2, 12);
}

function printAggregateSet(rows, keyForRow, minCount, limit) {
  const aggregates = new Map();

  for (const row of rows) {
    const key = keyForRow(row);
    const aggregate = aggregates.get(key) ?? {
      count: 0,
      deltaMargin: 0,
      deltaWinValue: 0,
      key,
    };
    aggregate.count += 1;
    aggregate.deltaMargin += row.deltaMargin;
    aggregate.deltaWinValue += row.deltaWinValue;
    aggregates.set(key, aggregate);
  }

  for (const aggregate of [...aggregates.values()]
    .filter((item) => item.count >= minCount)
    .sort(
      (left, right) =>
        right.deltaWinValue / right.count - left.deltaWinValue / left.count ||
        right.deltaMargin / right.count - left.deltaMargin / left.count,
    )
    .slice(0, limit)) {
    console.log(
      `${formatSigned(aggregate.deltaWinValue / aggregate.count, 3)} win | ` +
        `${formatSigned(aggregate.deltaMargin / aggregate.count, 2)} margin | ` +
        `${String(aggregate.count).padStart(3, ' ')}x | ${aggregate.key}`,
    );
  }
}

function printExamples(rows) {
  console.log('');
  console.log('Top individual alternatives');
  for (const row of rows
    .filter((item) => item.deltaWinValue > 0 || item.deltaMargin > 0)
    .sort((left, right) => right.deltaWinValue - left.deltaWinValue || right.deltaMargin - left.deltaMargin)
    .slice(0, 16)) {
    const trace = row.state.trace;
    const best = trace.bestCategory;
    console.log(
      `${formatSigned(row.deltaWinValue, 3)} win | ${formatSigned(row.deltaMargin, 2)} margin | ` +
        `${actionKey(row.state.currentAction)} -> ${actionKey(row.action)} | ` +
        `seed ${row.state.seed} turn ${row.state.turnIndex} p${row.state.game.currentPlayerIndex} ` +
        `roll ${trace.rollNumber}/${trace.maxRolls} tokens ${trace.suckerTokens} open ${trace.availableCategoryCount} ` +
        `best ${best ? `${best.category}:${best.score}` : 'none'} dice ${trace.dice.join('')}`,
    );
  }
}

function aggregateKey(row) {
  const trace = row.state.trace;
  const best = trace.bestCategory;
  return [
    `${actionFamily(row.state.currentAction)}->${actionFamily(row.action)}`,
    `alt:${actionKey(row.action)}`,
    `best:${best?.category ?? 'none'}`,
    `score:${scoreBucket(best?.score ?? 0)}`,
    `open:${openBucket(trace.availableCategoryCount)}`,
    `roll:${trace.rollNumber}/${trace.maxRolls}`,
    `tokens:${tokenBucket(trace.suckerTokens)}`,
      ].join(' ');
}

function broadAggregateKey(row) {
  const trace = row.state.trace;
  const best = trace.bestCategory;
  return [
    `${actionFamily(row.state.currentAction)}->${actionFamily(row.action)}`,
    `alt:${actionKey(row.action)}`,
    `best:${best?.category ?? 'none'}`,
    `score:${scoreBucket(best?.score ?? 0)}`,
    `open:${openBucket(trace.availableCategoryCount)}`,
  ].join(' ');
}

function actionFamily(action) {
  return action.type === 'score' || action.type === 'scratch' ? action.type : action.type;
}

function actionKey(action) {
  return action.type === 'score' || action.type === 'scratch' ? `${action.type}:${action.category}` : action.type;
}

function scoreBucket(score) {
  if (score <= 0) {
    return '0';
  }
  if (score <= 10) {
    return '1-10';
  }
  if (score <= 20) {
    return '11-20';
  }
  if (score <= 30) {
    return '21-30';
  }
  return '31+';
}

function openBucket(openCount) {
  if (openCount <= 2) {
    return '1-2';
  }
  if (openCount <= 5) {
    return '3-5';
  }
  if (openCount <= 9) {
    return '6-9';
  }
  return '10+';
}

function tokenBucket(tokens) {
  if (tokens <= 3) {
    return '0-3';
  }
  if (tokens <= 6) {
    return '4-6';
  }
  return '7+';
}

function counterfactualSeed(state, rolloutIndex) {
  return hashValues([
    state.seed,
    state.turnIndex,
    state.game.currentPlayerIndex,
    state.trace.rollNumber,
    state.trace.maxRolls,
    rolloutIndex,
    ...state.trace.dice,
    ...scoreCategories.map((category) => state.game.players[0].scorecard[category] ?? -1),
    ...scoreCategories.map((category) => state.game.players[1].scorecard[category] ?? -1),
    state.game.players[0].suckerTokens,
    state.game.players[1].suckerTokens,
  ]);
}

function hashValues(values) {
  let hash = 2166136261;
  for (const value of values) {
    hash = Math.imul(hash ^ (Number(value) + 257), 16777619) >>> 0;
  }
  return hash;
}

function cloneTrace(trace) {
  return {
    ...trace,
    dice: [...trace.dice],
    game: cloneGame(trace.game),
    held: trace.held ? [...trace.held] : null,
    openCategories: [...trace.openCategories],
    rankedCategories: trace.rankedCategories.map((category) => ({ ...category })),
    scorecard: trace.scorecard ? { ...trace.scorecard } : null,
  };
}

function cloneGame(game) {
  return {
    ...game,
    dice: [...game.dice],
    held: [...game.held],
    players: game.players.map((player) => ({
      ...player,
      scorecard: { ...player.scorecard },
      suckerBonusCategories: [...player.suckerBonusCategories],
    })),
  };
}

function formatSigned(value, digits) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
