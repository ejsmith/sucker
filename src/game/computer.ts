import {
  availableCategories,
  isSuckerRoll,
  maxAvailableRolls,
  mulliganCurrentTurn,
  purchaseExtraRoll,
  rollCurrentDice,
  scoreCategories,
  scoreCategoryForScorecard,
  scoreTurn,
  suckerTokenCosts,
  totalScore,
  type DieValue,
  type GameState,
  type ScoreCategory,
} from './index';

export const computerPlayerIndex = 1;

export type LocalPendingTurn = {
  category: ScoreCategory;
  dice: GameState['dice'];
  hadSuckerBonus: boolean;
  id: string;
  puncherIndex?: number;
  responderIndex: number;
  score: number;
  scorerIndex: number;
  status: 'submitted' | 'punched';
};

export type ComputerTurnResult = {
  game: GameState;
  message?: string | null;
  pendingTurn: LocalPendingTurn | null;
  scoreAnimation?: {
    category: ScoreCategory;
    dice: GameState['dice'];
    hadSuckerBonus: boolean;
    score: number;
    scorerIndex: number;
  };
};

export type ComputerStrategyConfig = {
  chanceEarlyPenalty: number;
  extraRollMaxScore: number;
  madeCategoryBonuses: Partial<Record<ScoreCategory, number>>;
  mulliganMaxScore: number;
  suckerBlockerMinScore: number;
  suckerPunchComebackMinCategories: number;
  suckerPunchComebackMinScore: number;
  suckerPunchMinScore: number;
  suckerPunchReserveTokens: number;
  stopScoreThreshold: number;
  suckerCategoryBonus: number;
  upperPressureHoldMultiplier: number;
  upperPressureScratchCostBonus: number;
  upperShortfallPenalty: number;
};

export const defaultComputerStrategy: ComputerStrategyConfig = {
  chanceEarlyPenalty: 8,
  extraRollMaxScore: 20,
  madeCategoryBonuses: {
    fourOfAKind: 4,
    fullHouse: 6,
    largeStraight: 10,
    smallStraight: 5,
    threeOfAKind: 1,
  },
  mulliganMaxScore: 12,
  suckerBlockerMinScore: 20,
  suckerPunchComebackMinCategories: 8,
  suckerPunchComebackMinScore: 30,
  suckerPunchMinScore: 50,
  suckerPunchReserveTokens: 0,
  stopScoreThreshold: 35,
  suckerCategoryBonus: 8,
  upperPressureHoldMultiplier: 1.5,
  upperPressureScratchCostBonus: 4,
  upperShortfallPenalty: 0.9,
};

export function scoreLocalTurn(game: GameState, category: ScoreCategory): ComputerTurnResult {
  const scorerIndex = game.currentPlayerIndex;
  const scorer = game.players[scorerIndex];
  const score = scoreCategoryForScorecard(game.dice, category, scorer.scorecard);
  const hadSuckerBonus = category !== 'sucker' && scorer.scorecard.sucker !== null && isSuckerRoll(game.dice);
  const nextGame = scoreTurn(game, category);
  const pendingTurn =
    nextGame.phase === 'complete'
      ? null
      : {
          category,
          dice: game.dice,
          hadSuckerBonus,
          id: `${game.id}-${scorer.id}-${category}-${Date.now()}`,
          responderIndex: nextGame.currentPlayerIndex,
          score,
          scorerIndex,
          status: 'submitted' as const,
        };

  return {
    game: nextGame,
    pendingTurn,
    scoreAnimation: {
      category,
      dice: game.dice,
      hadSuckerBonus,
      score,
      scorerIndex,
    },
  };
}

export function applyLocalSuckerPunch(
  game: GameState,
  pendingTurn: LocalPendingTurn,
  puncherIndex: number,
): { game: GameState; pendingTurn: LocalPendingTurn } {
  const scorer = game.players[pendingTurn.scorerIndex];
  const puncher = game.players[puncherIndex];
  if (
    pendingTurn.status !== 'submitted' ||
    !scorer ||
    !puncher ||
    pendingTurn.scorerIndex === puncherIndex ||
    puncher.suckerTokens < suckerTokenCosts.suckerPunch
  ) {
    return { game, pendingTurn };
  }

  const players = game.players.map((player, index) => {
    if (index === pendingTurn.scorerIndex) {
      return {
        ...player,
        scorecard: {
          ...player.scorecard,
          [pendingTurn.category]: null,
        },
        suckerBonusCategories: player.suckerBonusCategories.filter((category) => category !== pendingTurn.category),
      };
    }

    if (index === puncherIndex) {
      return {
        ...player,
        suckerTokens: Math.max(0, player.suckerTokens - suckerTokenCosts.suckerPunch),
      };
    }

    return player;
  });

  return {
    game: {
      ...game,
      currentPlayerIndex: pendingTurn.scorerIndex,
      dice: [1, 1, 1, 1, 1],
      extraRollsAvailable: 0,
      held: [false, false, false, false, false],
      phase: 'rolling',
      players,
      rollNumber: 0,
    },
    pendingTurn: {
      ...pendingTurn,
      puncherIndex,
      status: 'punched',
    },
  };
}

