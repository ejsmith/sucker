import { defaultComputerStrategy, type ComputerStrategyConfig } from './computer';
import {
  measureComputerHeadToHead,
  measureComputerStrategy,
  type ComputerHeadToHeadResult,
  type ComputerSimulationResult,
} from './computerSimulation';

export type ComputerStrategyCandidate = {
  name: string;
  strategy: ComputerStrategyConfig;
};

export type ComputerTournamentRound = {
  advanceCount: number;
  gameCount: number;
  seed: number;
};

export type ComputerTournamentResult = {
  candidates: ComputerStrategyCandidate[];
  rounds: ComputerTournamentRoundResult[];
  winner: ComputerTournamentScore;
};

export type ComputerTournamentRoundResult = {
  round: ComputerTournamentRound;
  scores: ComputerTournamentScore[];
};

export type ComputerTournamentScore = {
  candidate: ComputerStrategyCandidate;
  result: ComputerSimulationResult;
};

export type SuckerTokenTournamentResult = {
  candidates: ComputerStrategyCandidate[];
  rounds: SuckerTokenTournamentRoundResult[];
  winner: SuckerTokenTournamentScore;
};

export type SuckerTokenTournamentRoundResult = {
  round: ComputerTournamentRound;
  scores: SuckerTokenTournamentScore[];
};

export type SuckerTokenTournamentScore = {
  candidate: ComputerStrategyCandidate;
  result: ComputerHeadToHeadResult;
};

export function runComputerStrategyTournament({
  candidates = createComputerStrategyCandidates(),
  rounds = defaultTournamentRounds,
}: {
  candidates?: ComputerStrategyCandidate[];
  rounds?: ComputerTournamentRound[];
} = {}): ComputerTournamentResult {
  let activeCandidates = uniqueCandidates(candidates);
  const roundResults: ComputerTournamentRoundResult[] = [];

  for (const round of rounds) {
    const scores = activeCandidates
      .map((candidate) => ({
        candidate,
        result: measureComputerStrategy({
          gameCount: round.gameCount,
          seed: round.seed,
          strategy: candidate.strategy,
        }),
      }))
      .sort(compareTournamentScores);

    roundResults.push({ round, scores });
    activeCandidates = scores.slice(0, round.advanceCount).map((score) => score.candidate);
  }

  const finalScores = roundResults[roundResults.length - 1]?.scores ?? [];
  return {
    candidates,
    rounds: roundResults,
    winner: finalScores[0],
  };
}

export function createComputerStrategyCandidates(): ComputerStrategyCandidate[] {
  const candidates: ComputerStrategyCandidate[] = [
    {
      name: 'current',
      strategy: defaultComputerStrategy,
    },
  ];

  for (const upperPressureHoldMultiplier of [1.3, 1.4, 1.5, 1.6]) {
    for (const mulliganMaxScore of [12, 14, 16, 18]) {
      for (const chanceEarlyPenalty of [8, 10, 12]) {
        for (const extraRollMaxScore of [16, 18, 20]) {
          for (const stopScoreThreshold of [35, 40, 45]) {
            for (const upperShortfallPenalty of [0.7, 0.8, 0.9]) {
              const strategy = {
                ...defaultComputerStrategy,
                chanceEarlyPenalty,
                extraRollMaxScore,
                mulliganMaxScore,
                stopScoreThreshold,
                upperPressureHoldMultiplier,
                upperShortfallPenalty,
              };

              candidates.push({
                name: [
                  `hold${upperPressureHoldMultiplier}`,
                  `mul${mulliganMaxScore}`,
                  `chance${chanceEarlyPenalty}`,
                  `extra${extraRollMaxScore}`,
                  `stop${stopScoreThreshold}`,
                  `upper${upperShortfallPenalty}`,
                ].join('-'),
                strategy,
              });
            }
          }
        }
      }
    }
  }

  return uniqueCandidates(candidates);
}

export function runSuckerTokenStrategyTournament({
  candidates = createSuckerTokenStrategyCandidates(),
  opponentStrategy = defaultComputerStrategy,
  rounds = defaultSuckerTokenTournamentRounds,
}: {
  candidates?: ComputerStrategyCandidate[];
  opponentStrategy?: ComputerStrategyConfig;
  rounds?: ComputerTournamentRound[];
} = {}): SuckerTokenTournamentResult {
  let activeCandidates = uniqueCandidates(candidates);
  const roundResults: SuckerTokenTournamentRoundResult[] = [];

  for (const round of rounds) {
    const scores = activeCandidates
      .map((candidate) => ({
        candidate,
        result: measureComputerHeadToHead({
          candidateStrategy: candidate.strategy,
          gameCount: round.gameCount,
          opponentStrategy,
          seed: round.seed,
        }),
      }))
      .sort(compareSuckerTokenTournamentScores);

    roundResults.push({ round, scores });
    activeCandidates = scores.slice(0, round.advanceCount).map((score) => score.candidate);
  }

  const finalScores = roundResults[roundResults.length - 1]?.scores ?? [];
  return {
    candidates,
    rounds: roundResults,
    winner: finalScores[0],
  };
}

