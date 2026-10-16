// Rage Quit ends a game by forfeit. It never helps the quitter: the opponent
// wins, and the quitter is publicly salted for a day.

// The quitter picks an excuse. Everyone is told what it really means.
export const rageQuitLastWords = [
  { id: 'rigged', text: 'This game is rigged.', confession: "I'm a sore loser." },
  { id: 'got-lucky', text: 'You got lucky.', confession: "You're better than me." },
  { id: 'not-trying', text: "I wasn't even trying.", confession: 'I tried my absolute hardest.' },
  { id: 'fake-win', text: 'Enjoy your fake win.', confession: 'I need a juice box and a nap.' },
] as const;

export const rageQuitReplies = [
  { id: 'bye-sucker', text: 'Bye, Sucker!' },
  { id: 'need-tissue', text: 'Need a tissue?' },
  { id: 'taste-salt', text: 'I can taste the salt.' },
  { id: 'same-time', text: 'Same time tomorrow?' },
] as const;

export type RageQuitLastWordsId = (typeof rageQuitLastWords)[number]['id'];
export type RageQuitReplyId = (typeof rageQuitReplies)[number]['id'];

// Mash taps needed to fill the rage meter. Stopping drains it.
export const rageQuitMeterTaps = 8;
export const rageQuitSaltDurationMs = 24 * 60 * 60 * 1_000;

export function isRageQuitLastWordsId(value: unknown): value is RageQuitLastWordsId {
  return typeof value === 'string' && rageQuitLastWords.some((line) => line.id === value);
}

export function isRageQuitReplyId(value: unknown): value is RageQuitReplyId {
  return typeof value === 'string' && rageQuitReplies.some((reply) => reply.id === value);
}

// Stored ids may come from a newer release; fall back instead of failing.
export function getRageQuitLastWordsText(id: string) {
  return rageQuitLastWords.find((line) => line.id === id)?.text ?? 'I quit.';
}

export function getRageQuitConfession(id: string) {
  return rageQuitLastWords.find((line) => line.id === id)?.confession ?? "I can't handle losing.";
}

export function getRageQuitReplyText(id: string) {
  return rageQuitReplies.find((reply) => reply.id === id)?.text ?? 'Bye, Sucker!';
}

export function isSaltyAt(rageQuitAt: string | null | undefined, now: number) {
  if (!rageQuitAt) return false;
  const quitAt = new Date(rageQuitAt).getTime();
  return Number.isFinite(quitAt) && now - quitAt < rageQuitSaltDurationMs;
}