export function applyLocalSuckerBlocker(
  game: GameState,
  pendingTurn: LocalPendingTurn,
  blockerIndex: number,
): GameState {
  const blocker = game.players[blockerIndex];
  if (
    pendingTurn.status !== 'punched' ||
    pendingTurn.scorerIndex !== blockerIndex ||
    !blocker ||
    blocker.suckerTokens < suckerTokenCosts.suckerBlocker
  ) {
    return game;
  }

  const players = game.players.map((player, index) => {
    if (index !== blockerIndex) {
      return player;
    }

    const suckerBonusCategories =
      pendingTurn.hadSuckerBonus && !player.suckerBonusCategories.includes(pendingTurn.category)
        ? [...player.suckerBonusCategories, pendingTurn.category]
        : player.suckerBonusCategories;

    return {
      ...player,
      scorecard: {
        ...player.scorecard,
        [pendingTurn.category]: pendingTurn.score,
      },
      suckerBonusCategories,
      suckerTokens: Math.max(0, player.suckerTokens - suckerTokenCosts.suckerBlocker),
    };
  });

  return {
    ...game,
    currentPlayerIndex: pendingTurn.responderIndex,
    dice: [1, 1, 1, 1, 1],
    extraRollsAvailable: 0,
    held: [false, false, false, false, false],
    phase: 'rolling',
    players,
    rollNumber: 0,
  };
}

export function playComputerTurn(
  game: GameState,
  pendingTurn: LocalPendingTurn | null = null,
  random: () => number = Math.random,
  strategy: ComputerStrategyConfig = defaultComputerStrategy,
): ComputerTurnResult {
  return playAutomatedTurn(game, computerPlayerIndex, pendingTurn, random, strategy);
}

export function playAutomatedTurn(
  game: GameState,
  automatedPlayerIndex: number,
  pendingTurn: LocalPendingTurn | null = null,
  random: () => number = Math.random,
  strategy: ComputerStrategyConfig = defaultComputerStrategy,
): ComputerTurnResult {
  if (game.currentPlayerIndex !== automatedPlayerIndex || game.phase === 'complete') {
    return { game, pendingTurn };
  }

  if (pendingTurn?.status === 'submitted' && pendingTurn.responderIndex === automatedPlayerIndex) {
    if (shouldAutomatedUseSuckerPunch(game, pendingTurn, automatedPlayerIndex, strategy)) {
      const punched = applyLocalSuckerPunch(game, pendingTurn, automatedPlayerIndex);
      return {
        game: punched.game,
        message: 'Computer used Sucker Punch. Block it or replay the turn.',
        pendingTurn: punched.pendingTurn,
      };
    }

    pendingTurn = null;
  }

  if (pendingTurn?.status === 'punched' && pendingTurn.scorerIndex === automatedPlayerIndex) {
    if (shouldAutomatedUseSuckerBlocker(game, pendingTurn, automatedPlayerIndex, strategy)) {
      return {
        game: applyLocalSuckerBlocker(game, pendingTurn, automatedPlayerIndex),
        message: 'Computer used Sucker Blocker. The score stands.',
        pendingTurn: null,
      };
    }

    pendingTurn = null;
  }

  let nextGame = {
    ...game,
    held: [false, false, false, false, false] as typeof game.held,
  };
  let mulligansUsed = 0;
  let extraRollsBought = 0;

  while (true) {
    while (nextGame.rollNumber < maxAvailableRolls(nextGame)) {
      nextGame = rollCurrentDice(nextGame, random);
      const choice = getBestComputerCategoryChoice(
        nextGame.dice,
        nextGame.players[automatedPlayerIndex].scorecard,
        strategy,
      );
      if (shouldComputerStopRolling(nextGame, automatedPlayerIndex, choice, strategy)) {
        break;
      }

      nextGame = {
        ...nextGame,
        held: chooseComputerHeldDice(nextGame, automatedPlayerIndex, strategy),
      };
    }

    const computer = nextGame.players[automatedPlayerIndex];
    const choice = getBestComputerCategoryChoice(nextGame.dice, computer.scorecard, strategy);

    if (shouldComputerUseMulligan(nextGame, automatedPlayerIndex, choice, mulligansUsed, strategy)) {
      nextGame = mulliganCurrentTurn(nextGame);
      mulligansUsed += 1;
      continue;
    }

    if (shouldComputerBuyExtraRoll(nextGame, automatedPlayerIndex, choice, extraRollsBought, strategy)) {
      nextGame = purchaseExtraRoll(nextGame);
      extraRollsBought += 1;
      continue;
    }

    break;
  }

  const category = chooseComputerCategory(nextGame.dice, nextGame.players[automatedPlayerIndex].scorecard, strategy);
  return scoreLocalTurn(nextGame, category);
}

