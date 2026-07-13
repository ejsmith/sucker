const { availableCategories, createGame, scoreCategories, totalScore } = require('../.build/src/game');
const { computerPlayerIndex, defaultComputerStrategy, playComputerTurn } = require('../.build/src/game/computer');
const { createSeededRandom } = require('../.build/src/game/computerSimulation');

const gameCount = readPositiveInteger(process.argv[2], 25);
const seed = readPositiveInteger(process.argv[3], 1);
const caseLimit = readPositiveInteger(process.argv[4], 20);

const cases = [];
const reasonCounts = new Map();
const lowGames = [];
let totalScoreSum = 0;

for (let gameIndex = 0; gameIndex < gameCount; gameIndex += 1) {
  const gameSeed = seed + gameIndex;
  const random = createSeededRandom(gameSeed);
  let game = {
    ...createGame(['Player', 'Computer']),
    currentPlayerIndex: computerPlayerIndex,
  };
  let turnIndex = 0;

  while (availableCategories(game.players[computerPlayerIndex].scorecard).length > 0) {
    const traces = [];
    const result = playComputerTurn(
      {
        ...game,
        currentPlayerIndex: computerPlayerIndex,
        phase: 'rolling',
      },
      null,
      random,
      defaultComputerStrategy,
      (trace) => traces.push({ ...trace, gameIndex: gameIndex + 1, seed: gameSeed, turnIndex: turnIndex + 1 }),
    );

    for (const trace of traces) {
      for (const reason of classifyTrace(trace)) {
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
        if (cases.length < caseLimit) {
          cases.push({ reason, trace });
        }
      }
    }

    game = {
      ...result.game,
      currentPlayerIndex: computerPlayerIndex,
      phase: result.game.phase === 'complete' ? 'complete' : 'rolling',
    };
    turnIndex += 1;
  }

  const score = totalScore(game.players[computerPlayerIndex].scorecard);
  totalScoreSum += score;
  if (score < 180) {
    lowGames.push({ gameIndex: gameIndex + 1, score, seed: gameSeed });
  }
}

console.log(`AI lab (${gameCount} games, seed ${seed})`);
console.log(`Average score: ${(totalScoreSum / gameCount).toFixed(3)}`);
console.log('');

if (reasonCounts.size === 0) {
  console.log('No suspicious decisions matched the current lab rules.');
} else {
  console.log('Suspicious decision counts');
  for (const [reason, count] of [...reasonCounts.entries()].sort((left, right) => right[1] - left[1])) {
    console.log(`${String(count).padStart(4, ' ')}  ${reason}`);
  }
}

if (lowGames.length > 0) {
  console.log('');
  console.log('Low scoring games');
  for (const game of lowGames.slice(0, 8)) {
    console.log(`game ${game.gameIndex} seed ${game.seed}: ${game.score}`);
  }
}

if (cases.length > 0) {
  console.log('');
  console.log(`First ${cases.length} cases`);
  for (const [index, item] of cases.entries()) {
    printCase(index + 1, item.reason, item.trace);
  }
}

function classifyTrace(trace) {
  const reasons = [];
  const best = trace.bestCategory;
  if (!best || trace.rollNumber === 0) {
    return reasons;
  }

  if (trace.stage === 'after_roll') {
    if (trace.shouldStopRolling && trace.rollNumber < trace.maxRolls && best.score < 35) {
      reasons.push('stopped-before-final-roll-with-low-score');
    }

    if (!trace.shouldStopRolling && best.score >= 45) {
      reasons.push('kept-rolling-with-premium-score-available');
    }

    if (
      trace.held &&
      trace.openCategories.includes('largeStraight') &&
      hasStraightCandidate(trace.dice, 5) &&
      countHeld(trace.held) < 4
    ) {
      reasons.push('did-not-hold-four-dice-toward-large-straight');
    }

    return reasons;
  }

  if (trace.shouldMulligan) {
    reasons.push('uses-mulligan');
  }

  if (trace.shouldBuyExtraRoll && !trace.shouldMulligan) {
    reasons.push('buys-extra-roll');
  }

  const willContinueTurn = trace.shouldMulligan || trace.shouldBuyExtraRoll;

  if (!willContinueTurn && trace.finalAction?.type === 'scratch') {
    if (isSuckerDealScratch(trace)) {
      reasons.push(trace.suckerTokens >= 10 ? 'sucker-deal-scratch-at-high-token-count' : 'sucker-deal-scratch');
    } else {
      const scratchedScore = finalActionScore(trace);
      if (scratchedScore === 0) {
        reasons.push(
          trace.suckerTokens >= 10 ? 'zero-score-scratch-at-high-token-count' : 'zero-score-scratch-for-token',
        );
      } else {
        reasons.push(
          trace.suckerTokens >= 10 ? 'positive-score-scratch-at-high-token-count' : 'positive-score-scratch-for-token',
        );
      }
    }
  }

  if (
    !willContinueTurn &&
    trace.finalAction?.type === 'score' &&
    trace.finalAction.category === 'chance' &&
    best.score <= 20 &&
    trace.availableCategoryCount > 4
  ) {
    reasons.push('scores-low-chance-with-many-open-categories');
  }

  if (
    !willContinueTurn &&
    trace.finalAction?.type === 'score' &&
    best.score === 0 &&
    trace.availableCategoryCount > 1
  ) {
    reasons.push('scores-zero-with-alternatives-open');
  }

  if (
    trace.rollNumber >= trace.maxRolls &&
    !trace.shouldBuyExtraRoll &&
    !trace.shouldMulligan &&
    !isSuckerDealScratch(trace) &&
    trace.suckerTokens > 0 &&
    best.score <= 12 &&
    trace.availableCategoryCount > 1
  ) {
    reasons.push(`passes-extra-roll-with-low-final-score:${classifyExtraRollPass(trace)}`);
  }

  return reasons;
}

