import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import { supabase } from './supabase';
import type { Database } from './database.types';
import type { MultiplayerAction, MultiplayerActionResult, RemoteTurnRow } from './types';
import {
  scoreCategories,
  type DieValue,
  type GameState,
  type ScoreCategory,
  toDice,
  toGameState,
  toHeldDice,
} from '../game';
import { calculateSuckerActionStats, type SuckerStatAction } from '../../shared/stats';
import { reportError } from '../monitoring/exceptionless';
import {
  createOrReuseActionRequest,
  selectActionRequestsForRecovery,
  toMultiplayerAction,
  type ActionRequest,
  type RecoveredMultiplayerAction,
} from './actionRecovery';
import { createGameListRealtimeTopic } from './realtimeTopics';

type GameRow = Database['public']['Tables']['games']['Row'];
type TurnRow = Database['public']['Tables']['turns']['Row'];
type TurnActionRow = Database['public']['Tables']['turn_actions']['Row'];
const pendingActionsKey = 'sucker:pending-multiplayer-actions:v2';
const pendingActionMaxAgeMs = 5 * 60_000;
const retryDelaysMs = [350, 900];
let pendingStorageOperation: Promise<unknown> = Promise.resolve();
const recoveryPromises = new Map<string, Promise<RecoveredMultiplayerAction[]>>();

export class PendingMultiplayerActionError extends Error {
  constructor(
    message: string,
    readonly requestId: string,
  ) {
    super(message);
    this.name = 'PendingMultiplayerActionError';
  }
}

export async function listMyGames() {
  const [{ data: activeGames, error: activeError }, { data: completedGames, error: completedError }] =
    await Promise.all([
      supabase.from('games').select('*').neq('status', 'complete').order('updated_at', { ascending: false }),
      supabase
        .from('games')
        .select('*')
        .eq('status', 'complete')
        .order('completed_at', { ascending: false, nullsFirst: false })
        .order('updated_at', { ascending: false })
        .limit(25),
    ]);

  if (activeError) {
    throw activeError;
  }
  if (completedError) {
    throw completedError;
  }

  const data = [...(activeGames ?? []), ...(completedGames ?? [])];

  const gameIds = data.map((game) => game.id);
  const completedGameIds = (completedGames ?? []).map((game) => game.id);
  const [lastNudges, suckerTokensSpent] = await Promise.all([
    loadLastNudges(gameIds),
    loadSuckerTokensSpent(completedGameIds),
  ]);
  return data.map((game) =>
    toRemoteGameRow(game, lastNudges.get(game.id) ?? null, suckerTokensSpent.get(game.id) ?? {}),
  );
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

export async function getLatestRemoteBlockedSuckerPunch(
  gameId: string,
  targetPlayerId: string,
  targetTurnIndex: number,
) {
  const { data, error } = await supabase
    .from('turn_actions')
    .select('id, actor_id, created_at, payload')
    .eq('game_id', gameId)
    .eq('action_type', 'sucker_punch')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    throw error;
  }

  return (
    (data as Pick<TurnActionRow, 'actor_id' | 'created_at' | 'id' | 'payload'>[] | null)?.find((action) => {
      const payload = action.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return false;
      }

      const values = payload as Record<string, unknown>;
      return (
        values.targetPlayerId === targetPlayerId &&
        values.landed === false &&
        values.targetTurnIndex === targetTurnIndex
      );
    }) ?? null
  );
}

export async function applyMultiplayerAction(action: MultiplayerAction): Promise<MultiplayerActionResult> {
  return invokeReliableAction<MultiplayerActionResult>(action);
}

export async function removeRemoteGame(gameId: string) {
  return invokeReliableAction<{ removedGameId: string }>({ gameId, type: 'remove_game' });
}

export function recoverPendingMultiplayerActions(actorId: string) {
  const activeRecovery = recoveryPromises.get(actorId);
  if (activeRecovery) {
    return activeRecovery;
  }

  const recovery = recoverPendingActions(actorId).finally(() => {
    recoveryPromises.delete(actorId);
  });
  recoveryPromises.set(actorId, recovery);
  return recovery;
}

export function listPendingMultiplayerActions(actorId: string) {
  return getPendingActionsForRecovery(actorId);
}

export async function hasPendingMultiplayerAction(actorId: string, requestId: string) {
  const pending = await getPendingActionsForRecovery(actorId);
  return pending.some((request) => request.requestId === requestId);
}

async function invokeReliableAction<TResult>(action: MultiplayerAction): Promise<TResult> {
  const networkState = await NetInfo.fetch();
  if (networkState.isConnected === false || networkState.isInternetReachable === false) {
    throw new Error('You are offline. Reconnect before making a game move.');
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user.id) {
    throw new Error('Sign in before making a game move.');
  }

  const { hasPayloadConflict, request } = await getOrCreatePendingAction(session.user.id, action);
  if (hasPayloadConflict) {
    throw new PendingMultiplayerActionError(
      'Confirming your previous move before applying new dice selections.',
      request.requestId,
    );
  }

  try {
    const result = await invokeActionRequest<TResult>(request);
    await removePendingAction(request.requestId);
    return result;
  } catch (error) {
    if (isRetryableActionError(error)) {
      void reportError(error, {
        ActionType: request.type,
        Operation: 'MultiplayerAction',
        RequestId: request.requestId,
      });
      throw new PendingMultiplayerActionError(
        'We could not confirm the move yet. It will be recovered before play continues.',
        request.requestId,
      );
    } else {
      await removePendingAction(request.requestId);
    }
    throw error;
  }
}

