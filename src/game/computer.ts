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

export function playComputerTurn(game: GameState, pendingTurn: LocalPendingTurn | null = null): ComputerTurnResult {
  if (game.currentPlayerIndex !== computerPlayerIndex || game.phase === 'complete') {
    return { game, pendingTurn };
  }

  if (pendingTurn?.status === 'submitted' && pendingTurn.responderIndex === computerPlayerIndex) {
    if (shouldComputerUseSuckerPunch(game, pendingTurn)) {
      const punched = applyLocalSuckerPunch(game, pendingTurn, computerPlayerIndex);
      return {
        game: punched.game,
        message: 'Computer used Sucker Punch. Block it or replay the turn.',
        pendingTurn: punched.pendingTurn,
      };
    }

    pendingTurn = null;
  }

  if (pendingTurn?.status === 'punched' && pendingTurn.scorerIndex === computerPlayerIndex) {
    if (shouldComputerUseSuckerBlocker(game, pendingTurn)) {
      return {
        game: applyLocalSuckerBlocker(game, pendingTurn, computerPlayerIndex),
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
      nextGame = rollCurrentDice(nextGame);
      const choice = getBestComputerCategoryChoice(nextGame.dice, nextGame.players[computerPlayerIndex].scorecard);
      if (shouldComputerStopRolling(nextGame, choice)) {
        break;
      }

      const faceToChase = mostCommonDie(nextGame.dice);
      nextGame = {
        ...nextGame,
        held: nextGame.dice.map((die) => die === faceToChase) as typeof game.held,
      };
    }

    const computer = nextGame.players[computerPlayerIndex];
    const choice = getBestComputerCategoryChoice(nextGame.dice, computer.scorecard);

    if (shouldComputerUseMulligan(nextGame, choice, mulligansUsed)) {
      nextGame = mulliganCurrentTurn(nextGame);
      mulligansUsed += 1;
      continue;
    }

    if (shouldComputerBuyExtraRoll(nextGame, choice, extraRollsBought)) {
      nextGame = purchaseExtraRoll(nextGame);
      extraRollsBought += 1;
      continue;
    }

    break;
  }

  const category = chooseComputerCategory(nextGame.dice, nextGame.players[computerPlayerIndex].scorecard);
  return scoreLocalTurn(nextGame, category);
}

function chooseComputerCategory(dice: GameState['dice'], scorecard: GameState['players'][number]['scorecard']) {
  return getBestComputerCategoryChoice(dice, scorecard).category;
}

function getBestComputerCategoryChoice(dice: GameState['dice'], scorecard: GameState['players'][number]['scorecard']) {
  return availableCategories(scorecard)
    .map((category) => ({
      category,
      score: scoreCategoryForScorecard(dice, category, scorecard),
      priority: computerCategoryPriority(category),
    }))
    .sort((left, right) => right.score - left.score || right.priority - left.priority)[0];
}

function computerCategoryPriority(category: ScoreCategory) {
  return scoreCategories.indexOf(category);
}

function shouldComputerUseSuckerPunch(game: GameState, pendingTurn: LocalPendingTurn) {
  const computer = game.players[computerPlayerIndex];
  if (!computer || computer.suckerTokens < suckerTokenCosts.suckerPunch) {
    return false;
  }

  const playerScore = totalScore(game.players[0].scorecard);
  const computerScore = totalScore(computer.scorecard);
  return (
    pendingTurn.score >= 35 ||
    pendingTurn.category === 'sucker' ||
    pendingTurn.category === 'largeStraight' ||
    pendingTurn.hadSuckerBonus ||
    (pendingTurn.score >= 25 && playerScore >= computerScore)
  );
}

export function shouldComputerUseSuckerBlocker(game: GameState, pendingTurn: LocalPendingTurn) {
  const computer = game.players[computerPlayerIndex];
  if (!computer || computer.suckerTokens < suckerTokenCosts.suckerBlocker) {
    return false;
  }

  return (
    pendingTurn.score >= 25 ||
    pendingTurn.category === 'sucker' ||
    pendingTurn.category === 'largeStraight' ||
    pendingTurn.category === 'fullHouse' ||
    pendingTurn.hadSuckerBonus
  );
}

function shouldComputerStopRolling(
  game: GameState,
  choice: { category: ScoreCategory; priority: number; score: number },
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

  return game.rollNumber >= 2 && choice.score >= 30;
}

function shouldComputerBuyExtraRoll(
  game: GameState,
  choice: { category: ScoreCategory; priority: number; score: number },
  extraRollsBought: number,
) {
  const computer = game.players[computerPlayerIndex];
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

  return extraRollsBought === 0 && computer.suckerTokens > suckerTokenCosts.mulligan && choice.score < 18;
}

function shouldComputerUseMulligan(
  game: GameState,
  choice: { category: ScoreCategory; priority: number; score: number },
  mulligansUsed: number,
) {
  const computer = game.players[computerPlayerIndex];
  if (!computer || computer.suckerTokens < suckerTokenCosts.mulligan || mulligansUsed > 0) {
    return false;
  }

  return availableCategories(computer.scorecard).length > 5 && choice.score <= 8;
}

function mostCommonDie(dice: GameState['dice']) {
  const counts = dice.reduce(
    (nextCounts, die) => {
      nextCounts[die] += 1;
      return nextCounts;
    },
    { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } as Record<DieValue, number>,
  );

  return dice.reduce(
    (best, die) => (counts[die] > counts[best] || (counts[die] === counts[best] && die > best) ? die : best),
    dice[0],
  );
}

function maxMatchingDice(dice: GameState['dice']) {
  const counts = dice.reduce(
    (nextCounts, die) => {
      nextCounts[die] += 1;
      return nextCounts;
    },
    { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } as Record<DieValue, number>,
  );

  return Math.max(...Object.values(counts));
}
