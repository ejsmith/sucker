import { getForfeiterId, getWinnerId, totalScore, type GameState } from '../../shared/game';

// One line on how a finished game ended, from the side of whoever views it:
// "You won by 12!", "You lost by 3.", or for someone who didn't play,
// "Bob won by 12.". Forfeits say who left.
export function describeGameResult({
  game,
  nameOf,
  viewerId,
}: {
  game: GameState;
  nameOf: (playerId: string) => string;
  viewerId: string | null;
}) {
  const forfeiterId = getForfeiterId(game);
  if (forfeiterId) {
    const who = forfeiterId === viewerId ? 'You' : nameOf(forfeiterId);
    return `${who} ${game.rageQuit ? 'rage quit' : 'ran out of time'}.`;
  }

  const winnerId = getWinnerId(game);
  if (!winnerId) return 'Tie game!';
  const winner = game.players.find((player) => player.id === winnerId);
  const loser = game.players.find((player) => player.id !== winnerId);
  const margin = winner && loser ? totalScore(winner.scorecard) - totalScore(loser.scorecard) : 0;
  if (winnerId === viewerId) return `You won by ${margin}!`;
  if (loser?.id === viewerId) return `You lost by ${margin}.`;
  return `${nameOf(winnerId)} won by ${margin}.`;
}
