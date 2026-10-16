// Rage Quit ends a game by forfeit. It never helps the quitter: the opponent
// wins, and the quitter is publicly salted for a day.

// The quitter does not choose. Each game assigns one, and they must tap it to
// admit it before the table flips.
export const rageQuitConfessions = [
  { id: 'quitter', text: "I'm a quitter." },
  { id: 'sore-loser', text: "I'm a sore loser." },
  { id: 'cant-lose', text: "I can't handle losing." },
  { id: 'juice-box', text: 'I need a juice box and a nap.' },
  { id: 'tried-hardest', text: 'I was trying my absolute hardest.' },
  { id: 'better-than-me', text: "You're better than me." },
  { id: 'cry-in-car', text: "I'm going to go cry in the car." },
  { id: 'blame-dice', text: "I blame the dice because I can't blame myself." },
  { id: 'quit-when-hard', text: 'I quit things when they get hard.' },
  { id: 'mom-says', text: "My mom says I'm still a winner." },
  { id: 'table-flipper', text: "I flip tables. That's who I am now." },
] as const;

export const rageQuitReplies = [
  { id: 'bye-sucker', text: 'Bye, Sucker!' },
  { id: 'need-tissue', text: 'Need a tissue?' },
  { id: 'taste-salt', text: 'I can taste the salt.' },
  { id: 'same-time', text: 'Same time tomorrow?' },
] as const;

export type RageQuitConfessionId = (typeof rageQuitConfessions)[number]['id'];
export type RageQuitReplyId = (typeof rageQuitReplies)[number]['id'];

// Mash taps needed to fill the rage meter. Stopping drains it.
export const rageQuitMeterTaps = 8;
export const rageQuitSaltDurationMs = 24 * 60 * 60 * 1_000;

// Stable per game and player, so reopening the dialog never rerolls a milder
// confession. The server recomputes it and rejects anything else.
export function assignRageQuitConfession(gameId: string, playerId: string): RageQuitConfessionId {
  let hash = 0x811c9dc5;
  for (const character of `${gameId}:${playerId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return rageQuitConfessions[hash % rageQuitConfessions.length].id;
}

export function isRageQuitConfessionId(value: unknown): value is RageQuitConfessionId {
  return typeof value === 'string' && rageQuitConfessions.some((confession) => confession.id === value);
}

export function isRageQuitReplyId(value: unknown): value is RageQuitReplyId {
  return typeof value === 'string' && rageQuitReplies.some((reply) => reply.id === value);
}

// Stored ids may come from a newer release; fall back instead of failing.
export function getRageQuitConfessionText(id: string) {
  return rageQuitConfessions.find((confession) => confession.id === id)?.text ?? "I can't handle losing.";
}

export function getRageQuitReplyText(id: string) {
  return rageQuitReplies.find((reply) => reply.id === id)?.text ?? 'Bye, Sucker!';
}

export function isSaltyAt(rageQuitAt: string | null | undefined, now: number) {
  if (!rageQuitAt) return false;
  const quitAt = new Date(rageQuitAt).getTime();
  return Number.isFinite(quitAt) && now - quitAt < rageQuitSaltDurationMs;
}
