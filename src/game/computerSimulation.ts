import { availableCategories, createGame, totalScore, type GameState } from './index';
import {
  computerPlayerIndex,
  defaultComputerStrategy,
  playAutomatedTurn,
  playComputerTurn,
  type ComputerStrategyConfig,
  type LocalPendingTurn,
} from './computer';

export type ComputerSimulationOptions = {
  gameCount?: number;
  seed?: number;
  strategy?: ComputerStrategyConfig;
};

export type ComputerSimulationResult = {
  averageScore: number;
  gameCount: number;
  highScore: number;
  lowScore: number;
  scores: number[];
};

export type ComputerHeadToHeadResult = {
  averageMargin: number;
  averageOpponentScore: number;
  averageScore: number;
  gameCount: number;
  losses: number;
  ties: number;
  winRate: number;
  wins: number;
};

export function measureComputerStrategy(options: ComputerSimulationOptions = {}): ComputerSimulationResult {
  const gameCount = options.gameCount ?? 1000;
  const firstSeed = options.seed ?? 1;
  const strategy = options.strategy ?? defaultComputerStrategy;
  const scores = Array.from({ length: gameCount }, (_, index) => simulateComputerScore(firstSeed + index, strategy));
  const total = scores.reduce((sum, score) => sum + score, 0);

  return {
    averageScore: total / gameCount,
    gameCount,
    highScore: Math.max(...scores),
    lowScore: Math.min(...scores),
    scores,
  };
}

export function simulateComputerScore(seed = 1, strategy: ComputerStrategyConfig = defaultComputerStrategy): number {
  const random = createSeededRandom(seed);
  let game: GameState = {
    ...createGame(['Player', 'Computer']),
    currentPlayerIndex: computerPlayerIndex,
  };

  while (availableCategories(game.players[computerPlayerIndex].scorecard).length > 0) {
    const result = playComputerTurn(
      {
        ...game,
        currentPlayerIndex: computerPlayerIndex,
        phase: 'rolling',
      },
      null,
      random,
      strategy,
    );
    game = {
      ...result.game,
      currentPlayerIndex: computerPlayerIndex,
      phase: result.game.phase === 'complete' ? 'complete' : 'rolling',
    };
  }

  return totalScore(game.players[computerPlayerIndex].scorecard);
}

export function measureComputerHeadToHead({
  candidateStrategy,
  gameCount = 1000,
  opponentStrategy = defaultComputerStrategy,
  seed = 1,
}: {
  candidateStrategy: ComputerStrategyConfig;
  gameCount?: number;
  opponentStrategy?: ComputerStrategyConfig;
  seed?: number;
}): ComputerHeadToHeadResult {
  let candidateScoreTotal = 0;
  let opponentScoreTotal = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (let index = 0; index < gameCount; index += 1) {
    const result = simulateComputerHeadToHead(seed + index, candidateStrategy, opponentStrategy);
    candidateScoreTotal += result.candidateScore;
    opponentScoreTotal += result.opponentScore;

    if (result.candidateScore > result.opponentScore) {
      wins += 1;
    } else if (result.candidateScore < result.opponentScore) {
      losses += 1;
    } else {
      ties += 1;
    }
  }

  const averageScore = candidateScoreTotal / gameCount;
  const averageOpponentScore = opponentScoreTotal / gameCount;

  return {
    averageMargin: averageScore - averageOpponentScore,
    averageOpponentScore,
    averageScore,
    gameCount,
    losses,
    ties,
    winRate: wins / gameCount,
    wins,
  };
}

export function measureComputerHeadToHeadSideBalanced({
  candidateStrategy,
  gameCount = 1000,
  opponentStrategy = defaultComputerStrategy,
  seed = 1,
}: {
  candidateStrategy: ComputerStrategyConfig;
  gameCount?: number;
  opponentStrategy?: ComputerStrategyConfig;
  seed?: number;
}): ComputerHeadToHeadResult {
  let candidateScoreTotal = 0;
  let opponentScoreTotal = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (let index = 0; index < gameCount; index += 1) {
    const candidateSecond = simulateComputerHeadToHead(seed + index, candidateStrategy, opponentStrategy);
    candidateScoreTotal += candidateSecond.candidateScore;
    opponentScoreTotal += candidateSecond.opponentScore;

    if (candidateSecond.candidateScore > candidateSecond.opponentScore) {
      wins += 1;
    } else if (candidateSecond.candidateScore < candidateSecond.opponentScore) {
      losses += 1;
    } else {
      ties += 1;
    }

    const candidateFirst = simulateComputerHeadToHead(seed + index, opponentStrategy, candidateStrategy);
    candidateScoreTotal += candidateFirst.opponentScore;
    opponentScoreTotal += candidateFirst.candidateScore;

    if (candidateFirst.opponentScore > candidateFirst.candidateScore) {
      wins += 1;
    } else if (candidateFirst.opponentScore < candidateFirst.candidateScore) {
      losses += 1;
    } else {
      ties += 1;
    }
  }

  const balancedGameCount = gameCount * 2;
  const averageScore = candidateScoreTotal / balancedGameCount;
  const averageOpponentScore = opponentScoreTotal / balancedGameCount;

  return {
    averageMargin: averageScore - averageOpponentScore,
    averageOpponentScore,
    averageScore,
    gameCount: balancedGameCount,
    losses,
    ties,
    winRate: wins / balancedGameCount,
    wins,
  };
}

export function simulateComputerHeadToHead(
  seed = 1,
  candidateStrategy: ComputerStrategyConfig = defaultComputerStrategy,
  opponentStrategy: ComputerStrategyConfig = defaultComputerStrategy,
): { candidateScore: number; opponentScore: number } {
  const random = createSeededRandom(seed);
  let game = createGame(['Opponent', 'Candidate']);
  let pendingTurn: LocalPendingTurn | null = null;

  while (game.phase !== 'complete') {
    const activePlayerIndex = game.currentPlayerIndex;
    const strategy = activePlayerIndex === computerPlayerIndex ? candidateStrategy : opponentStrategy;
    const result = playAutomatedTurn(game, activePlayerIndex, pendingTurn, random, strategy);
    game = result.game;
    pendingTurn = result.pendingTurn;
  }

  return {
    candidateScore: totalScore(game.players[computerPlayerIndex].scorecard),
    opponentScore: totalScore(game.players[0].scorecard),
  };
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
