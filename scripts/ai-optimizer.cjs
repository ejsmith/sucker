const { defaultComputerStrategy } = require('../.build/src/game/computer');
const { measureComputerHeadToHeadSideBalanced } = require('../.build/src/game/computerSimulation');

const candidateCount = readPositiveInteger(process.argv[2], 80);
const seed = readPositiveInteger(process.argv[3], 1);
const survivorLimit = readPositiveInteger(process.argv[4], 8);
const validationGameCount = readPositiveInteger(process.argv[5], 48);
const validationMinWinRate = readProbability(process.argv[6], 0.55);
const confirmationGameCount = readNonNegativeInteger(process.argv[7], 0);

const searchRounds = [
  { gameCount: 12, minWinRate: 0.55, seedOffset: 0 },
  { gameCount: 16, minWinRate: 0.535, seedOffset: 10000 },
  { gameCount: 24, minWinRate: 0.525, seedOffset: 20000 },
];
const validationRounds = [
  { gameCount: validationGameCount, seedOffset: 30000 },
  { gameCount: validationGameCount, seedOffset: 40000 },
];
const confirmationRounds =
  confirmationGameCount > 0
    ? [
        { gameCount: confirmationGameCount, seedOffset: 50000 },
        { gameCount: confirmationGameCount, seedOffset: 60000 },
      ]
    : [];

const random = createSeededRandom(seed);
const candidates = createCandidates(candidateCount, random);
const searchSurvivors = [];
const heldOutSurvivors = [];
const confirmedSurvivors = [];

console.log(
  `AI optimizer (${candidateCount} candidates, seed ${seed}, validation ${validationGameCount}x2, ` +
    `target ${(validationMinWinRate * 100).toFixed(2)}%` +
    `${confirmationGameCount > 0 ? `, confirmation ${confirmationGameCount}x2` : ''})`,
);
console.log('');

for (const [index, candidate] of candidates.entries()) {
  if (index > 0 && index % 10 === 0) {
    console.log(
      `searched ${index}/${candidates.length - 1}, search survivors ${searchSurvivors.length}, ` +
        `held-out survivors ${heldOutSurvivors.length}, confirmed ${confirmedSurvivors.length}`,
    );
  }

  const searchResult = evaluateCandidate(candidate.strategy, searchRounds, seed + index * 997);
  if (!searchResult.promoted) {
    continue;
  }

  const validation = evaluateCandidate(candidate.strategy, validationRounds, seed + index * 997);
  const heldOut = validation.summary.winRate >= validationMinWinRate;
  const confirmation =
    heldOut && confirmationRounds.length > 0
      ? evaluateCandidate(candidate.strategy, confirmationRounds, seed + index * 997)
      : null;
  const confirmed = Boolean(confirmation && confirmation.summary.winRate >= validationMinWinRate);
  console.log(
    `${heldOut ? 'held-out survivor' : 'held-out reject'} ${candidate.name}: ` +
      `${(validation.summary.winRate * 100).toFixed(2)}% | ${formatMargin(validation.summary.averageMargin)} margin`,
  );
  if (confirmation) {
    console.log(
      `${confirmed ? 'confirmed survivor' : 'confirmation reject'} ${candidate.name}: ` +
        `${(confirmation.summary.winRate * 100).toFixed(2)}% | ` +
        `${formatMargin(confirmation.summary.averageMargin)} margin`,
    );
  }
  const item = {
    candidate,
    confirmation: confirmation?.summary ?? null,
    search: searchResult.summary,
    validation: validation.summary,
  };
  searchSurvivors.push(item);
  if (heldOut) {
    heldOutSurvivors.push(item);
  }
  if (confirmed) {
    confirmedSurvivors.push(item);
  }
}

searchSurvivors.sort(compareCandidateResults);
heldOutSurvivors.sort(compareCandidateResults);
confirmedSurvivors.sort(compareCandidateResults);

if (confirmationRounds.length > 0) {
  if (confirmedSurvivors.length === 0) {
    console.log(`No candidates cleared ${(validationMinWinRate * 100).toFixed(2)}% confirmation.`);
  } else {
    console.log('Confirmed survivors');
    for (const item of confirmedSurvivors.slice(0, survivorLimit)) {
      printCandidate(item);
    }
  }
}

if (heldOutSurvivors.length === 0) {
  console.log(`No candidates cleared ${(validationMinWinRate * 100).toFixed(2)}% held-out validation.`);
} else {
  console.log('Held-out survivors');
  for (const item of heldOutSurvivors.slice(0, survivorLimit)) {
    printCandidate(item);
  }
}