function chooseComputerCategory(
  dice: GameState['dice'],
  scorecard: GameState['players'][number]['scorecard'],
  strategy: ComputerStrategyConfig,
) {
  return getBestComputerCategoryChoice(dice, scorecard, strategy).category;
}

type ComputerCategoryChoice = {
  category: ScoreCategory;
  priority: number;
  score: number;
  value: number;
};

function getBestComputerCategoryChoice(
  dice: GameState['dice'],
  scorecard: GameState['players'][number]['scorecard'],
  strategy: ComputerStrategyConfig,
) {
  return availableCategories(scorecard)
    .map((category) => ({
      category,
      score: scoreCategoryForScorecard(dice, category, scorecard),
      value: computerCategoryValue(dice, category, scorecard, strategy),
      priority: computerCategoryPriority(category),
    }))
    .sort((left, right) => right.value - left.value || right.score - left.score || right.priority - left.priority)[0];
}

function computerCategoryPriority(category: ScoreCategory) {
  return scoreCategories.indexOf(category);
}

function computerCategoryValue(
  dice: GameState['dice'],
  category: ScoreCategory,
  scorecard: GameState['players'][number]['scorecard'],
  strategy: ComputerStrategyConfig,
) {
  const score = scoreCategoryForScorecard(dice, category, scorecard);
  if (score === 0) {
    return -computerCategoryOpportunityCost(category, scorecard, strategy);
  }

  if (category === 'chance') {
    return score - (availableCategories(scorecard).length > 4 ? strategy.chanceEarlyPenalty : 0);
  }

  if (category === 'sucker') {
    return score + strategy.suckerCategoryBonus;
  }

  if (isUpperCategory(category)) {
    const target = upperCategoryTarget(category);
    return score - Math.max(0, target - score) * strategy.upperShortfallPenalty;
  }

  return score + (strategy.madeCategoryBonuses[category] ?? 0);
}

function computerCategoryOpportunityCost(
  category: ScoreCategory,
  scorecard: GameState['players'][number]['scorecard'],
  strategy: ComputerStrategyConfig,
) {
  if (category === 'ones') {
    return upperBonusPressure(scorecard) ? 8 : 2;
  }
  if (category === 'twos') {
    return upperBonusPressure(scorecard) ? 10 : 4;
  }
  if (category === 'threes') {
    return upperBonusPressure(scorecard) ? 12 : 7;
  }
  if (category === 'chance') {
    return 18;
  }
  if (isUpperCategory(category)) {
    return upperBonusPressure(scorecard)
      ? upperCategoryTarget(category) + strategy.upperPressureScratchCostBonus
      : upperCategoryTarget(category);
  }

  return {
    threeOfAKind: 18,
    fourOfAKind: 24,
    fullHouse: 23,
    smallStraight: 20,
    largeStraight: 32,
    sucker: 45,
  }[category];
}

function upperBonusPressure(scorecard: GameState['players'][number]['scorecard']) {
  const openUpperCategories = upperCategories.filter((category) => scorecard[category] === null);
  if (openUpperCategories.length === 0) {
    return false;
  }

  const scoredUpperTotal = upperCategories.reduce((total, category) => total + (scorecard[category] ?? 0), 0);
  const remainingTarget = openUpperCategories.reduce((total, category) => total + upperCategoryTarget(category), 0);
  return scoredUpperTotal + remainingTarget >= 63;
}

export function shouldComputerUseSuckerPunch(
  game: GameState,
  pendingTurn: LocalPendingTurn,
  strategy: ComputerStrategyConfig = defaultComputerStrategy,
) {
  return shouldAutomatedUseSuckerPunch(game, pendingTurn, computerPlayerIndex, strategy);
}

