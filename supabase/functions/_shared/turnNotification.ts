import { isSuckerRoll, toDice } from './game.ts';

export function buildScoredTurnNotification(
  actorName: string,
  categoryLabel: string,
  scratched: boolean,
  turn: { dice: number[]; roll_count: number; score: number } | null,
) {
  if (turn && turn.roll_count > 0 && isSuckerRoll(toDice(turn.dice))) {
    return { body: `${actorName} rolled a SUCKER!`, title: 'SUCKER!!' };
  }
  if (scratched) return { body: `${actorName} scratched ${categoryLabel}.`, title: 'Your turn' };
  const scoreText = turn ? ` for ${turn.score}` : '';
  return { body: `${actorName} played ${categoryLabel}${scoreText}.`, title: 'Your turn' };
}
