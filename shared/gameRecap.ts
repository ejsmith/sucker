import {
  createEmptyScorecard,
  suckerTokenCosts,
  toScoreCategory,
  totalScore,
  type Player,
  type ScoreCategory,
} from './game';
import { calculateSuckerActionStats, getEffectiveStatTurns, type SuckerStatAction, type SuckerStatTurn } from './stats';

export type GameRecapTurn = SuckerStatTurn & { id: string };

export type ScoredBox = { category: ScoreCategory; score: number };

export type PlayerGameRecap = {
  playerId: string;
  punches: {
    biggestHit: ScoredBox | null;
    counterpunchesLanded: number;
    landed: number;
    thrown: number;
  };
  moments: {
    bestTurn: ScoredBox | null;
    suckerDeals: number;
    suckersRolled: number;
  };
  tokens: {
    earned: number;
    extraRolls: number;
    left: number;
    mulligans: number;
    punches: number;
    spent: number;
  };
};

export type GameRecap = {
  biggestLead: { playerId: string; points: number } | null;
  leadChanges: number;
  players: PlayerGameRecap[];
};

// What happened in one finished game, replayed from the same turns and actions
// that feed stats and feats.
export function buildGameRecap({
  actions,
  players,
  turns,
}: {
  actions: SuckerStatAction[];
  players: Player[];
  turns: GameRecapTurn[];
}): GameRecap {
  const turnsById = new Map(turns.map((turn) => [turn.id, turn]));
  const effectiveTurns = getEffectiveStatTurns(turns);

  return {
    ...scoreSwings(effectiveTurns, players),
    players: players.map((player) => {
      const own = actions.filter((action) => action.actor_id === player.id);
      const punches = own.filter((action) => action.action_type === 'sucker_punch');
      const landed = punches.filter((action) => payloadValue(action.payload, 'landed') !== false);
      const stats = calculateSuckerActionStats(actions, player.id);
      const extraRolls = stats.extra_rolls_used * suckerTokenCosts.extraRoll;
      const mulligans = stats.mulligans_used * suckerTokenCosts.mulligan;
      const suckerDeals = own.filter((action) => action.action_type === 'scratch_category').length;

      return {
        playerId: player.id,
        punches: {
          biggestHit: highestBox(
            landed.flatMap((action) => {
              const turn = turnsById.get(String(payloadValue(action.payload, 'targetTurnId')));
              return turn ? [turn] : [];
            }),
          ),
          counterpunchesLanded: landed.filter((action) => payloadValue(action.payload, 'isCounterPunch') === true)
            .length,
          landed: landed.length,
          thrown: punches.length,
        },
        moments: {
          bestTurn: highestBox(effectiveTurns.filter((turn) => turn.player_id === player.id)),
          suckerDeals,
          suckersRolled: own.filter((action) => action.action_type === 'roll' && isFiveOfAKind(action.payload)).length,
        },
        tokens: {
          earned: suckerDeals,
          extraRolls,
          left: player.suckerTokens,
          mulligans,
          punches: stats.sucker_tokens_spent - extraRolls - mulligans,
          spent: stats.sucker_tokens_spent,
        },
      };
    }),
  };
}

// Lead changes count only when a different player takes a real lead; a tie
// in between does not change who led last.
function scoreSwings(turns: SuckerStatTurn[], players: Player[]) {
  const [first, second] = players;
  if (!first || !second) return { biggestLead: null, leadChanges: 0 };

  const scorecards = { [first.id]: createEmptyScorecard(), [second.id]: createEmptyScorecard() };
  let biggestLead: GameRecap['biggestLead'] = null;
  let leadChanges = 0;
  let leaderId: string | null = null;

  for (const turn of turns) {
    const scorecard = scorecards[turn.player_id];
    if (!scorecard) continue;
    scorecard[toScoreCategory(turn.category)] = turn.score;

    const lead = totalScore(scorecards[first.id]) - totalScore(scorecards[second.id]);
    if (lead === 0) continue;
    const nextLeaderId = lead > 0 ? first.id : second.id;
    if (leaderId && nextLeaderId !== leaderId) leadChanges += 1;
    leaderId = nextLeaderId;
    if (!biggestLead || Math.abs(lead) > biggestLead.points) {
      biggestLead = { playerId: nextLeaderId, points: Math.abs(lead) };
    }
  }

  return { biggestLead, leadChanges };
}

function highestBox(turns: SuckerStatTurn[]): ScoredBox | null {
  const best = turns.reduce<SuckerStatTurn | null>(
    (top, turn) => (turn.score > 0 && (!top || turn.score > top.score) ? turn : top),
    null,
  );
  return best ? { category: toScoreCategory(best.category), score: best.score } : null;
}

function isFiveOfAKind(payload: unknown) {
  const dice = payloadValue(payload, 'dice');
  return Array.isArray(dice) && dice.length === 5 && dice.every((die) => die === dice[0]);
}

function payloadValue(payload: unknown, key: string) {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined;
}
