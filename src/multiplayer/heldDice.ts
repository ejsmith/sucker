import type { GameState } from '../game';

export function preserveLocalHeldDice(
  remoteGame: GameState,
  visibleGame: GameState,
  playerId: string | null | undefined,
): GameState {
  if (!playerId || !isSameRoll(remoteGame, visibleGame, playerId)) {
    return remoteGame;
  }

  return {
    ...remoteGame,
    held: [...visibleGame.held] as GameState['held'],
  };
}

function isSameRoll(remoteGame: GameState, visibleGame: GameState, playerId: string) {
  const remotePlayer = remoteGame.players[remoteGame.currentPlayerIndex];
  const visiblePlayer = visibleGame.players[visibleGame.currentPlayerIndex];

  return (
    remoteGame.id === visibleGame.id &&
    remoteGame.phase !== 'complete' &&
    remoteGame.rollNumber > 0 &&
    remoteGame.rollNumber === visibleGame.rollNumber &&
    remoteGame.currentPlayerIndex === visibleGame.currentPlayerIndex &&
    remotePlayer?.id === playerId &&
    visiblePlayer?.id === playerId &&
    remoteGame.dice.every((die, index) => die === visibleGame.dice[index])
  );
}
