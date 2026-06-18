import { supabase } from './supabase';
import type { Database } from './database.types';
import type { MultiplayerAction, MultiplayerActionResult, RemoteTurnRow } from './types';
import { scoreCategories, type Dice, type GameState, type ScoreCategory } from '../game';

type GameRow = Database['public']['Tables']['games']['Row'];
type TurnRow = Database['public']['Tables']['turns']['Row'];

export async function listMyGames() {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data.map(toRemoteGameRow);
}

export async function getGame(gameId: string) {
  const { data, error } = await supabase.from('games').select('*').eq('id', gameId).single();

  if (error) {
    throw error;
  }

  return toRemoteGameRow(data);
}

export async function getTurn(turnId: string) {
  const { data, error } = await supabase.from('turns').select('*').eq('id', turnId).single();

  if (error) {
    throw error;
  }

  return toRemoteTurnRow(data);
}

export async function applyMultiplayerAction(action: MultiplayerAction): Promise<MultiplayerActionResult> {
  const { data, error } = await supabase.functions.invoke<MultiplayerActionResult>('game-action', {
    body: action,
  });

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error('Game action returned no data.');
  }

  return data;
}

export async function createGameAgainst(opponentProfileId: string) {
  return applyMultiplayerAction({
    opponentProfileId,
    type: 'create_game',
  });
}

export async function rollRemoteGame(gameId: string) {
  return applyMultiplayerAction({ gameId, type: 'roll' });
}

export async function buyRemoteExtraRoll(gameId: string) {
  return applyMultiplayerAction({ gameId, type: 'extra_roll' });
}

export async function toggleRemoteHold(gameId: string, dieIndex: number) {
  return applyMultiplayerAction({ dieIndex, gameId, type: 'toggle_hold' });
}

export async function scoreRemoteCategory(gameId: string, category: ScoreCategory) {
  return applyMultiplayerAction({ category, gameId, type: 'score_category' });
}

export async function scratchRemoteCategory(gameId: string, category: ScoreCategory) {
  return applyMultiplayerAction({ category, gameId, type: 'scratch_category' });
}

export async function passRemoteResponse(gameId: string) {
  return applyMultiplayerAction({ gameId, type: 'pass_response' });
}

export async function useRemoteMulligan(gameId: string) {
  return applyMultiplayerAction({ gameId, type: 'mulligan' });
}

export async function useRemoteSuckerPunch(gameId: string, turnId: string) {
  return applyMultiplayerAction({ gameId, turnId, type: 'sucker_punch' });
}

export async function useRemoteSuckerBlocker(gameId: string, turnId: string) {
  return applyMultiplayerAction({ gameId, turnId, type: 'sucker_blocker' });
}

export function subscribeToGame(gameId: string, onChange: (game: ReturnType<typeof toRemoteGameRow>) => void) {
  const channel = supabase
    .channel(`game:${gameId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        filter: `id=eq.${gameId}`,
        schema: 'public',
        table: 'games',
      },
      (payload) => {
        if (payload.new) {
          onChange(toRemoteGameRow(payload.new as GameRow));
        }
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

function toRemoteGameRow(row: GameRow) {
  return {
    completed_at: row.completed_at,
    created_at: row.created_at,
    created_by: row.created_by,
    current_player_id: row.current_player_id,
    id: row.id,
    last_turn_id: row.last_turn_id,
    state: row.state as unknown as GameState,
    status: row.status,
    updated_at: row.updated_at,
    winner_id: row.winner_id,
  };
}

function toRemoteTurnRow(row: TurnRow): RemoteTurnRow {
  return {
    category: toScoreCategory(row.category),
    created_at: row.created_at,
    dice: toDice(row.dice),
    finalized_at: row.finalized_at,
    game_id: row.game_id,
    held: row.held,
    id: row.id,
    player_id: row.player_id,
    roll_count: row.roll_count,
    score: row.score,
    status: row.status,
    turn_index: row.turn_index,
  };
}

function toDice(values: number[]): Dice {
  if (values.length !== 5 || values.some((value) => value < 1 || value > 6)) {
    throw new Error('Stored turn has invalid dice.');
  }

  return values as Dice;
}

function toScoreCategory(value: string): ScoreCategory {
  if (!scoreCategories.includes(value as ScoreCategory)) {
    throw new Error(`Stored turn has invalid category: ${value}`);
  }

  return value as ScoreCategory;
}