async function invokeActionRequest<TResult>(request: ActionRequest): Promise<TResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    if (attempt > 0) {
      await delay(retryDelaysMs[attempt - 1]);
    }

    const { actionKey: _actionKey, actorId: _actorId, createdAt: _createdAt, ...body } = request;
    const { data, error } = await supabase.functions.invoke<TResult>('game-action', { body });
    if (!error && data) {
      return data;
    }

    const response = toFunctionErrorResponse(error);
    const message = error ? await toFunctionErrorMessage(error) : 'Game action returned no data.';
    lastError = new MultiplayerActionError(message, response?.status);
    if (!isRetryableActionError(lastError)) {
      throw lastError;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to update game.');
}

async function recoverPendingActions(actorId: string) {
  const pending = await getPendingActionsForRecovery(actorId);
  const recovered: RecoveredMultiplayerAction[] = [];
  for (const request of pending) {
    try {
      const result = await invokeActionRequest<MultiplayerActionResult | { removedGameId: string }>(request);
      await removePendingAction(request.requestId);
      recovered.push({
        action: toMultiplayerAction(request),
        actorId,
        requestId: request.requestId,
        result,
      });
    } catch (error) {
      if (!isRetryableActionError(error)) {
        await removePendingAction(request.requestId);
      }
      await reportError(error, {
        ActionType: request.type,
        Operation: 'RecoverPendingMultiplayerAction',
        RequestId: request.requestId,
      });
    }
  }
  return recovered;
}

function getOrCreatePendingAction(actorId: string, action: MultiplayerAction) {
  return updatePendingActions((actions) => {
    const { hasPayloadConflict, pending, request } = createOrReuseActionRequest(
      actions,
      actorId,
      action,
      Date.now(),
      randomUUID,
      pendingActionMaxAgeMs,
    );
    return { actions: pending, result: { hasPayloadConflict, request } };
  });
}

function getPendingActionsForRecovery(actorId: string) {
  return updatePendingActions((actions) => {
    const { pending, recoverable } = selectActionRequestsForRecovery(
      actions,
      actorId,
      Date.now(),
      pendingActionMaxAgeMs,
    );
    return { actions: pending, result: recoverable };
  });
}

function removePendingAction(requestId: string) {
  return updatePendingActions((actions) => ({
    actions: actions.filter((item) => item.requestId !== requestId),
    result: undefined,
  }));
}

function updatePendingActions<TResult>(
  update: (actions: ActionRequest[]) => { actions: ActionRequest[]; result: TResult },
) {
  const operation = pendingStorageOperation.then(async (): Promise<TResult> => {
    const actions = await loadPendingActions();
    const updated = update(actions);
    await AsyncStorage.setItem(pendingActionsKey, JSON.stringify(updated.actions));
    return updated.result;
  });
  pendingStorageOperation = operation.catch(() => undefined);
  return operation;
}

async function loadPendingActions(): Promise<ActionRequest[]> {
  try {
    const value = await AsyncStorage.getItem(pendingActionsKey);
    if (!value) {
      return [];
    }
    const actions = JSON.parse(value) as unknown;
    return Array.isArray(actions) ? (actions.filter(isActionRequest) as ActionRequest[]) : [];
  } catch {
    return [];
  }
}

function isActionRequest(value: unknown): value is ActionRequest {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as Partial<ActionRequest>).requestId === 'string' &&
    typeof (value as Partial<ActionRequest>).actionKey === 'string' &&
    typeof (value as Partial<ActionRequest>).actorId === 'string' &&
    typeof (value as Partial<ActionRequest>).createdAt === 'string' &&
    typeof (value as Partial<ActionRequest>).type === 'string',
  );
}

class MultiplayerActionError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MultiplayerActionError';
  }
}

function isRetryableActionError(error: unknown) {
  if (!(error instanceof MultiplayerActionError)) {
    return true;
  }
  if (!error.status) {
    return true;
  }
  if (error.status === 401) {
    return true;
  }
  if (error.status === 409) {
    return error.message === 'The action is still processing.';
  }
  return error.status === 408 || error.status === 425 || error.status >= 500;
}

function delay(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
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

export async function useRemoteSuckerPunch(gameId: string, turnId: string, chanceDie?: DieValue) {
  return applyMultiplayerAction({ chanceDie, gameId, turnId, type: 'sucker_punch' });
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
    .channel(createGameListRealtimeTopic())
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

function toRemoteGameRow(
  row: GameRow,
  lastNudgedAt: string | null = null,
  suckerTokensSpent: Record<string, number> = {},
) {
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
    sucker_tokens_spent: suckerTokensSpent,
    updated_at: row.updated_at,
    winner_id: row.winner_id,
  };
}

async function loadSuckerTokensSpent(gameIds: string[]) {
  const spentByGame = new Map<string, Record<string, number>>();
  if (gameIds.length === 0) {
    return spentByGame;
  }

  const { data, error } = await supabase
    .from('turn_actions')
    .select('action_type, actor_id, game_id, payload')
    .in('game_id', gameIds)
    .in('action_type', ['extra_roll', 'mulligan', 'sucker_punch', 'sucker_blocker'])
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  const actionsByGame = new Map<string, SuckerStatAction[]>();
  for (const action of data ?? []) {
    const actions = actionsByGame.get(action.game_id) ?? [];
    actions.push(action as SuckerStatAction);
    actionsByGame.set(action.game_id, actions);
  }

  for (const [gameId, actions] of actionsByGame) {
    const playerIds = new Set(actions.map((action) => action.actor_id));
    spentByGame.set(
      gameId,
      Object.fromEntries(
        [...playerIds].map((playerId) => [playerId, calculateSuckerActionStats(actions, playerId).sucker_tokens_spent]),
      ),
    );
  }

  return spentByGame;
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
