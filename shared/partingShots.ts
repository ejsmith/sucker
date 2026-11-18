import { getWinnerId, type GameState, type PartingShot } from './game';

// The last word after a played-out game. Each player may send one shot, picked
// from the lines for their result, and one comeback once the other player's
// shot lands. Rage Quit games keep their own single reply instead.

export const winnerPartingShots = [
  { id: 'gg-mostly', text: 'GG. Mostly the second G.' },
  { id: 'thanks-tokens', text: 'Thanks for the tokens, Sucker.' },
  { id: 'same-time-tomorrow', text: 'Same time tomorrow?' },
  { id: 'dice-pitied', text: 'Even the dice pitied you.' },
] as const;

export const loserPartingShots = [
  { id: 'got-lucky', text: 'You got lucky, Sucker.' },
  { id: 'rematch-now', text: 'Rematch. Now.' },
  { id: 'wont-last', text: "Enjoy it. It won't last." },
  { id: 'going-easy', text: 'I was going easy on you.' },
] as const;

export const tiePartingShots = [
  { id: 'everybody-sucker', text: "Nobody wins. Everybody's a Sucker." },
  { id: 'run-it-back', text: 'Run it back.' },
  { id: 'dead-even', text: 'Dead even. For now.' },
  { id: 'no-mercy', text: 'Next time, no mercy.' },
] as const;

export const partingComebacks = [
  { id: 'cute', text: 'Cute.' },
  { id: 'says-the-sucker', text: 'Says the Sucker.' },
  { id: 'screenshot-taken', text: 'Screenshot taken.' },
  { id: 'talk-is-cheap', text: "Talk is cheap. Tokens aren't." },
] as const;

const partingShotLines = [...winnerPartingShots, ...loserPartingShots, ...tiePartingShots, ...partingComebacks];

export type PartingShotLine = (typeof partingShotLines)[number];
export type PartingShotLineId = PartingShotLine['id'];
export type PartingShotOptions = {
  kind: PartingShot['kind'];
  lines: readonly PartingShotLine[];
};

// What this player may still send, or null once they have said their piece.
// A waiting comeback comes first, so the reply sits next to what it answers.
export function getPartingShotOptions(game: GameState, playerId: string): PartingShotOptions | null {
  if (game.phase !== 'complete' || game.rageQuit || !game.players.some((player) => player.id === playerId)) {
    return null;
  }

  const shots = game.partingShots ?? [];
  const hasSent = (kind: PartingShot['kind']) => shots.some((shot) => shot.playerId === playerId && shot.kind === kind);
  if (!hasSent('comeback') && shots.some((shot) => shot.playerId !== playerId && shot.kind === 'shot')) {
    return { kind: 'comeback', lines: partingComebacks };
  }
  if (hasSent('shot')) return null;

  const winnerId = getWinnerId(game);
  return {
    kind: 'shot',
    lines: winnerId === null ? tiePartingShots : winnerId === playerId ? winnerPartingShots : loserPartingShots,
  };
}

export function isPartingShotLineId(value: unknown): value is PartingShotLineId {
  return typeof value === 'string' && partingShotLines.some((line) => line.id === value);
}

// Stored ids may come from a newer release; fall back instead of failing.
export function getPartingShotText(lineId: string) {
  return partingShotLines.find((line) => line.id === lineId)?.text ?? 'Sucker!';
}
