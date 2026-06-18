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