function shouldAutomatedUseSuckerPunch(
  game: GameState,
  pendingTurn: LocalPendingTurn,
  automatedPlayerIndex: number,
  strategy: ComputerStrategyConfig,
) {
  const computer = game.players[automatedPlayerIndex];
  if (!computer || computer.suckerTokens < suckerTokenCosts.suckerPunch) {
    return false;
  }

  const opponent = game.players[pendingTurn.scorerIndex];
  const playerScore = opponent ? totalScore(opponent.scorecard) : 0;
  const computerScore = totalScore(computer.scorecard);
  const scorer = game.players[pendingTurn.scorerIndex];
  const scoredCategories = scorer.scorecard
    ? scoreCategories.filter((category) => scorer.scorecard[category] !== null).length
    : 0;
  const tokenBalanceAfterPunch = computer.suckerTokens - suckerTokenCosts.suckerPunch;
  const canKeepBlockerReserve = tokenBalanceAfterPunch >= strategy.suckerPunchReserveTokens;
  const isPremiumTurn = pendingTurn.hadSuckerBonus || (pendingTurn.category === 'sucker' && pendingTurn.score >= strategy.suckerPunchMinScore);
  const isLateComebackSwing =
    scoredCategories >= strategy.suckerPunchComebackMinCategories &&
    playerScore > computerScore &&
    pendingTurn.score >= strategy.suckerPunchComebackMinScore;

  return (isPremiumTurn || isLateComebackSwing) && (canKeepBlockerReserve || pendingTurn.hadSuckerBonus);
}

export function shouldComputerUseSuckerBlocker(game: GameState, pendingTurn: LocalPendingTurn) {
  return shouldAutomatedUseSuckerBlocker(game, pendingTurn, computerPlayerIndex, defaultComputerStrategy);
}

function shouldAutomatedUseSuckerBlocker(
  game: GameState,
  pendingTurn: LocalPendingTurn,
  automatedPlayerIndex: number,
  strategy: ComputerStrategyConfig,
) {
  const computer = game.players[automatedPlayerIndex];
  if (!computer || computer.suckerTokens < suckerTokenCosts.suckerBlocker) {
    return false;
  }

  return (
    pendingTurn.score >= strategy.suckerBlockerMinScore ||
    pendingTurn.category === 'sucker' ||
    pendingTurn.category === 'largeStraight' ||
    pendingTurn.hadSuckerBonus
  );
}

function shouldComputerStopRolling(
  game: GameState,
  automatedPlayerIndex: number,
  choice: { category: ScoreCategory; priority: number; score: number },
  strategy: ComputerStrategyConfig,
) {
  if (choice.category === 'sucker' && choice.score >= 50) {
    return true;
  }
  if (choice.category === 'largeStraight' && choice.score >= 40) {
    return true;
  }
  if (choice.score >= 50) {
    return true;
  }

  if (
    choice.category === 'smallStraight' &&
    game.players[automatedPlayerIndex].scorecard.largeStraight === null &&
    scoreCategoryForScorecard(game.dice, 'largeStraight', game.players[automatedPlayerIndex].scorecard) < 40
  ) {
    return game.rollNumber >= maxAvailableRolls(game);
  }

  return game.rollNumber >= 3 && choice.score >= strategy.stopScoreThreshold;
}

function shouldComputerBuyExtraRoll(
  game: GameState,
  automatedPlayerIndex: number,
  choice: { category: ScoreCategory; priority: number; score: number },
  extraRollsBought: number,
  strategy: ComputerStrategyConfig,
) {
  const computer = game.players[automatedPlayerIndex];
  if (
    game.rollNumber < maxAvailableRolls(game) ||
    !computer ||
    computer.suckerTokens < suckerTokenCosts.extraRoll ||
    extraRollsBought >= 2
  ) {
    return false;
  }

  const maxMatch = maxMatchingDice(game.dice);
  if (maxMatch >= 4 && computer.scorecard.sucker === null) {
    return true;
  }

  return extraRollsBought === 0 && computer.suckerTokens > suckerTokenCosts.mulligan && choice.score < strategy.extraRollMaxScore;
}

function shouldComputerUseMulligan(
  game: GameState,
  automatedPlayerIndex: number,
  choice: { category: ScoreCategory; priority: number; score: number },
  mulligansUsed: number,
  strategy: ComputerStrategyConfig,
) {
  const computer = game.players[automatedPlayerIndex];
  if (!computer || computer.suckerTokens < suckerTokenCosts.mulligan || mulligansUsed > 0) {
    return false;
  }

  return availableCategories(computer.scorecard).length > 5 && choice.score <= strategy.mulliganMaxScore;
}