if (searchSurvivors.length > 0) {
  console.log('');
  console.log('Best search survivors, including held-out rejects');
  for (const item of searchSurvivors.slice(0, survivorLimit)) {
    printCandidate(item);
  }
}

function compareCandidateResults(left, right) {
  return (
    (right.confirmation?.winRate ?? -1) - (left.confirmation?.winRate ?? -1) ||
    right.validation.winRate - left.validation.winRate ||
    right.validation.averageMargin - left.validation.averageMargin ||
    right.search.winRate - left.search.winRate
  );
}

function createCandidates(count, random) {
  const candidates = [
    {
      name: 'current',
      strategy: defaultComputerStrategy,
    },
  ];
  const seen = new Set([strategyKey(defaultComputerStrategy)]);
  const seedCandidates = createSeedCandidates();
  const mutationBases = [defaultComputerStrategy];

  for (const candidate of seedCandidates) {
    const key = strategyKey(candidate.strategy);
    if (seen.has(key) || candidates.length >= count + 1) {
      continue;
    }

    seen.add(key);
    candidates.push(candidate);
    mutationBases.push(candidate.strategy);
  }

  while (candidates.length < count + 1) {
    const strategy = mutateStrategy(pick(mutationBases, random), random);
    const key = strategyKey(strategy);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push({
      name: `candidate-${candidates.length}`,
      strategy,
    });
  }

  return candidates;
}

function createSeedCandidates() {
  const closeRolloutExtra = {
    ...defaultComputerStrategy,
    chanceEarlyPenalty: 10,
    extraRollMaxPurchases: 2,
    extraRollMaxScore: 16,
    finalActionRolloutOpenCategoryMax: 4,
    finalActionRolloutSimulations: 24,
    holdRolloutRollNumberMax: 1,
    holdRolloutSimulations: 80,
    madeCategoryBonuses: {
      ...defaultComputerStrategy.madeCategoryBonuses,
      smallStraight: 8,
    },
    mulliganMaxScore: 0,
    turnDecisionRolloutOpenCategoryMax: 1,
    turnDecisionRolloutSimulations: 12,
  };
  const deepRollout = {
    ...defaultComputerStrategy,
    finalActionRolloutOpenCategoryMax: 4,
    finalActionRolloutSimulations: 24,
    holdRolloutRollNumberMax: 1,
    holdRolloutSimulations: 80,
    turnDecisionRolloutOpenCategoryMax: 1,
    turnDecisionRolloutSimulations: 12,
  };
  const finalActionRollout = {
    ...defaultComputerStrategy,
    finalActionRolloutOpenCategoryMax: 4,
    finalActionRolloutSimulations: 24,
  };
  const actualScoreHold = {
    ...defaultComputerStrategy,
    holdRolloutSimulations: 80,
    holdRolloutTokenValue: 0,
    holdRolloutUseActualScoreDelta: true,
  };
  const c19Lite = {
    ...defaultComputerStrategy,
    extraRollMaxScore: 22,
    finalActionRolloutOpenCategoryMax: 4,
    finalActionRolloutSimulations: 16,
    holdRolloutRollNumberMax: 2,
    madeCategoryBonuses: {
      ...defaultComputerStrategy.madeCategoryBonuses,
      fourOfAKind: 8,
      smallStraight: 12,
    },
    suckerPunchComebackMinCategories: 10,
    suckerPunchComebackMinScore: 40,
    turnDecisionRolloutIncludesMulligan: false,
    turnDecisionRolloutOpenCategoryMax: 2,
    upperPressureScratchCostBonus: 6,
    upperShortfallPenalty: 0.7,
  };

  return [
    {
      name: 'seed-close-rollout-extra',
      strategy: closeRolloutExtra,
    },
    {
      name: 'seed-deep-rollout',
      strategy: deepRollout,
    },
    {
      name: 'seed-final-action-rollout',
      strategy: finalActionRollout,
    },
    {
      name: 'seed-actual-score-hold',
      strategy: actualScoreHold,
    },
    {
      name: 'seed-extra-strict',
      strategy: {
        ...defaultComputerStrategy,
        extraRollMaxPurchases: 2,
        extraRollMaxScore: 16,
      },
    },
    {
      name: 'seed-deal-early',
      strategy: {
        ...defaultComputerStrategy,
        suckerDealMinOpenCategories: 6,
      },
    },
    {
      name: 'seed-c19-lite',
      strategy: c19Lite,
    },
  ];
}

