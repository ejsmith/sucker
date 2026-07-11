import {
  createEmptyScorecard,
  type Dice,
  type GameState,
  type Player,
  type ScoreCategory,
  type SuckerPunchOutcome,
  suckerTokenCosts,
  toScoreCategory,
  totalScore,
  upperBonus,
} from './game.ts';

export const blowoutPointMargin = 75;
export const comebackPointMargin = 50;
const retiredSuckerBlockerTokenCost = 3;

export type SuckerStatActionType = 'extra_roll' | 'roll' | 'mulligan' | 'sucker_punch' | 'sucker_blocker';

export type SuckerStatAction = {
  action_type: SuckerStatActionType;
  actor_id: string;
  payload?: unknown;
};

export type SuckerStatTurn = {
  category: string;
  player_id: string;
  score: number;
  status?: 'submitted' | 'punched' | 'blocked' | 'mulliganed' | 'finalized';
  turn_id?: string | null;
  turn_index: number;
};

export type SuckerActionStats = {
  extra_rolls_used: number;
  forced_rerolls: number;
  mulligans_used: number;
  sucker_blockers_used: number;
  sucker_hunt_misses: number;
  sucker_hunts: number;
  sucker_punches_received: number;
  sucker_punches_used: number;
  sucker_tokens_spent: number;
};

export function createEmptySuckerActionStats(): SuckerActionStats {
  return {
    extra_rolls_used: 0,
    forced_rerolls: 0,
    mulligans_used: 0,
    sucker_blockers_used: 0,
    sucker_hunt_misses: 0,
    sucker_hunts: 0,
    sucker_punches_received: 0,
    sucker_punches_used: 0,
    sucker_tokens_spent: 0,
  };
}

export function buildCompletedPlayerStats({
  actions,
  gameId,
  opponent,
  player,
  players,
  turns,
  winnerId,
}: {
  actions: SuckerStatAction[];
  gameId: string;
  opponent: Player;
  player: Player;
  players: Player[];
  turns: SuckerStatTurn[];
  winnerId: string | null;
}) {
  const actionStats = calculateSuckerActionStats(actions, player.id);
  const playerScore = totalScore(player.scorecard);
  const opponentScore = totalScore(opponent.scorecard);
  const won = player.id === winnerId;
  const blowoutMargin = Math.abs(playerScore - opponentScore) >= blowoutPointMargin;

  return {
    ...actionStats,
    blowout_loss: !won && blowoutMargin ? 1 : 0,
    blowout_win: won && blowoutMargin ? 1 : 0,
    buzzer_beater_win: won && didPlayerPullAheadOnFinalTurn(turns, players, player.id) ? 1 : 0,
    comeback_win: won && didPlayerComeBack(turns, players, player.id) ? 1 : 0,
    final_score: playerScore,
    four_of_a_kind_count: scoredPositive(player.scorecard.fourOfAKind),
    full_house_count: scoredPositive(player.scorecard.fullHouse),
    game_id: gameId,
    large_straight_count: scoredPositive(player.scorecard.largeStraight),
    opponent_id: opponent.id,
    player_id: player.id,
    small_straight_count: scoredPositive(player.scorecard.smallStraight),
    sucker_count: scoredPositive(player.scorecard.sucker),
    sucker_tokens_leftover: player.suckerTokens,
    three_of_a_kind_count: scoredPositive(player.scorecard.threeOfAKind),
    upper_bonus_awarded: upperBonus(player.scorecard) > 0,
    won,
  };
}

export function calculateSuckerActionStats(actions: SuckerStatAction[], playerId: string): SuckerActionStats {
  const stats = createEmptySuckerActionStats();
  let pendingSuckerHunts = 0;

  for (const action of actions) {
    if (action.actor_id === playerId) {
      switch (action.action_type) {
        case 'extra_roll':
          stats.extra_rolls_used += 1;
          stats.sucker_tokens_spent += suckerTokenCosts.extraRoll;
          if (actionPayloadBoolean(action.payload, 'suckerHunt')) {
            stats.sucker_hunts += 1;
            pendingSuckerHunts += 1;
          }
          break;
        case 'mulligan':
          stats.mulligans_used += 1;
          stats.sucker_tokens_spent += suckerTokenCosts.mulligan;
          break;
        case 'sucker_blocker':
          stats.sucker_blockers_used += 1;
          stats.sucker_tokens_spent += retiredSuckerBlockerTokenCost;
          break;
        case 'sucker_punch':
          stats.sucker_punches_used += 1;
          stats.sucker_tokens_spent += suckerTokenCosts.suckerPunch;
          break;
        default:
          break;
      }
    }

    if (action.actor_id === playerId && action.action_type === 'roll' && pendingSuckerHunts > 0) {
      pendingSuckerHunts -= 1;
      if (!actionPayloadHasSuckerDice(action.payload)) {
        stats.sucker_hunt_misses += 1;
      }
    }

    if (action.action_type === 'sucker_punch' && actionPayloadValue(action.payload, 'targetPlayerId') === playerId) {
      stats.sucker_punches_received += 1;
      if (actionPayloadValue(action.payload, 'landed') !== false) {
        stats.forced_rerolls += 1;
      }
    }
  }

  return stats;
}

