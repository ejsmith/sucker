import { supabase } from './supabase';
import type { Database } from './database.types';
import type { MultiplayerAction, MultiplayerActionResult, RemoteTurnRow } from './types';
import { scoreCategories, type GameState, type ScoreCategory, toDice, toGameState, toHeldDice } from '../game';

type GameRow = Database['public']['Tables']['games']['Row'];
type TurnRow = Database['public']['Tables']['turns']['Row'];
type TurnActionRow = Database['public']['Tables']['turn_actions']['Row'];

export async function listMyGames() {
  const { data, error } = await supabase.from('games').select('*').order('updated_at', { ascending: false });

  if (error) {
    throw error;
  }

  const lastNudges = await loadLastNudges(data.map((game) => game.id));
  return data.map((game) => toRemoteGameRow(game, lastNudges.get(game.id) ?? null));
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
    throw new Error(await toFunctionErrorMessage(error));
  }
  if (!data) {
    throw new Error('Game action returned no data.');
  }

  return data;
}

export async function removeRemoteGame(gameId: string) {
  const { data, error } = await supabase.functions.invoke<{ removedGameId: string }>('game-action', {
    body: { gameId, type: 'remove_game' },
  });

  if (error) {
    throw new Error(await toFunctionErrorMessage(error));
  }
  if (!data) {
    throw new Error('Game action returned no data.');
  }

  return data;
}

async function toFunctionErrorMessage(error: unknown) {
  const response = toFunctionErrorResponse(error);
  const responseMessage = response ? await readFunctionErrorMessage(response) : null;
  if (responseMessage) {
    return responseMessage;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unable to update game.';
}

function toFunctionErrorResponse(error: unknown): Response | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object') {
    return null;
  }

  const response = context as Partial<Response>;
  return typeof response.json === 'function' && typeof response.text === 'function' ? (context as Response) : null;
}

async function readFunctionErrorMessage(response: Response): Promise<string | null> {
  try {
    const payload = (response.clone ? response.clone() : response) as Response;
    const body = await payload.json();
    if (body && typeof body === 'object') {
      const message = (body as { error?: unknown; message?: unknown }).error ?? (body as { message?: unknown }).message;
      if (typeof message === 'string' && message.length > 0) {
        return message;
      }
    }
  } catch {
    try {
      const message = await ((response.clone ? response.clone() : response) as Response).text();
      if (message.length > 0) {
        return message;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export async function createGameAgainst(opponentProfileId: string) {
  return applyMultiplayerAction({
    opponentProfileId,
    type: 'create_game',
  });
}

export async function createRematch(gameId: string) {
  return applyMultiplayerAction({
    gameId,
    type: 'rematch_game',
  });
}

export async function rollRemoteGame(gameId: string, held: GameState['held']) {
  return applyMultiplayerAction({ gameId, held, type: 'roll' });
}

export async function buyRemoteExtraRoll(gameId: string, held: GameState['held']) {
  return applyMultiplayerAction({ gameId, held, type: 'extra_roll' });
}

export async function scoreRemoteCategory(gameId: string, category: ScoreCategory, held: GameState['held']) {
  return applyMultiplayerAction({ category, gameId, held, type: 'score_category' });
}

export async function scratchRemoteCategory(gameId: string, category: ScoreCategory, held: GameState['held']) {
  return applyMultiplayerAction({ category, gameId, held, type: 'scratch_category' });
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

export async function nudgeRemoteGame(gameId: string) {
  return applyMultiplayerAction({ gameId, type: 'nudge_turn' });
}

export function subscribeToGame(
  gameId: string,
  onChange: (game: ReturnType<typeof toRemoteGameRow>) => void,
  onStatus?: (status: 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR') => void,
) {
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
    .subscribe((status) => {
      onStatus?.(status);
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToGameListChanges(
  onChange: () => void,
  onStatus?: (status: 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR') => void,
) {
  const channel = supabase
    .channel('games:list')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'games',
      },
      () => {
        onChange();
      },
    )
    .subscribe((status) => {
      onStatus?.(status);
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

async function loadLastNudges(gameIds: string[]) {
  if (gameIds.length === 0) {
    return new Map<string, string>();
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Map<string, string>();
  }

  const { data, error } = await supabase
    .from('turn_actions')
    .select('game_id, created_at')
    .eq('actor_id', user.id)
    .eq('action_type', 'nudge_turn')
    .in('game_id', gameIds)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const lastNudges = new Map<string, string>();
  for (const action of data as Pick<TurnActionRow, 'created_at' | 'game_id'>[]) {
    if (!lastNudges.has(action.game_id)) {
      lastNudges.set(action.game_id, action.created_at);
    }
  }

  return lastNudges;
}

function toRemoteGameRow(row: GameRow, lastNudgedAt: string | null = null) {
  return {
    completed_at: row.completed_at,
    created_at: row.created_at,
    created_by: row.created_by,
    current_player_id: row.current_player_id,
    id: row.id,
    last_turn_id: row.last_turn_id,
    last_nudged_at: lastNudgedAt,
    state: toGameState(row.state),
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
    held: toHeldDice(row.held),
    id: row.id,
    player_id: row.player_id,
    roll_count: row.roll_count,
    score: row.score,
    status: row.status,
    turn_index: row.turn_index,
  };
}

function toScoreCategory(value: string): ScoreCategory {
  if (!scoreCategories.includes(value as ScoreCategory)) {
    throw new Error(`Stored turn has invalid category: ${value}`);
  }

  return value as ScoreCategory;
}