function printCase(index, reason, trace) {
  const best = trace.bestCategory;
  const finalAction = trace.finalAction ? `${trace.finalAction.type}:${trace.finalAction.category}` : 'none';
  const held = trace.held ? trace.held.map((value) => (value ? 'H' : '-')).join('') : 'none';
  const topCategories = trace.rankedCategories
    .slice(0, 5)
    .map((category) => `${category.category}=${category.score}/${category.value.toFixed(1)}`)
    .join(', ');
  const scoredCategories = scoreCategories
    .filter((category) => trace.scorecard?.[category] !== null && trace.scorecard?.[category] !== undefined)
    .map((category) => `${category}:${trace.scorecard[category]}`)
    .join(', ');

  console.log('');
  console.log(`#${index} ${reason}`);
  console.log(`game ${trace.gameIndex}, seed ${trace.seed}, turn ${trace.turnIndex}, ${trace.stage}`);
  console.log(
    `dice [${trace.dice.join(', ')}], roll ${trace.rollNumber}/${trace.maxRolls}, held ${held}, tokens ${trace.suckerTokens}, score ${trace.playerScore}`,
  );
  console.log(
    `best ${best?.category ?? 'none'} score ${best?.score ?? 'n/a'} value ${best ? best.value.toFixed(1) : 'n/a'}, final ${finalAction}`,
  );
  console.log(
    `stop ${trace.shouldStopRolling}, extra ${trace.shouldBuyExtraRoll}, mulligan ${trace.shouldMulligan}, open ${trace.openCategories.join(', ')}`,
  );
  console.log(`top: ${topCategories}`);
  console.log(`scored: ${scoredCategories || 'none'}`);
}

function countHeld(held) {
  return held.filter(Boolean).length;
}

function hasStraightCandidate(dice, length) {
  const faces = new Set(dice);
  const runs =
    length === 5
      ? [
          [1, 2, 3, 4, 5],
          [2, 3, 4, 5, 6],
        ]
      : [
          [1, 2, 3, 4],
          [2, 3, 4, 5],
          [3, 4, 5, 6],
        ];
  return runs.some((run) => run.filter((face) => faces.has(face)).length >= length - 1);
}

function classifyExtraRollPass(trace) {
  if (trace.extraRollsBought >= defaultComputerStrategy.extraRollMaxPurchases) {
    return 'max-extra-rolls';
  }

  if (trace.suckerTokens < defaultComputerStrategy.extraRollMinTokens) {
    return 'token-floor';
  }

  if (trace.suckerTokens - 1 < defaultComputerStrategy.extraRollReserveTokens) {
    return 'reserve';
  }

  if (trace.openCategories.includes('sucker') && maxMatchingDice(trace.dice) >= 4) {
    return 'sucker-chase-disabled';
  }

  return 'other';
}

function isSuckerDealScratch(trace) {
  return (
    trace.bestCategory?.category === 'chance' &&
    trace.finalAction?.type === 'scratch' &&
    ['ones', 'twos', 'threes'].includes(trace.finalAction.category)
  );
}

function finalActionScore(trace) {
  return trace.rankedCategories.find((category) => category.category === trace.finalAction?.category)?.score ?? 0;
}

function maxMatchingDice(dice) {
  return Math.max(...[1, 2, 3, 4, 5, 6].map((face) => dice.filter((die) => die === face).length));
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
