import {
  categoryLabels,
  getTurnSpendTokens,
  isSuckerRoll,
  type Dice,
  type ScoreCategory,
  type TurnSpend,
} from '../../shared/game';

// A scored turn and what it cost. Dice are null when the turn never rolled.
export type SpentTurn = {
  category: ScoreCategory;
  dice: Dice | null;
  score: number;
  spend: TurnSpend | null;
};

// One line on what a turn's tokens bought, or null when it cost nothing.
// Without a subject it is the second line of the turn reveal, under
// "<name> played <score> on <box>". With one it stands alone in the recap.
export function describeTurnSpend(turn: SpentTurn, subject?: string): string | null {
  const tokens = getTurnSpendTokens(turn.spend);
  if (!turn.spend || tokens === 0) return null;

  const amount = `${tokens} token${tokens === 1 ? '' : 's'}`;
  const burned = subject ? `${subject} burned` : 'Burned';
  const box = categoryLabels[turn.category];
  if (turn.dice && turn.score > 0 && isSuckerRoll(turn.dice)) return `${burned} ${amount} chasing a Sucker and got it!`;
  if (turn.category === 'sucker') return `${burned} ${amount} chasing a Sucker. No dice.`;
  if (turn.score === 0) return subject ? `${burned} ${amount} for a 0 on ${box}.` : `${burned} ${amount} for nothing.`;
  return subject
    ? `${subject} spent ${amount} for ${turn.score} on ${box}.`
    : `Spent ${amount} on ${formatPurchases(turn.spend)}.`;
}

function formatPurchases(spend: TurnSpend) {
  return [
    spend.extraRolls === 1 ? 'an Extra Roll' : spend.extraRolls > 1 ? `${spend.extraRolls} Extra Rolls` : null,
    spend.mulligans === 1 ? 'a Mulligan' : spend.mulligans > 1 ? `${spend.mulligans} Mulligans` : null,
  ]
    .filter(Boolean)
    .join(' + ');
}
