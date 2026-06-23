export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

export type Dice = [DieValue, DieValue, DieValue, DieValue, DieValue];

export type ScoreCategory =
  | 'ones'
  | 'twos'
  | 'threes'
  | 'fours'
  | 'fives'
  | 'sixes'
  | 'threeOfAKind'
  | 'fourOfAKind'
  | 'fullHouse'
  | 'smallStraight'
  | 'largeStraight'
  | 'sucker'
  | 'chance';

export type Scorecard = Record<ScoreCategory, number | null>;

export type Player = {
  id: string;
  name: string;
  suckerTokens: number;
  suckerBonusCategories: ScoreCategory[];
  scorecard: Scorecard;
};

export type GamePhase = 'rolling' | 'scoring' | 'complete';

export type GameState = {
  id: string;
  players: Player[];
  currentPlayerIndex: number;
  dice: Dice;
  extraRollsAvailable: number;
  held: [boolean, boolean, boolean, boolean, boolean];
  rollNumber: number;
  phase: GamePhase;
};

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
export const startingSuckerTokens = 8;
export const suckerTokenCosts = {
  extraRoll: 1,
  mulligan: 3,
  suckerBlocker: 2,
  suckerPunch: 4,
} as const;

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
    suckerTokens: startingSuckerTokens,
    suckerBonusCategories: [],
    scorecard: createEmptyScorecard(),
  }));

  return {
    id: `local-${Date.now()}`,
    players,
    currentPlayerIndex: 0,
    dice: [1, 1, 1, 1, 1],
    extraRollsAvailable: 0,
    held: [false, false, false, false, false],
    rollNumber: 0,
    phase: 'rolling',
  };
}

export function availableCategories(scorecard: Scorecard): ScoreCategory[] {
  return scoreCategories.filter((category) => scorecard[category] === null);
}