function chooseComputerHeldDice(
  game: GameState,
  automatedPlayerIndex: number,
  strategy: ComputerStrategyConfig,
): GameState['held'] {
  const computer = game.players[automatedPlayerIndex];
  const scorecard = computer.scorecard;
  const dice = game.dice;
  const openCategories = availableCategories(scorecard);

  if (openCategories.includes('largeStraight')) {
    const largeStraightHold = bestStraightHold(dice, 5);
    if (countHeld(largeStraightHold) >= 4) {
      return largeStraightHold;
    }
  }

  if (openCategories.includes('smallStraight')) {
    const smallStraightHold = bestStraightHold(dice, 4);
    if (countHeld(smallStraightHold) >= 3) {
      return smallStraightHold;
    }
  }

  if (openCategories.includes('fullHouse')) {
    const fullHouseHold = bestFullHouseHold(dice);
    if (countHeld(fullHouseHold) >= 3) {
      return fullHouseHold;
    }
  }

  const faceToChase = bestFaceToChase(dice, scorecard, strategy);
  return dice.map((die) => die === faceToChase) as GameState['held'];
}

function bestFaceToChase(
  dice: GameState['dice'],
  scorecard: GameState['players'][number]['scorecard'],
  strategy: ComputerStrategyConfig,
) {
  const counts = countDice(dice);
  return dice.reduce((best, die) => {
    const bestScore = faceChaseValue(best, counts[best], scorecard, strategy);
    const nextScore = faceChaseValue(die, counts[die], scorecard, strategy);
    return nextScore > bestScore ? die : best;
  }, dice[0]);
}

function faceChaseValue(
  face: DieValue,
  count: number,
  scorecard: GameState['players'][number]['scorecard'],
  strategy: ComputerStrategyConfig,
) {
  const upperCategory = upperCategoryForFace(face);
  const upperOpen = scorecard[upperCategory] === null;
  const upperValue = upperOpen
    ? face * Math.min(4, count + 1) * (upperBonusPressure(scorecard) ? strategy.upperPressureHoldMultiplier : 1)
    : 0;
  const kindValue =
    (scorecard.sucker === null ? 18 : 0) +
    (scorecard.fourOfAKind === null ? 8 : 0) +
    (scorecard.threeOfAKind === null ? 4 : 0);
  return count * 10 + face * 0.2 + upperValue + (count >= 2 ? kindValue : 0);
}

function bestStraightHold(dice: GameState['dice'], length: 4 | 5): GameState['held'] {
  const runs = length === 4 ? straightRuns.small : straightRuns.large;
  return runs
    .map((run) => holdUniqueFaces(dice, run))
    .sort((left, right) => countHeld(right) - countHeld(left))[0];
}

function bestFullHouseHold(dice: GameState['dice']): GameState['held'] {
  const counts = countDice(dice);
  const keepFaces = Object.entries(counts)
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([face]) => Number(face) as DieValue);

  if (keepFaces.length === 0) {
    return [false, false, false, false, false];
  }

  return dice.map((die) => keepFaces.includes(die)) as GameState['held'];
}

function holdUniqueFaces(dice: GameState['dice'], faces: readonly DieValue[]): GameState['held'] {
  const heldFaces = new Set<DieValue>();
  return dice.map((die) => {
    if (!faces.includes(die) || heldFaces.has(die)) {
      return false;
    }

    heldFaces.add(die);
    return true;
  }) as GameState['held'];
}

function countHeld(held: GameState['held']) {
  return held.filter(Boolean).length;
}

function maxMatchingDice(dice: GameState['dice']) {
  return Math.max(...Object.values(countDice(dice)));
}

function countDice(dice: GameState['dice']): Record<DieValue, number> {
  return dice.reduce(
    (nextCounts, die) => {
      nextCounts[die] += 1;
      return nextCounts;
    },
    { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } as Record<DieValue, number>,
  );
}

const upperCategories = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const;

const straightRuns = {
  small: [
    [1, 2, 3, 4],
    [2, 3, 4, 5],
    [3, 4, 5, 6],
  ],
  large: [
    [1, 2, 3, 4, 5],
    [2, 3, 4, 5, 6],
  ],
} as const satisfies Record<string, readonly (readonly DieValue[])[]>;

function isUpperCategory(category: ScoreCategory): category is (typeof upperCategories)[number] {
  return upperCategories.includes(category as (typeof upperCategories)[number]);
}

function upperCategoryForFace(face: DieValue): (typeof upperCategories)[number] {
  return upperCategories[face - 1];
}

function upperCategoryTarget(category: (typeof upperCategories)[number]) {
  return (upperCategories.indexOf(category) + 1) * 3;
}
