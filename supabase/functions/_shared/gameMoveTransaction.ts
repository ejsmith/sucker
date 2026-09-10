import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Database } from './database.types.ts';
import type { Json } from '../../../shared/database.types.ts';

type GameRow = Database['public']['Tables']['games']['Row'];
type MoveTable =
  | 'turns'
  | 'turn_actions'
  | 'token_events'
  | 'game_players'
  | 'game_player_results'
  | 'head_to_head_stats';
export type GameMoveWrite = {
  table: MoveTable;
  operation: 'insert' | 'update' | 'upsert';
  data: Record<string, unknown>;
  match?: Record<string, unknown>;
};
export type GameMovePlan = {
  original: GameRow;
  patch: Database['public']['Tables']['games']['Update'];
  writes: GameMoveWrite[];
};

export function planGameMove(original: GameRow, patch: GameMovePlan['patch']): GameMovePlan {
  return { original, patch, writes: [] };
}

export async function commitGameMove<Result extends { game: GameRow }>(
  admin: SupabaseClient<Database>,
  plan: GameMovePlan,
  actorId: string,
  requestId: string,
  result: Result,
) {
  const { data, error } = await admin.rpc('commit_game_move', {
    p_actor_id: actorId,
    p_request_id: requestId,
    p_game_id: plan.original.id,
    p_expected_updated_at: plan.original.updated_at,
    p_game_patch: plan.patch as unknown as Json,
    p_writes: plan.writes as unknown as Json,
    p_result: result as unknown as Json,
  });
  if (error) throw error;
  return data as unknown as Result;
}
