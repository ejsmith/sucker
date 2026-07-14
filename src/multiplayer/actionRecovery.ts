import type { MultiplayerAction, MultiplayerActionResult, RemoveGameActionResult } from './types';

export type ActionRequest = MultiplayerAction & {
  actionKey: string;
  actorId: string;
  createdAt: string;
  requestId: string;
};

export type RecoveredMultiplayerAction = {
  action: MultiplayerAction;
  actorId: string;
  requestId: string;
  result: MultiplayerActionResult | RemoveGameActionResult;
};

export function createOrReuseActionRequest(
  actions: ActionRequest[],
  actorId: string,
  action: MultiplayerAction,
  now: number,
  createRequestId: () => string,
  maxAgeMs: number,
) {
  const pending = actions.filter((request) => isFreshActionRequest(request, now, maxAgeMs));
  const actionKey = getActionKey(action);
  const existing = pending.find((request) => request.actorId === actorId && request.actionKey === actionKey);
  if (existing) {
    return { pending, request: existing };
  }

  const request = {
    ...action,
    actionKey,
    actorId,
    createdAt: new Date(now).toISOString(),
    requestId: createRequestId(),
  } as ActionRequest;
  return { pending: [...pending, request], request };
}

export function selectActionRequestsForRecovery(
  actions: ActionRequest[],
  actorId: string,
  now: number,
  maxAgeMs: number,
) {
  const pending = actions.filter((request) => isFreshActionRequest(request, now, maxAgeMs));
  return {
    pending,
    recoverable: pending.filter((request) => request.actorId === actorId),
  };
}

export function mergeRecoveredActions(current: RecoveredMultiplayerAction[], incoming: RecoveredMultiplayerAction[]) {
  const merged = new Map(current.map((item) => [item.requestId, item]));
  for (const item of incoming) {
    merged.set(item.requestId, item);
  }
  return [...merged.values()];
}

export function toMultiplayerAction(request: ActionRequest): MultiplayerAction {
  const { actionKey: _actionKey, actorId: _actorId, createdAt: _createdAt, requestId: _requestId, ...action } = request;
  return action as MultiplayerAction;
}

export function getActionKey(action: MultiplayerAction) {
  switch (action.type) {
    case 'create_game':
      return JSON.stringify([action.type, action.opponentProfileId]);
    case 'create_invite':
      return JSON.stringify([action.type]);
    case 'accept_invite':
      return JSON.stringify([action.type, action.inviteCode.trim().toUpperCase()]);
    case 'remove_game':
    case 'rematch_game':
    case 'nudge_turn':
    case 'pass_response':
    case 'mulligan':
      return JSON.stringify([action.type, action.gameId]);
    case 'extra_roll':
    case 'roll':
      return JSON.stringify([action.type, action.gameId]);
    case 'score_category':
    case 'scratch_category':
      return JSON.stringify([action.type, action.gameId, action.category, action.held ?? null]);
    case 'sucker_punch':
      return JSON.stringify([action.type, action.gameId, action.turnId, action.chanceDie ?? null]);
  }
}

function isFreshActionRequest(request: ActionRequest, now: number, maxAgeMs: number) {
  const createdAt = new Date(request.createdAt).getTime();
  const age = now - createdAt;
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}
