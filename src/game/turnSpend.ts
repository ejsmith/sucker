import {
  categoryLabels,
  getTurnSpendTokens,
  isSuckerRoll,
  type Dice,
  type ScoreCategory,
  type TurnSpend,
} from '../../shared/game';

// A scored turn and what it cost. Dice are null when the turn never rolled. A
// Sucker Deal sacrificed the box (and earned a token) instead of rolling; a
// punched turn's score was wiped afterward.
export type SpentTurn = {
  category: ScoreCategory;
  dealt?: boolean;
  dice: Dice | null;
  punched?: boolean;
  score: number;
  spend: TurnSpend | null;
};

// One line on what a turn's tokens bought, or null when it cost nothing.
// Without a subject it is the second line of the turn reveal, under
// "<name> played <score> on <box>". With one it stands alone in the recap.
// Only facts: what was bought and what came of it, never what the player was
// going for, which nobody can know.
export function describeTurnSpend(turn: SpentTurn, subject?: string): string | null {
  const tokens = getTurnSpendTokens(turn.spend);
  if (!turn.spend || tokens === 0) return null;
  const line = subject ? describeForRecap(turn, subject, tokens) : describeForReveal(turn, turn.spend, tokens);
  return turn.punched && subject ? `${line.slice(0, -1)}, then got punched.` : line;
}

function describeForReveal(turn: SpentTurn, spend: TurnSpend, tokens: number) {
  const amount = formatTokens(tokens);
  if (turn.dealt) return `Spent ${amount}, then took a Sucker Deal.`;
  if (turn.score === 0) return `Burned ${amount} for nothing.`;
  if (turn.dice && isSuckerRoll(turn.dice)) return `Spent ${amount} and rolled a Sucker!`;
  return `Spent ${amount} on ${formatPurchases(spend)}.`;
}

function describeForRecap(turn: SpentTurn, subject: string, tokens: number) {
  const amount = formatTokens(tokens);
  const box = categoryLabels[turn.category];
  if (turn.dealt) return `${subject} spent ${amount}, then took a Sucker Deal on ${box}.`;
  if (turn.score === 0) return `${subject} burned ${amount} for a 0 on ${box}.`;
  if (turn.dice && isSuckerRoll(turn.dice)) return `${subject} spent ${amount} and rolled a Sucker for ${turn.score}!`;
  return `${subject} spent ${amount} for ${turn.score} on ${box}.`;
}

function formatTokens(tokens: number) {
  return `${tokens} token${tokens === 1 ? '' : 's'}`;
}

function formatPurchases(spend: TurnSpend) {
  return [
    spend.extraRolls === 1 ? 'an Extra Roll' : spend.extraRolls > 1 ? `${spend.extraRolls} Extra Rolls` : null,
    spend.mulligans === 1 ? 'a Mulligan' : spend.mulligans > 1 ? `${spend.mulligans} Mulligans` : null,
  ]
    .filter(Boolean)
    .join(' and ');
}
