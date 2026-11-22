import type { RemoteGameRow } from './types';

const jabTurnWaitMs = 60 * 60 * 1_000;
export const jabCooldownMs = 8 * 60 * 60 * 1_000;

export function canJabGame(
  game: Pick<RemoteGameRow, 'status' | 'current_player_id' | 'turn_started_at' | 'updated_at' | 'last_nudged_at'>,
  profileId: string,
  now: number,
): boolean {
  if (
    game.status === 'inviting' ||
    game.status === 'complete' ||
    !game.current_player_id ||
    game.current_player_id === profileId
  ) {
    return false;
  }

  // Older servers don't send turn_started_at; their best clue is the last update.
  const turnStartedAt = new Date(game.turn_started_at ?? game.updated_at).getTime();
  const lastJabbedAt = game.last_nudged_at ? new Date(game.last_nudged_at).getTime() : null;
  return now - turnStartedAt >= jabTurnWaitMs && (lastJabbedAt === null || now - lastJabbedAt >= jabCooldownMs);
}
