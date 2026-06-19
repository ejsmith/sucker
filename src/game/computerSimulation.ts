import { availableCategories, createGame, totalScore, type GameState } from './index';
import { computerPlayerIndex, defaultComputerStrategy, playComputerTurn, type ComputerStrategyConfig } from './computer';

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

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
