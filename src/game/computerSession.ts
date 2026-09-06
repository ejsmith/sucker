import { toDice, toGameState, toScoreCategory, type GameState } from '../../shared/game';
import type { SuckerStatAction, SuckerStatTurn } from '../../shared/stats';
import type { LocalPendingTurn } from './computer';

export type ComputerSession = {
  version: 1;
  game: GameState;
  pendingTurn: LocalPendingTurn | null;
  actions: SuckerStatAction[];
  turns: SuckerStatTurn[];
  recordedGameIds: string[];
};

export function computerSessionKey(profileId: string | null) {
  return `sucker.computer-session.v1.${profileId ?? 'guest'}`;
}

export function parseComputerSession(serialized: string): ComputerSession {
  const value = JSON.parse(serialized);
  if (!value || value.version !== 1) throw new Error('Unsupported computer save version.');
  const game = toGameState(value.game);
  if (game.players.length !== 2) throw new Error('Invalid computer save players.');
  const pending = value.pendingTurn;
  let pendingTurn: LocalPendingTurn | null = null;
  if (pending !== null) {
    if (
      !pending ||
      typeof pending.id !== 'string' ||
      typeof pending.hadSuckerBonus !== 'boolean' ||
      ![0, 1].includes(pending.scorerIndex) ||
      ![0, 1].includes(pending.responderIndex) ||
      pending.scorerIndex === pending.responderIndex ||
      (pending.puncherIndex !== undefined && ![0, 1].includes(pending.puncherIndex)) ||
      !['submitted', 'punched'].includes(pending.status) ||
      !Number.isFinite(pending.score) ||
      pending.score < 0 ||
      typeof pending.category !== 'string'
    )
      throw new Error('Invalid saved response opportunity.');
    pendingTurn = { ...pending, category: toScoreCategory(pending.category), dice: toDice(pending.dice) };
  }
  if (
    !Array.isArray(value.actions) ||
    !value.actions.every(
      (action: SuckerStatAction) =>
        action &&
        typeof action.actor_id === 'string' &&
        ['extra_roll', 'roll', 'mulligan', 'sucker_punch', 'sucker_blocker'].includes(action.action_type),
    )
  ) {
    throw new Error('Invalid saved action history.');
  }
  if (
    !Array.isArray(value.turns) ||
    !value.turns.every(
      (turn: SuckerStatTurn) =>
        turn &&
        typeof turn.player_id === 'string' &&
        typeof turn.category === 'string' &&
        Number.isFinite(turn.score) &&
        turn.score >= 0 &&
        Number.isInteger(turn.turn_index) &&
        turn.turn_index >= 1 &&
        (turn.status === undefined ||
          ['submitted', 'punched', 'blocked', 'mulliganed', 'finalized'].includes(turn.status)),
    )
  ) {
    throw new Error('Invalid saved turn history.');
  }
  if (!Array.isArray(value.recordedGameIds) || !value.recordedGameIds.every((id: unknown) => typeof id === 'string')) {
    throw new Error('Invalid saved result history.');
  }
  return {
    version: 1,
    game,
    pendingTurn,
    actions: value.actions,
    turns: value.turns,
    recordedGameIds: value.recordedGameIds,
  };
}
