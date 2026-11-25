import { featCatalog, isFeatKey, type FeatDefinition, type FeatKey } from '../../shared/feats';
import { toGameState, type GameState } from '../../shared/game';
import { buildGameRecap, type GameRecap, type GameRecapTurn } from '../../shared/gameRecap';
import type { SuckerStatAction } from '../../shared/stats';
import { isTauntId, type TauntId } from '../../shared/taunts';
import { getSafeAvatarUrl } from './profiles';
import { supabase } from './supabase';

export type RecapFeat = FeatDefinition & { key: FeatKey };

export type PlayerRecapResult = {
  feats: RecapFeat[];
  ratingAfter: number | null;
  ratingBefore: number | null;
};

export type RecapProfile = {
  avatarUrl: string | null;
  id: string;
  name: string;
  username: string | null;
};

// A taunt sent during the game. Its turn is the one it answered: the sender's
// own turn, or the turn they punched.
export type RecapTaunt = {
  actorId: string;
  createdAt: string;
  tauntId: TauntId;
  turnId: string | null;
};

export type RemoteGameRecap = GameRecap & {
  completedAt: string | null;
  game: GameState;
  id: string;
  profiles: Record<string, RecapProfile>;
  results: Record<string, PlayerRecapResult>;
  taunts: RecapTaunt[];
  turns: GameRecapTurn[];
};

type RecapPayload = {
  actions?: (SuckerStatAction & { created_at: string; turn_id: string | null })[];
  game: { completed_at: string | null; id: string; state: unknown };
  players?: {
    avatar_url: string | null;
    display_name: string;
    feat_keys: string[] | null;
    player_id: string;
    rating_after: number | string | null;
    rating_before: number | string | null;
    username: string | null;
  }[];
  turns?: GameRecapTurn[];
};

// Any finished game, read whole in one call: the player's own, or one opened
// from a leaderboard or someone else's profile.
export async function loadGameRecap(gameId: string): Promise<RemoteGameRecap> {
  const { data, error } = await supabase.rpc('get_game_recap', { target_game_id: gameId });
  if (error) throw error;

  const payload = data as unknown as RecapPayload;
  const game = toGameState(payload.game.state);
  const actions = payload.actions ?? [];
  const turns = payload.turns ?? [];
  const players = payload.players ?? [];
  const toRating = (value: number | string | null) => (value === null ? null : Number(value));

  return {
    ...buildGameRecap({ actions, players: game.players, turns }),
    completedAt: payload.game.completed_at,
    game,
    id: payload.game.id,
    profiles: Object.fromEntries(
      game.players.map((player) => {
        const row = players.find((candidate) => candidate.player_id === player.id);
        return [
          player.id,
          {
            avatarUrl: getSafeAvatarUrl(row?.avatar_url, player.id),
            id: player.id,
            name: row?.display_name ?? player.name,
            username: row?.username ?? null,
          },
        ];
      }),
    ),
    results: Object.fromEntries(
      players.map((row) => [
        row.player_id,
        {
          feats: (row.feat_keys ?? []).filter(isFeatKey).map((key) => ({ ...featCatalog[key], key })),
          ratingAfter: toRating(row.rating_after),
          ratingBefore: toRating(row.rating_before),
        },
      ]),
    ),
    taunts: actions.flatMap((action) => {
      if (action.action_type !== ('taunt' as string)) return [];
      const tauntId = (action.payload as { tauntId?: unknown } | null)?.tauntId;
      return isTauntId(tauntId)
        ? [{ actorId: action.actor_id, createdAt: action.created_at, tauntId, turnId: action.turn_id }]
        : [];
    }),
    turns,
  };
}