function mutateStrategy(base, random) {
  const strategy = {
    ...base,
    madeCategoryBonuses: {
      ...base.madeCategoryBonuses,
    },
  };

  mutateNumber(strategy, 'chanceEarlyPenalty', [4, 6, 8, 10, 12, 14], random, 0.35);
  mutateNumber(strategy, 'extraRollMaxPurchases', [2, 3, 4], random, 0.35);
  mutateNumber(strategy, 'extraRollMaxScore', [16, 18, 20, 22, 24], random, 0.4);
  mutateNumber(strategy, 'extraRollMinTokens', [3, 4, 5, 6], random, 0.35);
  mutateNumber(strategy, 'extraRollReserveTokens', [0, 1, 2, 3], random, 0.35);
  mutateNumber(strategy, 'finalActionRolloutOpenCategoryMax', [1, 2, 3, 4], random, 0.35);
  mutateNumber(strategy, 'finalActionRolloutSimulations', [8, 12, 16, 24], random, 0.35);
  mutateNumber(strategy, 'faceChaseCountWeight', [8, 10, 12, 14], random, 0.3);
  mutateNumber(strategy, 'faceChaseFourOfAKindValue', [4, 8, 12, 16], random, 0.3);
  mutateNumber(strategy, 'faceChasePipWeight', [0, 0.2, 0.5, 1], random, 0.3);
  mutateNumber(strategy, 'faceChaseSuckerValue', [10, 14, 18, 22, 26], random, 0.3);
  mutateNumber(strategy, 'faceChaseThreeOfAKindValue', [0, 2, 4, 8], random, 0.3);
  mutateNumber(strategy, 'holdRolloutRollNumberMax', [1, 2], random, 0.2);
  mutateNumber(strategy, 'holdRolloutSimulations', [32, 48, 64, 80, 96], random, 0.35);
  mutateNumber(strategy, 'holdRolloutTokenValue', [0, 1, 2, 3, 4], random, 0.35);
  mutateBoolean(strategy, 'holdRolloutUseActualScoreDelta', random, 0.25);
  mutateNumber(strategy, 'mulliganMaxScore', [0, 4, 6, 8, 10, 12], random, 0.35);
  mutateNumber(strategy, 'opportunityCostChance', [14, 18, 22, 26], random, 0.3);
  mutateNumber(strategy, 'opportunityCostFourOfAKind', [18, 22, 24, 28, 32], random, 0.3);
  mutateNumber(strategy, 'opportunityCostFullHouse', [18, 21, 23, 26, 30], random, 0.3);
  mutateNumber(strategy, 'opportunityCostLargeStraight', [24, 28, 32, 36, 40], random, 0.3);
  mutateNumber(strategy, 'opportunityCostSmallStraight', [15, 18, 20, 24, 28], random, 0.3);
  mutateNumber(strategy, 'opportunityCostSucker', [35, 40, 45, 50, 55], random, 0.3);
  mutateNumber(strategy, 'opportunityCostThreeOfAKind', [14, 18, 22, 26], random, 0.3);
  mutateNumber(strategy, 'stopScoreThreshold', [30, 32, 35, 38, 40], random, 0.3);
  mutateNumber(strategy, 'suckerBlockerMinScore', [15, 20, 25, 30], random, 0.3);
  mutateNumber(strategy, 'suckerDealChanceMaxScore', [16, 18, 20, 22], random, 0.35);
  mutateNumber(strategy, 'suckerDealMaxSacrificeScore', [1, 2, 3], random, 0.35);
  mutateNumber(strategy, 'suckerDealMaxTokens', [6, 8, 10, 12, 999], random, 0.35);
  mutateNumber(strategy, 'suckerDealMinOpenCategories', [6, 8, 10], random, 0.35);
  mutateNumber(strategy, 'suckerPunchComebackMinCategories', [6, 8, 10], random, 0.3);
  mutateNumber(strategy, 'suckerPunchComebackMinScore', [20, 30, 40], random, 0.3);
  mutateNumber(strategy, 'suckerPunchReserveTokens', [0, 1, 2, 3], random, 0.3);
  mutateNumber(strategy, 'suckerPunchUnblockableMinScore', [30, 40, 50, 999], random, 0.3);
  mutateBoolean(strategy, 'turnDecisionRolloutIncludesExtraRoll', random, 0.15);
  mutateBoolean(strategy, 'turnDecisionRolloutIncludesMulligan', random, 0.15);
  mutateNumber(strategy, 'turnDecisionRolloutOpenCategoryMax', [0, 1, 2], random, 0.35);
  mutateNumber(strategy, 'turnDecisionRolloutSimulations', [0, 8, 12, 16], random, 0.35);
  mutateNumber(strategy, 'upperPressureHoldMultiplier', [1.2, 1.5, 1.8], random, 0.3);
  mutateNumber(strategy, 'upperPressureScratchCostBonus', [2, 4, 6], random, 0.3);
  mutateNumber(strategy, 'upperShortfallPenalty', [0.7, 0.9, 1.1], random, 0.3);

  mutateBonus(strategy, 'fourOfAKind', [0, 4, 8], random, 0.25);
  mutateBonus(strategy, 'fullHouse', [0, 3, 6, 9], random, 0.25);
  mutateBonus(strategy, 'largeStraight', [8, 10, 12], random, 0.25);
  mutateBonus(strategy, 'smallStraight', [5, 8, 12], random, 0.25);

  return strategy;
}

