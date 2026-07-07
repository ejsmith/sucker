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
  startingSuckerTokens,
  scratchScoreBox,
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

export type ComputerCategoryTrace = {
  category: ScoreCategory;
  priority: number;
  score: number;
  value: number;
};

export type ComputerFinalAction = { category: ScoreCategory; type: 'score' | 'scratch' };
export type ComputerTurnDecisionAction = ComputerFinalAction | { type: 'extraRoll' } | { type: 'mulligan' };

export type ComputerDecisionTrace = {
  availableCategoryCount: number;
  bestCategory: ComputerCategoryTrace | null;
  dice: GameState['dice'];
  extraRollsBought: number;
  finalAction: ComputerFinalAction | null;
  game: GameState;
  held: GameState['held'] | null;
  maxRolls: number;
  mulligansUsed: number;
  openCategories: ScoreCategory[];
  playerScore: number;
  rankedCategories: ComputerCategoryTrace[];
  rollNumber: number;
  scorecard: GameState['players'][number]['scorecard'] | null;
  shouldBuyExtraRoll: boolean;
  shouldMulligan: boolean;
  shouldStopRolling: boolean;
  stage: 'after_roll' | 'decision';
  suckerTokens: number;
};

export type ComputerDecisionTraceContext = {
  decisionAction?: ComputerTurnDecisionAction;
  extraRollsBought?: number;
  mulligansUsed?: number;
  stage?: ComputerDecisionTrace['stage'];
};

export type ComputerDecisionTraceHandler = (trace: ComputerDecisionTrace) => void;

export type ComputerStrategyConfig = {
  chanceEarlyPenalty: number;
  decisionRolloutUseCommonRandomFutures: boolean;
  extraRollMaxPurchases: number;
  extraRollMaxScore: number;
  extraRollMinTokens: number;
  extraRollReserveTokens: number;
  extraRollSuckerChaseMaxPurchases: number;
  finalActionRolloutOpenCategoryMax: number;
  finalActionRolloutSimulations: number;
  faceChaseCountWeight: number;
  faceChaseFourOfAKindValue: number;
  faceChasePipWeight: number;
  faceChaseSuckerValue: number;
  faceChaseThreeOfAKindValue: number;
  holdRolloutRollNumberMax: number;
  holdRolloutSimulations: number;
  holdRolloutTokenValue: number;
  holdRolloutUseActualScoreDelta: boolean;
  madeCategoryBonuses: Partial<Record<ScoreCategory, number>>;
  mulliganMaxScore: number;
  opportunityCostChance: number;
  opportunityCostFourOfAKind: number;
  opportunityCostFullHouse: number;
  opportunityCostLargeStraight: number;
  opportunityCostSmallStraight: number;
  opportunityCostSucker: number;
  opportunityCostThreeOfAKind: number;
  suckerBlockerMinScore: number;
  suckerPunchComebackMinCategories: number;
  suckerPunchComebackMinScore: number;
  suckerPunchMinScore: number;
  suckerPunchReserveTokens: number;
  suckerPunchUnblockableMinScore: number;
  suckerDealBeforeTokenSpending: boolean;
  suckerDealChanceMaxScore: number;
  suckerDealMaxSacrificeScore: number;
  suckerDealMaxTokens: number;
  suckerDealMinOpenCategories: number;
  stopScoreThreshold: number;
  suckerCategoryBonus: number;
  turnDecisionRolloutIncludesExtraRoll: boolean;
  turnDecisionRolloutIncludesMulligan: boolean;
  turnDecisionRolloutOpenCategoryMax: number;
  turnDecisionRolloutSimulations: number;
  upperPressureHoldMultiplier: number;
  upperPressureScratchCostBonus: number;
  upperShortfallPenalty: number;
};

