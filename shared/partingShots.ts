import { getForfeiterId, getWinnerId, type GameState } from './game';

// The last word after a played-out game. Each player may send one line, picked
// from a hand dealt out of the lines for their result. Forfeits get none: Rage
// Quit games keep their own single reply, and a timed-out player is gone.

export const winnerPartingShots = [
  { id: 'named-after-you', text: 'They named this game after you.' },
  { id: 'cant-mulligan', text: "You can't Mulligan this one." },
  { id: 'scoreboard', text: 'Scoreboard, Sucker.' },
  { id: 'born-every-game', text: "There's a Sucker born every game." },
  { id: 'rating-points', text: 'Thanks for the rating points.' },
  { id: 'fought-hard', text: "You fought hard. It didn't help." },
  { id: 'nice-try', text: 'Nice try. Well, a try.' },
  { id: 'ring-the-bell', text: "Ring the bell. It's over." },
  { id: 'could-win-asleep', text: "I could've won this one asleep." },
  { id: 'all-those-tokens', text: 'All those tokens, and for what?' },
  { id: 'signed-scorecard', text: 'Want a signed copy of my scorecard?' },
  { id: 'read-and-weep', text: 'Read it and weep, Sucker.' },
  { id: 'same-time-tomorrow', text: 'Same time tomorrow, Sucker?' },
  { id: 'highlight-reel', text: "That's going in my highlight reel." },
  { id: 'rematch-or-tissue', text: 'Rematch or tissue? Your call.' },
  { id: 'barely-needed-dice', text: 'I barely even needed the dice.' },
  { id: 'do-it-again', text: 'That was cute. Do it again.' },
  { id: 'dice-felt-bad', text: 'Even the dice felt bad for you.' },
  { id: 'more-extra-rolls', text: "Should've bought more Extra Rolls." },
  { id: 'tell-them', text: "Tell them you let me win. I'll nod." },
] as const;

export const loserPartingShots = [
  { id: 'got-lucky', text: 'You got lucky, Sucker.' },
  { id: 'wont-last', text: "Enjoy it. It won't last." },
  { id: 'mulligan-whole-game', text: "I'm Mulliganing this whole game." },
  { id: 'rematch-now', text: 'Rematch. Now.' },
  { id: 'dice-fired', text: 'My dice are fired.' },
  { id: 'loaded-dice', text: 'Those dice are definitely loaded.' },
  { id: 'nobody-impressed', text: "You won. Nobody's impressed." },
  { id: 'keep-your-tokens', text: "Keep your tokens. You'll need them." },
  { id: 'looked-sad', text: 'I let you win. You looked sad.' },
  { id: 'saving-punches', text: "I'm saving every punch for you." },
  { id: 'asterisk', text: 'Put an asterisk on that win.' },
  { id: 'not-a-strategy', text: "Luck isn't a strategy." },
  { id: 'beat-my-dice', text: 'You beat my dice, not me.' },
  { id: 'run-it-back-coward', text: 'Run it back, coward.' },
  { id: 'plotting', text: "I'm not mad. I'm plotting." },
  { id: 'isnt-over', text: "This isn't over, Sucker." },
  { id: 'recount', text: 'I demand a recount.' },
  { id: 'revenge-rematch', text: 'Revenge is a rematch away.' },
  { id: 'dice-manager', text: 'I want to speak to the dice manager.' },
  { id: 'dont-make-it-weird', text: "You won. Don't make it weird." },
] as const;

export const tiePartingShots = [
  { id: 'everybody-sucker', text: "Nobody wins. Everybody's a Sucker." },
  { id: 'dead-even', text: 'Dead even. For now.' },
  { id: 'run-it-back', text: 'Run it back.' },
  { id: 'no-mercy', text: 'Next time, no mercy.' },
  { id: 'count-it-win', text: "A tie? I'll take it as a win." },
  { id: 'didnt-lose', text: "Technically, I didn't lose." },
  { id: 'didnt-win', text: "Technically, you didn't win." },
  { id: 'better-personality', text: 'Same score. Better personality.' },
  { id: 'tied-with-you', text: 'Tied with you? Embarrassing.' },
  { id: 'dice-undecided', text: "The dice can't decide either." },
  { id: 'balanced', text: 'Perfectly balanced. Annoyingly so.' },
  { id: 'never-speak', text: "Let's never speak of this." },
  { id: 'two-suckers', text: 'Two Suckers. One score.' },
  { id: 'two-out-of-three', text: 'Best two out of three?' },
] as const;

const partingShotLines = [...winnerPartingShots, ...loserPartingShots, ...tiePartingShots];

export const partingShotHandSize = 4;

export type PartingShotLine = (typeof partingShotLines)[number];
export type PartingShotLineId = PartingShotLine['id'];

// Every line this player's result allows, or null once they have had their say.
// The server checks against this rather than the hand: an older app may deal
// differently after the lists grow, and any line for the result is harmless.
export function getPartingShotPool(game: GameState, playerId: string): readonly PartingShotLine[] | null {
  if (game.phase !== 'complete' || getForfeiterId(game) || !game.players.some((player) => player.id === playerId)) {
    return null;
  }
  if (game.partingShots?.some((shot) => shot.playerId === playerId)) return null;

  const winnerId = getWinnerId(game);
  return winnerId === null ? tiePartingShots : winnerId === playerId ? winnerPartingShots : loserPartingShots;
}

// The lines this player is offered. The hand is random per game and player but
// fixed for that pair, so reopening the sheet or switching devices can't redraw.
export function getPartingShotHand(game: GameState, playerId: string): readonly PartingShotLine[] | null {
  const pool = getPartingShotPool(game, playerId);
  if (!pool) return null;

  const lines = [...pool];
  let seed = hashText(`${game.id}:${playerId}`);
  for (let index = 0; index < partingShotHandSize; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const swapIndex = index + ((seed >>> 16) % (lines.length - index));
    [lines[index], lines[swapIndex]] = [lines[swapIndex], lines[index]];
  }
  return lines.slice(0, partingShotHandSize);
}

// FNV-1a.
function hashText(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

export function isPartingShotLineId(value: unknown): value is PartingShotLineId {
  return typeof value === 'string' && partingShotLines.some((line) => line.id === value);
}

// Stored ids may come from a newer release; fall back instead of failing.
export function getPartingShotText(lineId: string) {
  return partingShotLines.find((line) => line.id === lineId)?.text ?? 'Sucker!';
}