function evaluateCandidate(strategy, rounds, baseSeed) {
  const summary = {
    averageMargin: 0,
    averageOpponentScore: 0,
    averageScore: 0,
    gameCount: 0,
    losses: 0,
    ties: 0,
    winRate: 0,
    wins: 0,
  };

  for (const [roundIndex, round] of rounds.entries()) {
    const result = measureComputerHeadToHeadSideBalanced({
      candidateStrategy: strategy,
      gameCount: round.gameCount,
      opponentStrategy: defaultComputerStrategy,
      seed: baseSeed + round.seedOffset,
    });
    mergeResult(summary, result);

    if (summary.winRate < round.minWinRate) {
      return {
        promoted: false,
        roundIndex,
        summary,
      };
    }
  }

  return {
    promoted: true,
    roundIndex: rounds.length - 1,
    summary,
  };
}

function mergeResult(summary, result) {
  const previousGameCount = summary.gameCount;
  const nextGameCount = previousGameCount + result.gameCount;
  summary.averageScore =
    (summary.averageScore * previousGameCount + result.averageScore * result.gameCount) / nextGameCount;
  summary.averageOpponentScore =
    (summary.averageOpponentScore * previousGameCount + result.averageOpponentScore * result.gameCount) / nextGameCount;
  summary.averageMargin = summary.averageScore - summary.averageOpponentScore;
  summary.gameCount = nextGameCount;
  summary.losses += result.losses;
  summary.ties += result.ties;
  summary.wins += result.wins;
  summary.winRate = summary.wins / nextGameCount;
}

function printCandidate(item) {
  console.log('');
  console.log(item.candidate.name);
  console.log(
    `search ${(item.search.winRate * 100).toFixed(2)}% | ${formatMargin(item.search.averageMargin)} margin | ` +
      `${item.search.wins}-${item.search.losses}-${item.search.ties}`,
  );
  console.log(
    `valid  ${(item.validation.winRate * 100).toFixed(2)}% | ${formatMargin(item.validation.averageMargin)} margin | ` +
      `${item.validation.wins}-${item.validation.losses}-${item.validation.ties}`,
  );
  if (item.confirmation) {
    console.log(
      `confirm ${(item.confirmation.winRate * 100).toFixed(2)}% | ` +
        `${formatMargin(item.confirmation.averageMargin)} margin | ` +
        `${item.confirmation.wins}-${item.confirmation.losses}-${item.confirmation.ties}`,
    );
  }
  console.log(JSON.stringify(diffStrategy(item.candidate.strategy), null, 2));
}

function diffStrategy(strategy) {
  const diff = {};
  for (const [key, value] of Object.entries(strategy)) {
    if (key === 'madeCategoryBonuses') {
      const bonusDiff = {};
      for (const [category, bonus] of Object.entries(value)) {
        if (bonus !== defaultComputerStrategy.madeCategoryBonuses[category]) {
          bonusDiff[category] = bonus;
        }
      }
      if (Object.keys(bonusDiff).length > 0) {
        diff[key] = bonusDiff;
      }
    } else if (value !== defaultComputerStrategy[key]) {
      diff[key] = value;
    }
  }
  return diff;
}

function mutateNumber(strategy, key, values, random, probability) {
  if (random() < probability) {
    strategy[key] = pick(values, random);
  }
}

function mutateBoolean(strategy, key, random, probability) {
  if (random() < probability) {
    strategy[key] = !strategy[key];
  }
}

function mutateBonus(strategy, key, values, random, probability) {
  if (random() < probability) {
    strategy.madeCategoryBonuses[key] = pick(values, random);
  }
}

function pick(values, random) {
  return values[Math.floor(random() * values.length)];
}

function strategyKey(strategy) {
  return JSON.stringify(strategy);
}

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function formatMargin(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function readProbability(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}
