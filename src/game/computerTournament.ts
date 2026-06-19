import { defaultComputerStrategy, type ComputerStrategyConfig } from './computer';
import { measureComputerStrategy, type ComputerSimulationResult } from './computerSimulation';

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

const defaultTournamentRounds: ComputerTournamentRound[] = [
  { advanceCount: 24, gameCount: 100, seed: 1 },
  { advanceCount: 8, gameCount: 1000, seed: 1 },
  { advanceCount: 1, gameCount: 3000, seed: 1 },
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
    extraRollMaxScore: strategy.extraRollMaxScore,
    mulliganMaxScore: strategy.mulliganMaxScore,
    stopScoreThreshold: strategy.stopScoreThreshold,
    suckerCategoryBonus: strategy.suckerCategoryBonus,
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
