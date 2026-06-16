import type { Dice, DieValue, GameState, Player, Scorecard, ScoreCategory } from './types';

export const scoreCategories: ScoreCategory[] = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'threeOfAKind',
  'fourOfAKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'sucker',
  'chance',
];

export const categoryLabels: Record<ScoreCategory, string> = {
  ones: 'Ones',
  twos: 'Twos',
  threes: 'Threes',
  fours: 'Fours',
  fives: 'Fives',
  sixes: 'Sixes',
  threeOfAKind: '3 of a kind',
  fourOfAKind: '4 of a kind',
  fullHouse: 'Full house',
  smallStraight: 'Small straight',
  largeStraight: 'Large straight',
  sucker: 'Sucker',
  chance: 'Chance',
};

export const maxRollsPerTurn = 4;

const upperValues = {
  ones: 1,
  twos: 2,
  threes: 3,
  fours: 4,
  fives: 5,
  sixes: 6,
} satisfies Record<UpperCategory, DieValue>;

type UpperCategory = Extract<ScoreCategory, 'ones' | 'twos' | 'threes' | 'fours' | 'fives' | 'sixes'>;

export function createEmptyScorecard(): Scorecard {
  return scoreCategories.reduce((scorecard, category) => {
    scorecard[category] = null;
    return scorecard;
  }, {} as Scorecard);
}

export function createGame(playerNames: string[]): GameState {
  const players: Player[] = playerNames.map((name, index) => ({
    id: `player-${index + 1}`,
    name,
    suckerTokens: 1,
    suckerBonusCategories: [],
    scorecard: createEmptyScorecard(),
  }));

  return {
    id: `local-${Date.now()}`,
    players,
    currentPlayerIndex: 0,
    dice: [1, 1, 1, 1, 1],
    held: [false, false, false, false, false],
    rollNumber: 0,
    phase: 'rolling',
  };
}

export function availableCategories(scorecard: Scorecard): ScoreCategory[] {
  return scoreCategories.filter((category) => scorecard[category] === null);
}

export function rollCurrentDice(game: GameState, random = Math.random): GameState {
  if (game.phase === 'complete' || game.rollNumber >= maxRollsPerTurn) {
    return game;
  }

  const dice = game.dice.map((die, index) => (game.held[index] ? die : rollDie(random))) as Dice;

  return {
    ...game,
    dice,
    rollNumber: game.rollNumber + 1,
    phase: 'scoring',
  };
}

export function toggleHold(game: GameState, index: number): GameState {
  if (game.rollNumber === 0 || game.phase === 'complete') {
    return game;
  }

  const held = [...game.held] as GameState['held'];
  held[index] = !held[index];
  return { ...game, held };
}

export function scoreTurn(game: GameState, category: ScoreCategory): GameState {
  const currentPlayer = game.players[game.currentPlayerIndex];
  if (currentPlayer.scorecard[category] !== null || game.rollNumber === 0 || game.phase === 'complete') {
    return game;
  }

  const turnScore = scoreCategoryForScorecard(game.dice, category, currentPlayer.scorecard);
  const extraSuckerBonus = hasExtraSuckerBonus(game.dice, category, currentPlayer.scorecard);
  const earnedSuckerToken = isSuckerRoll(game.dice) && turnScore > 0;

  const players = game.players.map((player, index) => {
    if (index !== game.currentPlayerIndex) {
      return player;
    }

    return {
      ...player,
      suckerTokens: player.suckerTokens + (earnedSuckerToken ? 1 : 0),
      suckerBonusCategories: extraSuckerBonus
        ? [...(player.suckerBonusCategories ?? []), category]
        : (player.suckerBonusCategories ?? []),
      scorecard: {
        ...player.scorecard,
        [category]: turnScore,
      },
    };
  });

  const complete = players.every((player) => availableCategories(player.scorecard).length === 0);

  return {
    ...game,
    players,
    currentPlayerIndex: complete ? game.currentPlayerIndex : (game.currentPlayerIndex + 1) % game.players.length,
    dice: [1, 1, 1, 1, 1],
    held: [false, false, false, false, false],
    rollNumber: 0,
    phase: complete ? 'complete' : 'rolling',
  };
}

export function scoreCategory(dice: Dice, category: ScoreCategory): number {
  const counts = countDice(dice);
  const total = sumDice(dice);

  switch (category) {
    case 'ones':
    case 'twos':
    case 'threes':
    case 'fours':
    case 'fives':
    case 'sixes':
      return scoreUpperCategory(counts, category);
    case 'threeOfAKind':
      return hasOfAKind(counts, 3) ? total : 0;
    case 'fourOfAKind':
      return hasOfAKind(counts, 4) ? total : 0;
    case 'fullHouse':
      return hasFullHouse(counts) ? 25 : 0;
    case 'smallStraight':
      return hasStraight(dice, 4) ? 30 : 0;
    case 'largeStraight':
      return hasStraight(dice, 5) ? 40 : 0;
    case 'sucker':
      return hasOfAKind(counts, 5) ? 50 : 0;
    case 'chance':
      return total;
    default:
      return assertNever(category);
  }
}

export function scoreCategoryForScorecard(dice: Dice, category: ScoreCategory, scorecard: Scorecard): number {
  return scoreCategory(dice, category) + (hasExtraSuckerBonus(dice, category, scorecard) ? 50 : 0);
}

export function totalScore(scorecard: Scorecard): number {
  return scoreCategories.reduce((total, category) => total + (scorecard[category] ?? 0), 0) + upperBonus(scorecard);
}

export function upperBonus(scorecard: Scorecard): number {
  const upperTotal = (['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const).reduce(
    (total, category) => total + (scorecard[category] ?? 0),
    0,
  );
  return upperTotal >= 63 ? 35 : 0;
}

function rollDie(random: () => number): DieValue {
  return (Math.floor(random() * 6) + 1) as DieValue;
}

function countDice(dice: Dice): Record<DieValue, number> {
  return dice.reduce(
    (counts, die) => {
      counts[die] += 1;
      return counts;
    },
    { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } as Record<DieValue, number>,
  );
}

function hasOfAKind(counts: Record<DieValue, number>, size: number): boolean {
  return Object.values(counts).some((count) => count >= size);
}

function hasExtraSuckerBonus(dice: Dice, category: ScoreCategory, scorecard: Scorecard): boolean {
  return category !== 'sucker' && scorecard.sucker !== null && isSuckerRoll(dice);
}

function isSuckerRoll(dice: Dice): boolean {
  return dice.every((die) => die === dice[0]);
}

function scoreUpperCategory(counts: Record<DieValue, number>, category: UpperCategory): number {
  const face = upperValues[category];
  return counts[face] * face;
}

function hasFullHouse(counts: Record<DieValue, number>): boolean {
  const values = Object.values(counts);
  return values.includes(3) && values.includes(2);
}

function hasStraight(dice: Dice, length: 4 | 5): boolean {
  const faces = [...new Set(dice)].sort().join('');
  const runs = length === 4 ? ['1234', '2345', '3456'] : ['12345', '23456'];
  return runs.some((run) => faces.includes(run));
}

function sumDice(dice: Dice): number {
  return dice.reduce((sum, die) => sum + die, 0);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled score category: ${value}`);
}