export function didPlayerComeBack(turns: SuckerStatTurn[], players: Player[], playerId: string) {
  const scorecards = Object.fromEntries(players.map((player) => [player.id, createEmptyScorecard()]));
  const orderedTurns = getEffectiveStatTurns(turns);

  for (const turn of orderedTurns) {
    const scorecard = scorecards[turn.player_id];
    if (!scorecard) {
      continue;
    }

    scorecard[toScoreCategory(turn.category)] = turn.score;
    const playerScore = totalScore(scorecards[playerId]);
    const trailedByMargin = players.some(
      (player) => player.id !== playerId && totalScore(scorecards[player.id]) - playerScore >= comebackPointMargin,
    );
    if (trailedByMargin) {
      return true;
    }
  }

  return false;
}

export function didPlayerPullAheadOnFinalTurn(turns: SuckerStatTurn[], players: Player[], playerId: string) {
  const scorecards = Object.fromEntries(players.map((player) => [player.id, createEmptyScorecard()]));
  const orderedTurns = getEffectiveStatTurns(turns);
  const lastPlayerTurn = [...orderedTurns].reverse().find((turn) => turn.player_id === playerId);
  if (!lastPlayerTurn) {
    return false;
  }

  for (const turn of orderedTurns) {
    const scorecard = scorecards[turn.player_id];
    if (!scorecard) {
      continue;
    }

    if (turn === lastPlayerTurn) {
      const playerScoreBefore = totalScore(scorecards[playerId]);
      const opponentScore = Math.max(
        ...players.filter((player) => player.id !== playerId).map((player) => totalScore(scorecards[player.id])),
      );
      scorecard[toScoreCategory(turn.category)] = turn.score;
      return playerScoreBefore <= opponentScore && totalScore(scorecards[playerId]) > opponentScore;
    }

    scorecard[toScoreCategory(turn.category)] = turn.score;
  }

  return false;
}

function getEffectiveStatTurns(turns: SuckerStatTurn[]) {
  return [...turns]
    .filter(
      (turn) => !turn.status || turn.status === 'submitted' || turn.status === 'blocked' || turn.status === 'finalized',
    )
    .sort((left, right) => left.turn_index - right.turn_index);
}

export function buildExtraRollActionPayload(game: GameState, playerId: string) {
  return { suckerHunt: isSuckerHuntExtraRoll(game, playerId) };
}

export function buildRollActionPayload(dice: Dice) {
  return { dice };
}

export function buildSuckerPunchActionPayload(
  targetPlayerId: string,
  outcome?: SuckerPunchOutcome | null,
  targetTurn?: { id?: string | null; turnIndex?: number | null },
) {
  return {
    targetPlayerId,
    ...(targetTurn?.id ? { targetTurnId: targetTurn.id, turnId: targetTurn.id } : {}),
    ...(typeof targetTurn?.turnIndex === 'number' ? { targetTurnIndex: targetTurn.turnIndex } : {}),
    ...(outcome
      ? {
          chanceDie: outcome.chanceDie,
          chancePercent: outcome.chancePercent,
          landed: outcome.landed,
          rollPercent: outcome.rollPercent,
        }
      : {}),
  };
}

export function isSuckerHuntExtraRoll(game: GameState, playerId: string) {
  const player = game.players.find((candidate) => candidate.id === playerId);
  return Boolean(player?.scorecard.sucker === null && maxMatchingDice(game.dice) >= 4);
}

export function isSuckerDice(dice: Dice) {
  return dice.every((die) => die === dice[0]);
}

export function maxMatchingDice(dice: Dice) {
  return Math.max(...dice.map((face) => dice.filter((die) => die === face).length));
}

function scoredPositive(score: number | null) {
  return score !== null && score > 0 ? 1 : 0;
}

function actionPayloadBoolean(payload: unknown, key: string) {
  return actionPayloadValue(payload, key) === true;
}

function actionPayloadHasSuckerDice(payload: unknown) {
  const dice = actionPayloadValue(payload, 'dice');
  return Array.isArray(dice) && dice.length === 5 && dice.every((die) => die === dice[0]);
}

function actionPayloadValue(payload: unknown, key: string) {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined;
}