export const defaultComputerStrategy: ComputerStrategyConfig = {
  chanceEarlyPenalty: 8,
  decisionRolloutUseCommonRandomFutures: true,
  extraRollMaxPurchases: 3,
  extraRollMaxScore: 20,
  extraRollMinTokens: 4,
  extraRollReserveTokens: 1,
  extraRollSuckerChaseMaxPurchases: 0,
  finalActionRolloutOpenCategoryMax: 2,
  finalActionRolloutSimulations: 12,
  faceChaseCountWeight: 10,
  faceChaseFourOfAKindValue: 8,
  faceChasePipWeight: 0.2,
  faceChaseSuckerValue: 18,
  faceChaseThreeOfAKindValue: 4,
  holdRolloutRollNumberMax: 1,
  holdRolloutSimulations: 48,
  holdRolloutTokenValue: 2,
  holdRolloutUseActualScoreDelta: false,
  madeCategoryBonuses: {
    fourOfAKind: 4,
    fullHouse: 6,
    largeStraight: 10,
    smallStraight: 5,
    threeOfAKind: 1,
  },
  mulliganMaxScore: 6,
  opportunityCostChance: 18,
  opportunityCostFourOfAKind: 24,
  opportunityCostFullHouse: 23,
  opportunityCostLargeStraight: 32,
  opportunityCostSmallStraight: 20,
  opportunityCostSucker: 45,
  opportunityCostThreeOfAKind: 18,
  suckerBlockerMinScore: 20,
  suckerPunchComebackMinCategories: 8,
  suckerPunchComebackMinScore: 30,
  suckerPunchMinScore: 50,
  suckerPunchReserveTokens: 0,
  suckerPunchUnblockableMinScore: 999,
  suckerDealBeforeTokenSpending: true,
  suckerDealChanceMaxScore: 20,
  suckerDealMaxSacrificeScore: 3,
  suckerDealMaxTokens: startingSuckerTokens - 1,
  suckerDealMinOpenCategories: 8,
  stopScoreThreshold: 35,
  suckerCategoryBonus: 8,
  turnDecisionRolloutIncludesExtraRoll: true,
  turnDecisionRolloutIncludesMulligan: true,
  turnDecisionRolloutOpenCategoryMax: 0,
  turnDecisionRolloutSimulations: 0,
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

export function scratchLocalTurn(game: GameState, category: ScoreCategory): ComputerTurnResult {
  const scorerIndex = game.currentPlayerIndex;
  const nextGame = scratchScoreBox(game, category);

  return {
    game: nextGame,
    pendingTurn: null,
    scoreAnimation: {
      category,
      dice: game.dice,
      hadSuckerBonus: false,
      score: 0,
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
  onTrace?: ComputerDecisionTraceHandler,
): ComputerTurnResult {
  return playAutomatedTurn(game, computerPlayerIndex, pendingTurn, random, strategy, onTrace);
}

export function playAutomatedTurn(
  game: GameState,
  automatedPlayerIndex: number,
  pendingTurn: LocalPendingTurn | null = null,
  random: () => number = Math.random,
  strategy: ComputerStrategyConfig = defaultComputerStrategy,
  onTrace?: ComputerDecisionTraceHandler,
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

  if (availableCategories(game.players[automatedPlayerIndex].scorecard).length === 0) {
    return { game, pendingTurn: null };
  }

  let nextGame = {
    ...game,
    held: [false, false, false, false, false] as typeof game.held,
  };
  let mulligansUsed = 0;
  let extraRollsBought = 0;
  let finalAction: ComputerFinalAction | null = null;

  while (true) {
    while (nextGame.rollNumber < maxAvailableRolls(nextGame)) {
      nextGame = rollCurrentDice(nextGame, random);
      if (onTrace) {
        onTrace(
          traceComputerDecision(nextGame, automatedPlayerIndex, strategy, {
            extraRollsBought,
            mulligansUsed,
            stage: 'after_roll',
          }),
        );
      }
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
    const decisionAction = chooseComputerTurnDecisionAction(
      nextGame,
      automatedPlayerIndex,
      choice,
      extraRollsBought,
      mulligansUsed,
      strategy,
    );
    if (onTrace) {
      onTrace(
        traceComputerDecision(nextGame, automatedPlayerIndex, strategy, {
          decisionAction,
          extraRollsBought,
          mulligansUsed,
          stage: 'decision',
        }),
      );
    }

    if (decisionAction.type === 'score' || decisionAction.type === 'scratch') {
      finalAction = decisionAction;
      break;
    }

    if (decisionAction.type === 'mulligan') {
      nextGame = mulliganCurrentTurn(nextGame);
      mulligansUsed += 1;
      continue;
    }

    if (decisionAction.type === 'extraRoll') {
      nextGame = purchaseExtraRoll(nextGame);
      extraRollsBought += 1;
      continue;
    }
  }

  const action = finalAction ?? chooseComputerFinalAction(nextGame, automatedPlayerIndex, strategy);
  return action.type === 'scratch'
    ? scratchLocalTurn(nextGame, action.category)
    : scoreLocalTurn(nextGame, action.category);
}

export function traceComputerDecision(
  game: GameState,
  automatedPlayerIndex = computerPlayerIndex,
  strategy: ComputerStrategyConfig = defaultComputerStrategy,
  context: ComputerDecisionTraceContext = {},
): ComputerDecisionTrace {
  const player = game.players[automatedPlayerIndex];
  const rankedCategories = player ? getRankedComputerCategoryChoices(game.dice, player.scorecard, strategy) : [];
  const bestCategory = rankedCategories[0] ?? null;
  const openCategories = player ? availableCategories(player.scorecard) : [];
  const maxRolls = maxAvailableRolls(game);
  const mulligansUsed = context.mulligansUsed ?? 0;
  const extraRollsBought = context.extraRollsBought ?? 0;
  const decisionAction = context.decisionAction;
  const held =
    player && game.rollNumber > 0 && game.rollNumber < maxRolls
      ? chooseComputerHeldDice(game, automatedPlayerIndex, strategy)
      : null;
  const shouldStopRolling =
    Boolean(player && bestCategory && game.rollNumber > 0) &&
    shouldComputerStopRolling(game, automatedPlayerIndex, bestCategory, strategy);
  const heuristicShouldBuyExtraRoll = Boolean(
    player && bestCategory && shouldComputerBuyExtraRoll(game, automatedPlayerIndex, bestCategory, extraRollsBought, strategy),
  );
  const heuristicShouldMulligan = Boolean(
    player && bestCategory && shouldComputerUseMulligan(game, automatedPlayerIndex, bestCategory, mulligansUsed, strategy),
  );
  const shouldBuyExtraRoll = decisionAction ? decisionAction.type === 'extraRoll' : heuristicShouldBuyExtraRoll;
  const shouldMulligan = decisionAction ? decisionAction.type === 'mulligan' : heuristicShouldMulligan;
  const finalAction =
    decisionAction?.type === 'score' || decisionAction?.type === 'scratch'
      ? decisionAction
      : player && bestCategory && game.rollNumber > 0 && !shouldBuyExtraRoll && !shouldMulligan
        ? chooseComputerFinalAction(game, automatedPlayerIndex, strategy)
        : null;

  return {
    availableCategoryCount: player ? availableCategories(player.scorecard).length : 0,
    bestCategory,
    dice: game.dice,
    extraRollsBought,
    finalAction,
    game,
    held,
    maxRolls,
    mulligansUsed,
    openCategories,
    playerScore: player ? totalScore(player.scorecard) : 0,
    rankedCategories,
    rollNumber: game.rollNumber,
    scorecard: player ? { ...player.scorecard } : null,
    shouldBuyExtraRoll,
    shouldMulligan,
    shouldStopRolling,
    stage: context.stage ?? 'decision',
    suckerTokens: player?.suckerTokens ?? 0,
  };
}

function chooseComputerTurnDecisionAction(
  game: GameState,
  automatedPlayerIndex: number,
  choice: ComputerCategoryChoice,
  extraRollsBought: number,
  mulligansUsed: number,
  strategy: ComputerStrategyConfig,
): ComputerTurnDecisionAction {
  const heuristicAction = chooseHeuristicComputerTurnDecisionAction(
    game,
    automatedPlayerIndex,
    choice,
    extraRollsBought,
    mulligansUsed,
    strategy,
  );

  if (!shouldUseTurnDecisionRollout(game, automatedPlayerIndex, strategy)) {
    return heuristicAction;
  }

  return chooseRolloutTurnDecisionAction(game, automatedPlayerIndex, strategy, heuristicAction, mulligansUsed);
}

function chooseHeuristicComputerTurnDecisionAction(
  game: GameState,
  automatedPlayerIndex: number,
  choice: ComputerCategoryChoice,
  extraRollsBought: number,
  mulligansUsed: number,
  strategy: ComputerStrategyConfig,
): ComputerTurnDecisionAction {
  const suckerDealCategory = chooseSuckerDealCategory(game, automatedPlayerIndex, choice, strategy);
  if (strategy.suckerDealBeforeTokenSpending && suckerDealCategory) {
    return { category: suckerDealCategory, type: 'scratch' };
  }

  if (shouldComputerUseMulligan(game, automatedPlayerIndex, choice, mulligansUsed, strategy)) {
    return { type: 'mulligan' };
  }

  if (shouldComputerBuyExtraRoll(game, automatedPlayerIndex, choice, extraRollsBought, strategy)) {
    return { type: 'extraRoll' };
  }

  if (suckerDealCategory) {
    return { category: suckerDealCategory, type: 'scratch' };
  }

  return chooseComputerFinalAction(game, automatedPlayerIndex, strategy);
}

function shouldUseTurnDecisionRollout(game: GameState, automatedPlayerIndex: number, strategy: ComputerStrategyConfig) {
  return (
    strategy.turnDecisionRolloutSimulations > 0 &&
    strategy.turnDecisionRolloutOpenCategoryMax > 0 &&
    game.phase !== 'complete' &&
    game.rollNumber > 0 &&
    availableCategories(game.players[automatedPlayerIndex].scorecard).length <=
      strategy.turnDecisionRolloutOpenCategoryMax
  );
}

function chooseRolloutTurnDecisionAction(
  game: GameState,
  automatedPlayerIndex: number,
  strategy: ComputerStrategyConfig,
  heuristicAction: ComputerTurnDecisionAction,
  mulligansUsed: number,
): ComputerTurnDecisionAction {
  const candidates = getTurnDecisionActionCandidates(game, automatedPlayerIndex, heuristicAction, mulligansUsed, strategy);
  if (candidates.length <= 1) {
    return heuristicAction;
  }

  return candidates
    .map((action) => ({
      action,
      result: measureTurnDecisionRollout(
        game,
        automatedPlayerIndex,
        action,
        strategy,
        Math.max(1, Math.floor(strategy.turnDecisionRolloutSimulations)),
      ),
    }))
    .sort(
      (left, right) =>
        right.result.winRate - left.result.winRate ||
        right.result.averageMargin - left.result.averageMargin ||
        right.result.averageScore - left.result.averageScore ||
        turnDecisionTieBreakScore(right.action, game, automatedPlayerIndex, strategy) -
          turnDecisionTieBreakScore(left.action, game, automatedPlayerIndex, strategy),
    )[0].action;
}

function getTurnDecisionActionCandidates(
  game: GameState,
  automatedPlayerIndex: number,
  heuristicAction: ComputerTurnDecisionAction,
  mulligansUsed: number,
  strategy: ComputerStrategyConfig,
): ComputerTurnDecisionAction[] {
  const byKey = new Map<string, ComputerTurnDecisionAction>();
  const addAction = (action: ComputerTurnDecisionAction) => {
    byKey.set(turnDecisionActionKey(action), action);
  };

  addAction(heuristicAction);
  for (const action of getFinalActionCandidates(
    game,
    automatedPlayerIndex,
    chooseHeuristicComputerFinalAction(game, automatedPlayerIndex, strategy),
  )) {
    addAction(action);
  }

  if (strategy.turnDecisionRolloutIncludesExtraRoll && canLegallyBuyExtraRoll(game, automatedPlayerIndex)) {
    addAction({ type: 'extraRoll' });
  }

  if (strategy.turnDecisionRolloutIncludesMulligan && canLegallyUseMulligan(game, automatedPlayerIndex, mulligansUsed)) {
    addAction({ type: 'mulligan' });
  }

  return [...byKey.values()];
}

function turnDecisionActionKey(action: ComputerTurnDecisionAction) {
  return action.type === 'score' || action.type === 'scratch' ? `${action.type}:${action.category}` : action.type;
}

function canLegallyBuyExtraRoll(game: GameState, automatedPlayerIndex: number) {
  const player = game.players[automatedPlayerIndex];
  return (
    game.phase !== 'complete' &&
    game.rollNumber >= maxAvailableRolls(game) &&
    Boolean(player) &&
    player.suckerTokens >= suckerTokenCosts.extraRoll
  );
}

function canLegallyUseMulligan(game: GameState, automatedPlayerIndex: number, mulligansUsed: number) {
  const player = game.players[automatedPlayerIndex];
  return (
    game.phase !== 'complete' &&
    game.rollNumber > 0 &&
    mulligansUsed === 0 &&
    Boolean(player) &&
    player.suckerTokens >= suckerTokenCosts.mulligan
  );
}

function chooseComputerFinalAction(
  game: GameState,
  automatedPlayerIndex: number,
  strategy: ComputerStrategyConfig,
): ComputerFinalAction {
  const heuristicAction = chooseHeuristicComputerFinalAction(game, automatedPlayerIndex, strategy);

  if (!shouldUseFinalActionRollout(game, automatedPlayerIndex, strategy)) {
    return heuristicAction;
  }

  return chooseRolloutFinalAction(game, automatedPlayerIndex, strategy, heuristicAction);
}

function chooseHeuristicComputerFinalAction(
  game: GameState,
  automatedPlayerIndex: number,
  strategy: ComputerStrategyConfig,
): ComputerFinalAction {
  const scorecard = game.players[automatedPlayerIndex].scorecard;
  const choice = getBestComputerCategoryChoice(game.dice, scorecard, strategy);
  const suckerDealCategory = chooseSuckerDealCategory(game, automatedPlayerIndex, choice, strategy);

  if (suckerDealCategory) {
    return { category: suckerDealCategory, type: 'scratch' };
  }

  if (choice.score === 0) {
    return { category: choice.category, type: 'scratch' };
  }

  return { category: choice.category, type: 'score' };
}

function shouldUseFinalActionRollout(game: GameState, automatedPlayerIndex: number, strategy: ComputerStrategyConfig) {
  return (
    strategy.finalActionRolloutSimulations > 0 &&
    strategy.finalActionRolloutOpenCategoryMax > 0 &&
    game.phase !== 'complete' &&
    game.rollNumber > 0 &&
    availableCategories(game.players[automatedPlayerIndex].scorecard).length <=
      strategy.finalActionRolloutOpenCategoryMax
  );
}

function chooseRolloutFinalAction(
  game: GameState,
  automatedPlayerIndex: number,
  strategy: ComputerStrategyConfig,
  heuristicAction: ComputerFinalAction,
): ComputerFinalAction {
  const candidates = getFinalActionCandidates(game, automatedPlayerIndex, heuristicAction);
  if (candidates.length <= 1) {
    return heuristicAction;
  }

  return candidates
    .map((action) => ({
      action,
      result: measureFinalActionRollout(game, automatedPlayerIndex, action, strategy),
    }))
    .sort(
      (left, right) =>
        right.result.winRate - left.result.winRate ||
        right.result.averageMargin - left.result.averageMargin ||
        right.result.averageScore - left.result.averageScore ||
        finalActionTieBreakScore(right.action, game, automatedPlayerIndex, strategy) -
          finalActionTieBreakScore(left.action, game, automatedPlayerIndex, strategy),
    )[0].action;
}

function getFinalActionCandidates(
  game: GameState,
  automatedPlayerIndex: number,
  heuristicAction: ComputerFinalAction,
): ComputerFinalAction[] {
  const scorecard = game.players[automatedPlayerIndex].scorecard;
  const byKey = new Map<string, ComputerFinalAction>();
  const addAction = (action: ComputerFinalAction) => {
    if (scorecard[action.category] === null) {
      byKey.set(`${action.type}:${action.category}`, action);
    }
  };

  addAction(heuristicAction);
  for (const category of availableCategories(scorecard)) {
    addAction({ category, type: 'scratch' });
    if (scoreCategoryForScorecard(game.dice, category, scorecard) > 0) {
      addAction({ category, type: 'score' });
    }
  }

  return [...byKey.values()];
}

function measureFinalActionRollout(
  game: GameState,
  automatedPlayerIndex: number,
  action: ComputerFinalAction,
  strategy: ComputerStrategyConfig,
) {
  return measureTurnDecisionRollout(
    game,
    automatedPlayerIndex,
    action,
    strategy,
    Math.max(1, Math.floor(strategy.finalActionRolloutSimulations)),
  );
}

function measureTurnDecisionRollout(
  game: GameState,
  automatedPlayerIndex: number,
  action: ComputerTurnDecisionAction,
  strategy: ComputerStrategyConfig,
  simulationCount: number,
) {
  const simulationStrategy = {
    ...strategy,
    finalActionRolloutOpenCategoryMax: 0,
    finalActionRolloutSimulations: 0,
    holdRolloutRollNumberMax: 0,
    holdRolloutSimulations: 0,
    turnDecisionRolloutOpenCategoryMax: 0,
    turnDecisionRolloutSimulations: 0,
  };
  let wins = 0;
  let ties = 0;
  let scoreTotal = 0;
  let opponentScoreTotal = 0;

  for (let index = 0; index < simulationCount; index += 1) {
    const random = createRolloutRandom(
      rolloutSeedForDecisionAction(game, automatedPlayerIndex, action, index, strategy.decisionRolloutUseCommonRandomFutures),
    );
    const result = simulateTurnDecisionRollout(game, automatedPlayerIndex, action, simulationStrategy, random);
    scoreTotal += result.playerScore;
    opponentScoreTotal += result.opponentScore;

    if (result.playerScore > result.opponentScore) {
      wins += 1;
    } else if (result.playerScore === result.opponentScore) {
      ties += 1;
    }
  }

  const averageScore = scoreTotal / simulationCount;
  const averageOpponentScore = opponentScoreTotal / simulationCount;

  return {
    averageMargin: averageScore - averageOpponentScore,
    averageScore,
    winRate: (wins + ties * 0.5) / simulationCount,
  };
}

function simulateTurnDecisionRollout(
  game: GameState,
  automatedPlayerIndex: number,
  action: ComputerTurnDecisionAction,
  strategy: ComputerStrategyConfig,
  random: () => number,
) {
  const applied = applyTurnDecisionActionForRollout(game, action);
  let nextGame = applied.game;
  let pendingTurn = applied.pendingTurn;
  let guard = 0;

  while (nextGame.phase !== 'complete' && guard < 100) {
    if (!pendingTurn && availableCategories(nextGame.players[nextGame.currentPlayerIndex].scorecard).length === 0) {
      nextGame = advanceRolloutToNextOpenPlayer(nextGame);
      pendingTurn = null;
      guard += 1;
      continue;
    }

    const activePlayerIndex = nextGame.currentPlayerIndex;
    const result = playAutomatedTurn(nextGame, activePlayerIndex, pendingTurn, random, strategy);
    nextGame = result.game;
    pendingTurn = result.pendingTurn;
    guard += 1;
  }

  const opponentIndex = nextGame.players.findIndex((_player, index) => index !== automatedPlayerIndex);
  return {
    opponentScore: opponentIndex >= 0 ? totalScore(nextGame.players[opponentIndex].scorecard) : 0,
    playerScore: totalScore(nextGame.players[automatedPlayerIndex].scorecard),
  };
}

function advanceRolloutToNextOpenPlayer(game: GameState): GameState {
  const nextPlayerIndex = game.players.findIndex((player) => availableCategories(player.scorecard).length > 0);
  if (nextPlayerIndex < 0) {
    return {
      ...game,
      phase: 'complete',
    };
  }

  return {
    ...game,
    currentPlayerIndex: nextPlayerIndex,
    dice: [1, 1, 1, 1, 1],
    extraRollsAvailable: 0,
    held: [false, false, false, false, false],
    phase: 'rolling',
    rollNumber: 0,
  };
}

function applyTurnDecisionActionForRollout(game: GameState, action: ComputerTurnDecisionAction): ComputerTurnResult {
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

function finalActionTieBreakScore(
  action: ComputerFinalAction,
  game: GameState,
  automatedPlayerIndex: number,
  strategy: ComputerStrategyConfig,
) {
  if (action.type === 'scratch') {
    return -computerCategoryOpportunityCost(action.category, game.players[automatedPlayerIndex].scorecard, strategy);
  }

  return computerCategoryValue(game.dice, action.category, game.players[automatedPlayerIndex].scorecard, strategy);
}

function turnDecisionTieBreakScore(
  action: ComputerTurnDecisionAction,
  game: GameState,
  automatedPlayerIndex: number,
  strategy: ComputerStrategyConfig,
) {
  if (action.type === 'score' || action.type === 'scratch') {
    return finalActionTieBreakScore(action, game, automatedPlayerIndex, strategy);
  }

  return action.type === 'extraRoll' ? -suckerTokenCosts.extraRoll : -suckerTokenCosts.mulligan;
}

function rolloutSeedForDecisionAction(
  game: GameState,
  automatedPlayerIndex: number,
  action: ComputerTurnDecisionAction,
  iteration: number,
  useCommonRandomFutures: boolean,
) {
  let hash = 2166136261;
  hash = hashRolloutValue(hash, automatedPlayerIndex + 1);
  hash = hashRolloutValue(hash, game.currentPlayerIndex + 1);
  hash = hashRolloutValue(hash, game.rollNumber + 1);
  hash = hashRolloutValue(hash, game.extraRollsAvailable + 1);
  if (!useCommonRandomFutures) {
    hash = hashRolloutValue(
      hash,
      action.type === 'score' || action.type === 'scratch' ? scoreCategories.indexOf(action.category) + 1 : 0,
    );
    hash = hashRolloutValue(hash, rolloutActionTypeCode(action));
  }
  hash = hashRolloutValue(hash, iteration + 1);

  for (const die of game.dice) {
    hash = hashRolloutValue(hash, die);
  }

  for (const player of game.players) {
    hash = hashRolloutValue(hash, player.suckerTokens + 1);
    for (const category of scoreCategories) {
      hash = hashRolloutValue(hash, (player.scorecard[category] ?? -1) + 2);
    }
  }

  return hash >>> 0;
}

function rolloutActionTypeCode(action: ComputerTurnDecisionAction) {
  return (
    {
      extraRoll: 3,
      mulligan: 4,
      score: 1,
      scratch: 2,
    } satisfies Record<ComputerTurnDecisionAction['type'], number>
  )[action.type];
}

function hashRolloutValue(hash: number, value: number) {
  return Math.imul(hash ^ value, 16777619) >>> 0;
}

function createRolloutRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function chooseSuckerDealCategory(
  game: GameState,
  automatedPlayerIndex: number,
  choice: ComputerCategoryChoice,
  strategy: ComputerStrategyConfig,
) {
  const player = game.players[automatedPlayerIndex];
  const scorecard = game.players[automatedPlayerIndex].scorecard;
  if (
    choice.category !== 'chance' ||
    choice.score > strategy.suckerDealChanceMaxScore ||
    player.suckerTokens > strategy.suckerDealMaxTokens ||
    availableCategories(scorecard).length < strategy.suckerDealMinOpenCategories
  ) {
    return null;
  }

  return (
    suckerDealCategories
      .filter((category) => scorecard[category] === null)
      .map((category) => ({
        category,
        opportunityCost: computerCategoryOpportunityCost(category, scorecard, strategy),
        score: scoreCategoryForScorecard(game.dice, category, scorecard),
      }))
      .filter((candidate) => candidate.score <= strategy.suckerDealMaxSacrificeScore)
      .sort(
        (left, right) =>
          left.opportunityCost - right.opportunityCost ||
          left.score - right.score ||
          suckerDealCategories.indexOf(left.category) - suckerDealCategories.indexOf(right.category),
      )[0]?.category ?? null
  );
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
): ComputerCategoryChoice {
  return getRankedComputerCategoryChoices(dice, scorecard, strategy)[0];
}

function getRankedComputerCategoryChoices(
  dice: GameState['dice'],
  scorecard: GameState['players'][number]['scorecard'],
  strategy: ComputerStrategyConfig,
): ComputerCategoryChoice[] {
  return availableCategories(scorecard)
    .map((category) => ({
      category,
      score: scoreCategoryForScorecard(dice, category, scorecard),
      value: computerCategoryValue(dice, category, scorecard, strategy),
      priority: computerCategoryPriority(category),
    }))
    .sort((left, right) => right.value - left.value || right.score - left.score || right.priority - left.priority);
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
    return strategy.opportunityCostChance;
  }
  if (isUpperCategory(category)) {
    return upperBonusPressure(scorecard)
      ? upperCategoryTarget(category) + strategy.upperPressureScratchCostBonus
      : upperCategoryTarget(category);
  }

  return {
    threeOfAKind: strategy.opportunityCostThreeOfAKind,
    fourOfAKind: strategy.opportunityCostFourOfAKind,
    fullHouse: strategy.opportunityCostFullHouse,
    smallStraight: strategy.opportunityCostSmallStraight,
    largeStraight: strategy.opportunityCostLargeStraight,
    sucker: strategy.opportunityCostSucker,
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
  const scorerCanBlock = scorer.suckerTokens >= suckerTokenCosts.suckerBlocker;
  const isPremiumTurn =
    pendingTurn.hadSuckerBonus ||
    (pendingTurn.category === 'sucker' && pendingTurn.score >= strategy.suckerPunchMinScore);
  const isUnblockableHighValueTurn = !scorerCanBlock && pendingTurn.score >= strategy.suckerPunchUnblockableMinScore;
  const isLateComebackSwing =
    scoredCategories >= strategy.suckerPunchComebackMinCategories &&
    playerScore > computerScore &&
    pendingTurn.score >= strategy.suckerPunchComebackMinScore;

  return (
    (isPremiumTurn || isUnblockableHighValueTurn || isLateComebackSwing) &&
    (canKeepBlockerReserve || pendingTurn.hadSuckerBonus || isUnblockableHighValueTurn)
  );
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
  const tokenBalanceAfterExtraRoll = computer ? computer.suckerTokens - suckerTokenCosts.extraRoll : 0;
  if (
    game.rollNumber < maxAvailableRolls(game) ||
    !computer ||
    computer.suckerTokens < suckerTokenCosts.extraRoll ||
    tokenBalanceAfterExtraRoll < strategy.extraRollReserveTokens
  ) {
    return false;
  }

  const maxMatch = maxMatchingDice(game.dice);
  if (maxMatch >= 4 && computer.scorecard.sucker === null) {
    return extraRollsBought < strategy.extraRollSuckerChaseMaxPurchases;
  }

  return (
    extraRollsBought < strategy.extraRollMaxPurchases &&
    computer.suckerTokens >= strategy.extraRollMinTokens &&
    choice.score < strategy.extraRollMaxScore
  );
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
  const heuristicHeld = chooseHeuristicComputerHeldDice(game, automatedPlayerIndex, strategy);
  if (shouldKeepObviousHeuristicHold(game, automatedPlayerIndex, heuristicHeld)) {
    return heuristicHeld;
  }

  if (!shouldUseHoldRollout(game, automatedPlayerIndex, strategy)) {
    return heuristicHeld;
  }

  return chooseRolloutHeldDice(game, automatedPlayerIndex, strategy, heuristicHeld);
}

function shouldKeepObviousHeuristicHold(
  game: GameState,
  automatedPlayerIndex: number,
  heuristicHeld: GameState['held'],
) {
  const scorecard = game.players[automatedPlayerIndex]?.scorecard;
  if (!scorecard || scorecard.largeStraight !== null) {
    return false;
  }

  const largeStraightHold = bestStraightHold(game.dice, 5);
  return countHeld(largeStraightHold) >= 4 && heldDiceKey(heuristicHeld) === heldDiceKey(largeStraightHold);
}

function chooseHeuristicComputerHeldDice(
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

function shouldUseHoldRollout(game: GameState, automatedPlayerIndex: number, strategy: ComputerStrategyConfig) {
  return (
    strategy.holdRolloutSimulations > 0 &&
    strategy.holdRolloutRollNumberMax > 0 &&
    game.phase !== 'complete' &&
    game.rollNumber > 0 &&
    game.rollNumber < maxAvailableRolls(game) &&
    game.rollNumber <= strategy.holdRolloutRollNumberMax &&
    Boolean(game.players[automatedPlayerIndex])
  );
}

function chooseRolloutHeldDice(
  game: GameState,
  automatedPlayerIndex: number,
  strategy: ComputerStrategyConfig,
  heuristicHeld: GameState['held'],
): GameState['held'] {
  const candidates = getHeldDiceCandidates(game, automatedPlayerIndex, heuristicHeld);
  if (candidates.length <= 1) {
    return heuristicHeld;
  }

  const simulationCount = Math.max(1, Math.floor(strategy.holdRolloutSimulations));
  return candidates
    .map((held) => ({
      held,
      isHeuristic: heldDiceKey(held) === heldDiceKey(heuristicHeld),
      result: measureHeldDiceRollout(game, automatedPlayerIndex, held, strategy, simulationCount),
    }))
    .sort(
      (left, right) =>
        right.result.averageUtility - left.result.averageUtility ||
        Number(right.isHeuristic) - Number(left.isHeuristic) ||
        countHeld(right.held) - countHeld(left.held),
    )[0].held;
}

function getHeldDiceCandidates(
  game: GameState,
  automatedPlayerIndex: number,
  heuristicHeld: GameState['held'],
): GameState['held'][] {
  const dice = game.dice;
  const scorecard = game.players[automatedPlayerIndex].scorecard;
  const openCategories = availableCategories(scorecard);
  const byKey = new Map<string, GameState['held']>();
  const addHeld = (held: GameState['held']) => {
    byKey.set(heldDiceKey(held), held);
  };

  addHeld(heuristicHeld);
  addHeld([false, false, false, false, false]);

  for (const face of [1, 2, 3, 4, 5, 6] as const) {
    if (dice.includes(face)) {
      addHeld(dice.map((die) => die === face) as GameState['held']);
    }
  }

  if (openCategories.includes('largeStraight')) {
    for (const run of straightRuns.large) {
      addHeld(holdUniqueFaces(dice, run));
    }
  }

  if (openCategories.includes('smallStraight')) {
    for (const run of straightRuns.small) {
      addHeld(holdUniqueFaces(dice, run));
    }
  }

  if (openCategories.includes('fullHouse')) {
    addHeld(bestFullHouseHold(dice));
  }

  return [...byKey.values()];
}

function measureHeldDiceRollout(
  game: GameState,
  automatedPlayerIndex: number,
  held: GameState['held'],
  strategy: ComputerStrategyConfig,
  simulationCount: number,
) {
  const beforePlayer = game.players[automatedPlayerIndex];
  const beforeScore = totalScore(beforePlayer.scorecard);
  const beforeTokens = beforePlayer.suckerTokens;
  const simulationStrategy = {
    ...strategy,
    finalActionRolloutOpenCategoryMax: 0,
    finalActionRolloutSimulations: 0,
    holdRolloutRollNumberMax: 0,
    holdRolloutSimulations: 0,
    turnDecisionRolloutOpenCategoryMax: 0,
    turnDecisionRolloutSimulations: 0,
  };
  let utilityTotal = 0;
  let scoreDeltaTotal = 0;
  let tokenDeltaTotal = 0;

  for (let index = 0; index < simulationCount; index += 1) {
    const random = createRolloutRandom(rolloutSeedForHeldDice(game, automatedPlayerIndex, held, index));
    const result = simulateCurrentTurnFromHeldDice(
      game,
      automatedPlayerIndex,
      held,
      simulationStrategy,
      random,
    );
    const resultGame = result.game;
    const afterPlayer = resultGame.players[automatedPlayerIndex];
    const scoreDelta = totalScore(afterPlayer.scorecard) - beforeScore;
    const tokenDelta = afterPlayer.suckerTokens - beforeTokens;
    scoreDeltaTotal += scoreDelta;
    tokenDeltaTotal += tokenDelta;
    const scoreUtility = strategy.holdRolloutUseActualScoreDelta ? scoreDelta : (result.turnUtility ?? scoreDelta);
    utilityTotal += scoreUtility + tokenDelta * strategy.holdRolloutTokenValue;
  }

  return {
    averageScoreDelta: scoreDeltaTotal / simulationCount,
    averageTokenDelta: tokenDeltaTotal / simulationCount,
    averageUtility: utilityTotal / simulationCount,
  };
}

function simulateCurrentTurnFromHeldDice(
  game: GameState,
  automatedPlayerIndex: number,
  held: GameState['held'],
  strategy: ComputerStrategyConfig,
  random: () => number,
): { game: GameState; turnUtility: number | null } {
  let nextGame = {
    ...game,
    held,
  };
  let mulligansUsed = 0;
  let extraRollsBought = 0;
  let guard = 0;

  while (nextGame.phase !== 'complete' && guard < 20) {
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
    if (!computer || availableCategories(computer.scorecard).length === 0) {
      return { game: nextGame, turnUtility: null };
    }

    const choice = getBestComputerCategoryChoice(nextGame.dice, computer.scorecard, strategy);
    const action = chooseComputerTurnDecisionAction(
      nextGame,
      automatedPlayerIndex,
      choice,
      extraRollsBought,
      mulligansUsed,
      strategy,
    );

    if (action.type === 'score') {
      return {
        game: scoreLocalTurn(nextGame, action.category).game,
        turnUtility: finalActionUtility(action, nextGame, automatedPlayerIndex, strategy),
      };
    }

    if (action.type === 'scratch') {
      return {
        game: scratchLocalTurn(nextGame, action.category).game,
        turnUtility: finalActionUtility(action, nextGame, automatedPlayerIndex, strategy),
      };
    }

    if (action.type === 'mulligan') {
      nextGame = mulliganCurrentTurn(nextGame);
      mulligansUsed += 1;
      guard += 1;
      continue;
    }

    nextGame = purchaseExtraRoll(nextGame);
    extraRollsBought += 1;
    guard += 1;
  }

  return { game: nextGame, turnUtility: null };
}

function heldDiceKey(held: GameState['held']) {
  return held.map((value) => (value ? '1' : '0')).join('');
}

function finalActionUtility(
  action: ComputerFinalAction,
  game: GameState,
  automatedPlayerIndex: number,
  strategy: ComputerStrategyConfig,
) {
  const scorecard = game.players[automatedPlayerIndex].scorecard;
  if (action.type === 'scratch') {
    return -computerCategoryOpportunityCost(action.category, scorecard, strategy);
  }

  return computerCategoryValue(game.dice, action.category, scorecard, strategy);
}

function rolloutSeedForHeldDice(
  game: GameState,
  automatedPlayerIndex: number,
  _held: GameState['held'],
  iteration: number,
) {
  let hash = 2166136261;
  hash = hashRolloutValue(hash, automatedPlayerIndex + 1);
  hash = hashRolloutValue(hash, game.currentPlayerIndex + 1);
  hash = hashRolloutValue(hash, game.rollNumber + 1);
  hash = hashRolloutValue(hash, game.extraRollsAvailable + 1);
  hash = hashRolloutValue(hash, iteration + 1);

  for (const die of game.dice) {
    hash = hashRolloutValue(hash, die);
  }

  for (const player of game.players) {
    hash = hashRolloutValue(hash, player.suckerTokens + 1);
    for (const category of scoreCategories) {
      hash = hashRolloutValue(hash, (player.scorecard[category] ?? -1) + 2);
    }
  }

  return hash >>> 0;
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
    (scorecard.sucker === null ? strategy.faceChaseSuckerValue : 0) +
    (scorecard.fourOfAKind === null ? strategy.faceChaseFourOfAKindValue : 0) +
    (scorecard.threeOfAKind === null ? strategy.faceChaseThreeOfAKindValue : 0);
  return count * strategy.faceChaseCountWeight + face * strategy.faceChasePipWeight + upperValue + (count >= 2 ? kindValue : 0);
}

function bestStraightHold(dice: GameState['dice'], length: 4 | 5): GameState['held'] {
  const runs = length === 4 ? straightRuns.small : straightRuns.large;
  return runs.map((run) => holdUniqueFaces(dice, run)).sort((left, right) => countHeld(right) - countHeld(left))[0];
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
const suckerDealCategories = ['ones', 'twos', 'threes'] as const;

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
