export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;
export type Dice = [DieValue, DieValue, DieValue, DieValue, DieValue];
export type ScoreCategory =
  | "ones"
  | "twos"
  | "threes"
  | "fours"
  | "fives"
  | "sixes"
  | "threeOfAKind"
  | "fourOfAKind"
  | "fullHouse"
  | "smallStraight"
  | "largeStraight"
  | "sucker"
  | "chance";

export type Scorecard = Record<ScoreCategory, number | null>;

export type Player = {
  id: string;
  name: string;
  suckerTokens: number;
  suckerBonusCategories: ScoreCategory[];
  scorecard: Scorecard;
};

export type GameState = {
  currentPlayerIndex: number;
  dice: Dice;
  extraRollsAvailable: number;
  held: [boolean, boolean, boolean, boolean, boolean];
  id: string;
  phase: "rolling" | "scoring" | "complete";
  players: Player[];
  rollNumber: number;
};

export const scoreCategories: ScoreCategory[] = [
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
  "threeOfAKind",
  "fourOfAKind",
  "fullHouse",
  "smallStraight",
  "largeStraight",
  "sucker",
  "chance",
];

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

type UpperCategory = Extract<
  ScoreCategory,
  "ones" | "twos" | "threes" | "fours" | "fives" | "sixes"
>;

export function createEmptyScorecard(): Scorecard {
  return scoreCategories.reduce((scorecard, category) => {
    scorecard[category] = null;
    return scorecard;
  }, {} as Scorecard);
}

export function rollDie(): DieValue {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return ((values[0] % 6) + 1) as DieValue;
}

export function scoreCategoryForScorecard(
  dice: Dice,
  category: ScoreCategory,
  scorecard: Scorecard,
): number {
  return scoreCategory(dice, category) +
    (category !== "sucker" && scorecard.sucker !== null && isSuckerRoll(dice)
      ? 50
      : 0);
}

export function totalScore(scorecard: Scorecard): number {
  return scoreCategories.reduce(
    (total, category) => total + (scorecard[category] ?? 0),
    0,
  ) + upperBonus(scorecard);
}

export function upperBonus(scorecard: Scorecard): number {
  return (["ones", "twos", "threes", "fours", "fives", "sixes"] as const)
      .reduce(
        (total, category) => total + (scorecard[category] ?? 0),
        0,
      ) >= 63
    ? 35
    : 0;
}

export function isSuckerRoll(dice: Dice): boolean {
  return dice.every((die) => die === dice[0]);
}

export function toDice(values: number[]): Dice {
  if (values.length !== 5 || values.some((value) => value < 1 || value > 6)) {
    throw new Error("Stored turn has invalid dice.");
  }

  return values as Dice;
}

export function toScoreCategory(value: string): ScoreCategory {
  if (!scoreCategories.includes(value as ScoreCategory)) {
    throw new Error(`Stored turn has invalid category: ${value}`);
  }

  return value as ScoreCategory;
}

function scoreCategory(dice: Dice, category: ScoreCategory): number {
  const counts = countDice(dice);
  const total = sumDice(dice);

  switch (category) {
    case "ones":
    case "twos":
    case "threes":
    case "fours":
    case "fives":
    case "sixes":
      return scoreUpperCategory(counts, category);
    case "threeOfAKind":
      return hasOfAKind(counts, 3) ? total : 0;
    case "fourOfAKind":
      return hasOfAKind(counts, 4) ? total : 0;
    case "fullHouse":
      return hasFullHouse(counts) ? 25 : 0;
    case "smallStraight":
      return hasStraight(dice, 4) ? 30 : 0;
    case "largeStraight":
      return hasStraight(dice, 5) ? 40 : 0;
    case "sucker":
      return hasOfAKind(counts, 5) ? 50 : 0;
    case "chance":
      return total;
    default:
      return assertNever(category);
  }
}

function scoreUpperCategory(
  counts: Record<DieValue, number>,
  category: UpperCategory,
): number {
  const face = upperValues[category];
  return counts[face] * face;
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

function hasFullHouse(counts: Record<DieValue, number>): boolean {
  const values = Object.values(counts);
  return values.includes(3) && values.includes(2);
}

function hasStraight(dice: Dice, length: 4 | 5): boolean {
  const faces = [...new Set(dice)].sort().join("");
  const runs = length === 4 ? ["1234", "2345", "3456"] : ["12345", "23456"];
  return runs.some((run) => faces.includes(run));
}

function sumDice(dice: Dice): number {
  return dice.reduce((sum, die) => sum + die, 0);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled score category: ${value}`);
}
