import { categoryLabels, toScoreCategory, type GameState } from '../../shared/game';
import type { GameRecapTurn } from '../../shared/gameRecap';
import { getPartingShotText } from '../../shared/partingShots';
import { getRageQuitReplyText } from '../../shared/rageQuit';
import { taunts, type TauntId, type TauntScenario } from '../../shared/taunts';

export type TrashTalkTaunt = {
  actorId: string;
  createdAt: string;
  // The moment it answered, as offered when sent. Older taunts may lack it.
  scenario?: TauntScenario | null;
  tauntId: TauntId;
  turnId: string | null;
};

// One line in a game's trash talk, oldest first. Events are what the players
// did rather than said, like a Rage Quit.
export type TrashTalkEntry =
  | { key: string; kind: 'line'; note: string | null; playerId: string; text: string }
  | { key: string; kind: 'event'; text: string };

// Taunts as they were sent, then how the game ended: a Rage Quit and its
// reply, a timeout, or the players' last words.
export function buildTrashTalk({
  game,
  nameOf = (playerId) => game.players.find((player) => player.id === playerId)?.name ?? 'Opponent',
  taunts: sent,
  turns,
}: {
  game: GameState;
  // How the page names each player, e.g. "You" for the viewer.
  nameOf?: (playerId: string) => string;
  taunts: TrashTalkTaunt[];
  turns: GameRecapTurn[];
}): TrashTalkEntry[] {
  const entries: TrashTalkEntry[] = [...sent]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((taunt, index) => ({
      key: `taunt-${index}`,
      kind: 'line',
      note: describeTauntMoment(taunt, turns),
      playerId: taunt.actorId,
      text: taunts.find((candidate) => candidate.id === taunt.tauntId)?.text ?? 'Sucker!',
    }));

  if (game.rageQuit) {
    entries.push({ key: 'rage-quit', kind: 'event', text: `${nameOf(game.rageQuit.playerId)} rage quit.` });
    const winner = game.players.find((player) => player.id !== game.rageQuit?.playerId);
    if (game.rageQuit.replyId && winner) {
      entries.push({
        key: 'rage-quit-reply',
        kind: 'line',
        note: 'Reply',
        playerId: winner.id,
        text: getRageQuitReplyText(game.rageQuit.replyId),
      });
    }
  }
  if (game.timedOut) {
    entries.push({ key: 'timed-out', kind: 'event', text: `${nameOf(game.timedOut.playerId)} ran out of time.` });
  }
  for (const [index, shot] of (game.partingShots ?? []).entries()) {
    entries.push({
      key: `last-word-${index}`,
      kind: 'line',
      note: 'Last word',
      playerId: shot.playerId,
      text: getPartingShotText(shot.lineId),
    });
  }
  return entries;
}

// "Round 7 · after 25 on Full house". A round is a player's nth box: a punched
// or mulliganed turn and its replay share one.
function describeTauntMoment(taunt: TrashTalkTaunt, turns: GameRecapTurn[]) {
  const turn = turns.find((candidate) => candidate.id === taunt.turnId);
  if (!turn) return null;

  const round =
    1 +
    turns.filter(
      (other) =>
        other.player_id === turn.player_id &&
        other.turn_index < turn.turn_index &&
        other.status !== 'punched' &&
        other.status !== 'mulliganed',
    ).length;
  // A taunt on the other player's turn followed a punch at it. The scenario
  // saved with the taunt says how the punch went; older taunts fall back to
  // whether the turn ended up punched.
  const box = categoryLabels[toScoreCategory(turn.category)];
  const landed = taunt.scenario ? taunt.scenario === 'punch-landed' : turn.status === 'punched';
  const moment =
    turn.player_id !== taunt.actorId
      ? landed
        ? 'after landing a Sucker Punch'
        : 'after a missed Sucker Punch'
      : turn.roll_count === 0
        ? `after a Sucker Deal on ${box}`
        : `after ${turn.score} on ${box}`;
  return `Round ${round} · ${moment}`;
}
