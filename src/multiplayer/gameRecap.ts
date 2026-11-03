import type { Database } from '../../shared/database.types';
import { featCatalog, isFeatKey, type FeatDefinition, type FeatKey } from '../../shared/feats';
import type { GameState } from '../../shared/game';
import { buildGameRecap, type GameRecap, type GameRecapTurn } from '../../shared/gameRecap';
import type { SuckerStatAction, SuckerStatActionType } from '../../shared/stats';
import { supabase } from './supabase';

type GameRecapRow = Database['public']['Functions']['get_game_recap']['Returns'][number];

export type RecapFeat = FeatDefinition & { key: FeatKey };

export type PlayerRecapResult = {
  feats: RecapFeat[];
  ratingAfter: number | null;
  ratingBefore: number | null;
};

export type RemoteGameRecap = GameRecap & {
  results: Record<string, PlayerRecapResult>;
};

const recapActionTypes: SuckerStatActionType[] = [
  'extra_roll',
  'roll',
  'mulligan',
  'sucker_punch',
  'sucker_blocker',
  'score_category',
  'scratch_category',
];

export async function loadGameRecap(gameId: string, game: GameState): Promise<RemoteGameRecap> {
  const [turns, actions, recap] = await Promise.all([
    supabase
      .from('turns')
      .select('id, category, player_id, score, status, turn_index')
      .eq('game_id', gameId)
      .order('turn_index', { ascending: true }),
    supabase
      .from('turn_actions')
      .select('action_type, actor_id, payload')
      .eq('game_id', gameId)
      .in('action_type', recapActionTypes)
      .order('created_at', { ascending: true }),
    supabase.rpc('get_game_recap', { target_game_id: gameId }),
  ]);
  if (turns.error) throw turns.error;
  if (actions.error) throw actions.error;
  if (recap.error) throw recap.error;

  const rows = (recap.data ?? []) as GameRecapRow[];
  return {
    ...buildGameRecap({
      actions: (actions.data ?? []) as SuckerStatAction[],
      players: game.players,
      turns: (turns.data ?? []) as GameRecapTurn[],
    }),
    results: Object.fromEntries(
      rows.map((row) => [
        row.player_id,
        {
          feats: row.feat_keys.filter(isFeatKey).map((key) => ({ ...featCatalog[key], key })),
          ratingAfter: row.rating_after === null ? null : Number(row.rating_after),
          ratingBefore: row.rating_before === null ? null : Number(row.rating_before),
        },
      ]),
    ),
  };
}