export function createSuckerTokenStrategyCandidates(): ComputerStrategyCandidate[] {
  const candidates: ComputerStrategyCandidate[] = [
    {
      name: 'current',
      strategy: defaultComputerStrategy,
    },
  ];

  for (const suckerPunchMinScore of [50]) {
    for (const suckerPunchComebackMinCategories of [8, 9, 10, 11]) {
      for (const suckerPunchComebackMinScore of [30, 35, 40, 45]) {
        for (const suckerPunchReserveTokens of [0, 2, 4]) {
          for (const suckerBlockerMinScore of [20, 25, 30, 35]) {
            for (const extraRollMaxScore of [16, 18, 20]) {
              for (const mulliganMaxScore of [12, 14, 16, 18]) {
                candidates.push({
                  name: [
                    `punch${suckerPunchMinScore}`,
                    `late${suckerPunchComebackMinCategories}`,
                    `comeback${suckerPunchComebackMinScore}`,
                    `reserve${suckerPunchReserveTokens}`,
                    `block${suckerBlockerMinScore}`,
                    `extra${extraRollMaxScore}`,
                    `mul${mulliganMaxScore}`,
                  ].join('-'),
                  strategy: {
                    ...defaultComputerStrategy,
                    extraRollMaxScore,
                    mulliganMaxScore,
                    suckerBlockerMinScore,
                    suckerPunchComebackMinCategories,
                    suckerPunchComebackMinScore,
                    suckerPunchMinScore,
                    suckerPunchReserveTokens,
                  },
                });
              }
            }
          }
        }
      }
    }
  }

  return uniqueCandidates(candidates);
}

const defaultTournamentRounds: ComputerTournamentRound[] = [
  { advanceCount: 24, gameCount: 100, seed: 1 },
  { advanceCount: 8, gameCount: 1000, seed: 1 },
  { advanceCount: 1, gameCount: 3000, seed: 1 },
];

const defaultSuckerTokenTournamentRounds: ComputerTournamentRound[] = [
  { advanceCount: 16, gameCount: 50, seed: 1 },
  { advanceCount: 6, gameCount: 500, seed: 1 },
  { advanceCount: 1, gameCount: 2000, seed: 1 },
];

function uniqueCandidates(candidates: ComputerStrategyCandidate[]) {
  const byStrategy = new Map<string, ComputerStrategyCandidate>();
  for (const candidate of candidates) {
    byStrategy.set(strategyKey(candidate.strategy), candidate);
  }
  return [...byStrategy.values()];
}

function strategyKey(strategy: ComputerStrategyConfig) {
  return JSON.stringify({
    chanceEarlyPenalty: strategy.chanceEarlyPenalty,
    extraRollMaxPurchases: strategy.extraRollMaxPurchases,
    extraRollMaxScore: strategy.extraRollMaxScore,
    extraRollMinTokens: strategy.extraRollMinTokens,
    extraRollReserveTokens: strategy.extraRollReserveTokens,
    extraRollSuckerChaseMaxPurchases: strategy.extraRollSuckerChaseMaxPurchases,
    finalActionRolloutOpenCategoryMax: strategy.finalActionRolloutOpenCategoryMax,
    finalActionRolloutSimulations: strategy.finalActionRolloutSimulations,
    holdRolloutRollNumberMax: strategy.holdRolloutRollNumberMax,
    holdRolloutSimulations: strategy.holdRolloutSimulations,
    holdRolloutTokenValue: strategy.holdRolloutTokenValue,
    mulliganMaxScore: strategy.mulliganMaxScore,
    stopScoreThreshold: strategy.stopScoreThreshold,
    suckerBlockerMinScore: strategy.suckerBlockerMinScore,
    suckerCategoryBonus: strategy.suckerCategoryBonus,
    suckerPunchComebackMinCategories: strategy.suckerPunchComebackMinCategories,
    suckerPunchComebackMinScore: strategy.suckerPunchComebackMinScore,
    suckerPunchMinScore: strategy.suckerPunchMinScore,
    suckerPunchReserveTokens: strategy.suckerPunchReserveTokens,
    suckerPunchUnblockableMinScore: strategy.suckerPunchUnblockableMinScore,
    suckerDealBeforeTokenSpending: strategy.suckerDealBeforeTokenSpending,
    suckerDealChanceMaxScore: strategy.suckerDealChanceMaxScore,
    suckerDealMaxSacrificeScore: strategy.suckerDealMaxSacrificeScore,
    suckerDealMinOpenCategories: strategy.suckerDealMinOpenCategories,
    turnDecisionRolloutIncludesExtraRoll: strategy.turnDecisionRolloutIncludesExtraRoll,
    turnDecisionRolloutIncludesMulligan: strategy.turnDecisionRolloutIncludesMulligan,
    turnDecisionRolloutOpenCategoryMax: strategy.turnDecisionRolloutOpenCategoryMax,
    turnDecisionRolloutSimulations: strategy.turnDecisionRolloutSimulations,
    upperPressureHoldMultiplier: strategy.upperPressureHoldMultiplier,
    upperPressureScratchCostBonus: strategy.upperPressureScratchCostBonus,
    upperShortfallPenalty: strategy.upperShortfallPenalty,
  });
}

function compareTournamentScores(left: ComputerTournamentScore, right: ComputerTournamentScore) {
  return (
    right.result.averageScore - left.result.averageScore ||
    right.result.lowScore - left.result.lowScore ||
    right.result.highScore - left.result.highScore
  );
}

function compareSuckerTokenTournamentScores(left: SuckerTokenTournamentScore, right: SuckerTokenTournamentScore) {
  return (
    right.result.winRate - left.result.winRate ||
    right.result.averageMargin - left.result.averageMargin ||
    right.result.averageScore - left.result.averageScore
  );
}