export function rollCurrentDice(game: GameState, random = Math.random): GameState {
  if (game.phase === 'complete' || game.rollNumber >= maxAvailableRolls(game)) {
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
  return applyScore(game, category, turnScore, extraSuckerBonus, turnScore === 0 ? 1 : 0);
}

export function scratchScoreBox(game: GameState, category: ScoreCategory): GameState {
  const currentPlayer = game.players[game.currentPlayerIndex];
  if (currentPlayer.scorecard[category] !== null || game.rollNumber === 0 || game.phase === 'complete') {
    return game;
  }

  return applyScore(game, category, 0, false, 1);
}

export function maxAvailableRolls(game: Pick<GameState, 'extraRollsAvailable'>): number {
  return maxRollsPerTurn + Math.max(0, game.extraRollsAvailable ?? 0);
}

export function rollsRemaining(game: Pick<GameState, 'extraRollsAvailable' | 'rollNumber'>): number {
  return Math.max(0, maxAvailableRolls(game) - game.rollNumber);
}

export function purchaseExtraRoll(game: GameState): GameState {
  const currentPlayer = game.players[game.currentPlayerIndex];
  if (
    game.phase === 'complete' ||
    game.rollNumber < maxAvailableRolls(game) ||
    !currentPlayer ||
    currentPlayer.suckerTokens < suckerTokenCosts.extraRoll
  ) {
    return game;
  }

  return {
    ...game,
    extraRollsAvailable: Math.max(0, game.extraRollsAvailable ?? 0) + 1,
    players: updateCurrentPlayerTokens(game, -suckerTokenCosts.extraRoll),
  };
}

export function mulliganCurrentTurn(game: GameState): GameState {
  const currentPlayer = game.players[game.currentPlayerIndex];
  if (
    game.phase === 'complete' ||
    game.rollNumber === 0 ||
    !currentPlayer ||
    currentPlayer.suckerTokens < suckerTokenCosts.mulligan
  ) {
    return game;
  }

  return {
    ...game,
    dice: [1, 1, 1, 1, 1],
    extraRollsAvailable: 0,
    held: [false, false, false, false, false],
    phase: 'rolling',
    players: updateCurrentPlayerTokens(game, -suckerTokenCosts.mulligan),
    rollNumber: 0,
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

export function rollDie(random: () => number = Math.random): DieValue {
  return (Math.floor(random() * 6) + 1) as DieValue;
}

export function isSuckerRoll(dice: Dice): boolean {
  return dice.every((die) => die === dice[0]);
}

export function toDice(values: unknown): Dice {
  if (!Array.isArray(values) || values.length !== 5 || values.some((value) => !isDieValue(value))) {
    throw new Error('Stored turn has invalid dice.');
  }

  return values as Dice;
}

export function toHeldDice(values: unknown): GameState['held'] {
  if (!Array.isArray(values) || values.length !== 5 || values.some((value) => typeof value !== 'boolean')) {
    throw new Error('Stored game has invalid held dice.');
  }

  return values as GameState['held'];
}

export function toScoreCategory(value: string): ScoreCategory {
  if (!scoreCategories.includes(value as ScoreCategory)) {
    throw new Error(`Stored turn has invalid category: ${value}`);
  }

  return value as ScoreCategory;
}

export function toGameState(value: unknown): GameState {
  const game = toRecord(value, 'Stored game state is invalid.');
  const players = toArray(game.players, 'Stored game has invalid players.').map(toPlayer);
  const currentPlayerIndex = toNonNegativeInteger(game.currentPlayerIndex, 'Stored game has invalid current player.');

  if (players.length === 0 || currentPlayerIndex >= players.length) {
    throw new Error('Stored game has invalid current player.');
  }

  return {
    currentPlayerIndex,
    dice: toDice(game.dice),
    extraRollsAvailable: toOptionalNonNegativeInteger(
      game.extraRollsAvailable,
      0,
      'Stored game has invalid extra rolls.',
    ),
    held: toHeldDice(game.held),
    id: toString(game.id, 'Stored game has invalid id.'),
    phase: toGamePhase(game.phase),
    players,
    rollNumber: toNonNegativeInteger(game.rollNumber, 'Stored game has invalid roll number.'),
  };
}

function applyScore(
  game: GameState,
  category: ScoreCategory,
  turnScore: number,
  extraSuckerBonus: boolean,
  tokenDelta: number,
): GameState {
  const players = game.players.map((player, index) => {
    if (index !== game.currentPlayerIndex) {
      return player;
    }

    return {
      ...player,
      suckerBonusCategories: extraSuckerBonus
        ? [...(player.suckerBonusCategories ?? []), category]
        : (player.suckerBonusCategories ?? []),
      suckerTokens: Math.max(0, player.suckerTokens + tokenDelta),
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
    extraRollsAvailable: 0,
    held: [false, false, false, false, false],
    rollNumber: 0,
    phase: complete ? 'complete' : 'rolling',
  };
}

function updateCurrentPlayerTokens(game: GameState, delta: number): Player[] {
  return game.players.map((player, index) =>
    index === game.currentPlayerIndex
      ? {
          ...player,
          suckerTokens: Math.max(0, player.suckerTokens + delta),
        }
      : player,
  );
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

function toPlayer(value: unknown): Player {
  const player = toRecord(value, 'Stored game has invalid player.');

  return {
    id: toString(player.id, 'Stored game has invalid player id.'),
    name: toString(player.name, 'Stored game has invalid player name.'),
    scorecard: toScorecard(player.scorecard),
    suckerBonusCategories: toArray(player.suckerBonusCategories, 'Stored game has invalid sucker bonuses.').map(
      (category) => toScoreCategory(toString(category, 'Stored game has invalid sucker bonus category.')),
    ),
    suckerTokens: toNonNegativeInteger(player.suckerTokens, 'Stored game has invalid token count.'),
  };
}

function toScorecard(value: unknown): Scorecard {
  const storedScorecard = toRecord(value, 'Stored game has invalid scorecard.');
  const scorecard = createEmptyScorecard();

  for (const category of scoreCategories) {
    const score = storedScorecard[category];
    if (score !== null && (typeof score !== 'number' || !Number.isInteger(score) || score < 0)) {
      throw new Error(`Stored game has invalid score for ${category}.`);
    }
    scorecard[category] = score;
  }

  return scorecard;
}

function toGamePhase(value: unknown): GamePhase {
  if (value !== 'rolling' && value !== 'scoring' && value !== 'complete') {
    throw new Error('Stored game has invalid phase.');
  }

  return value;
}

function toRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function toArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(message);
  }

  return value;
}

function toString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(message);
  }

  return value;
}

function toNonNegativeInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(message);
  }

  return value;
}

function toOptionalNonNegativeInteger(value: unknown, fallback: number, message: string): number {
  if (value === undefined || value === null) {
    return fallback;
  }

  return toNonNegativeInteger(value, message);
}

function isDieValue(value: unknown): value is DieValue {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled score category: ${value}`);
}
