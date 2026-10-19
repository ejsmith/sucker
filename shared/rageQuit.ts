// Rage Quit ends a game by forfeit. It never helps the quitter: the opponent
// wins, and the quitter is publicly salted for a day.

export const rageQuitReplies = [
  { id: 'bye-sucker', text: 'Bye, Sucker!' },
  { id: 'need-tissue', text: 'Need a tissue?' },
  { id: 'taste-salt', text: 'I can taste the salt.' },
  { id: 'same-time', text: 'Same time tomorrow?' },
] as const;

export type RageQuitReplyId = (typeof rageQuitReplies)[number]['id'];

export const rageQuitSaltDurationMs = 24 * 60 * 60 * 1_000;

export function isRageQuitReplyId(value: unknown): value is RageQuitReplyId {
  return typeof value === 'string' && rageQuitReplies.some((reply) => reply.id === value);
}

// Stored ids may come from a newer release; fall back instead of failing.
export function getRageQuitReplyText(id: string) {
  return rageQuitReplies.find((reply) => reply.id === id)?.text ?? 'Bye, Sucker!';
}

export function isSaltyAt(rageQuitAt: string | null | undefined, now: number) {
  if (!rageQuitAt) return false;
  const quitAt = new Date(rageQuitAt).getTime();
  return Number.isFinite(quitAt) && now - quitAt < rageQuitSaltDurationMs;
}
