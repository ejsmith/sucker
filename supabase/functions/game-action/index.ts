import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Database } from '../_shared/database.types.ts';
import {
  createEmptyScorecard,
  type Dice,
  type GameState,
  isSuckerRoll,
  maxRollsPerTurn,
  type Player,
  rollDie,
  scoreCategories,
  type ScoreCategory,
  scoreCategoryForScorecard,
  startingSuckerTokens,
  suckerTokenCosts,
  toDice,
  toGameState,
  toHeldDice,
  toScoreCategory,
  totalScore,
  upperBonus,
} from '../_shared/game.ts';
import {
  buildCompletedPlayerStats,
  buildExtraRollActionPayload,
  buildRollActionPayload,
  buildSuckerPunchActionPayload,
  type SuckerStatAction,
  type SuckerStatTurn,
} from '../_shared/stats.ts';

type DbClient = SupabaseClient<Database>;
type GameRow = Database['public']['Tables']['games']['Row'];
type TurnRow = Database['public']['Tables']['turns']['Row'];
type ActionType = Database['public']['Tables']['turn_actions']['Insert']['action_type'];
type ActionResult = {
  game?: GameRow;
  inviteCode?: string;
  notificationProfileIds?: string[];
};
type NotificationContent = {
  body: string;
  title: string;
};
type PushTokenRow = Pick<Database['public']['Tables']['push_tokens']['Row'], 'expo_push_token' | 'profile_id'>;
type EdgeRuntimeGlobal = typeof globalThis & {
  EdgeRuntime?: {
    waitUntil: (promise: Promise<unknown>) => void;
  };
};

type Action =
  | { type: 'create_game'; opponentProfileId: string }
  | { type: 'create_invite' }
  | { type: 'accept_invite'; inviteCode: string }
  | { type: 'extra_roll'; gameId: string; held?: GameState['held'] }
  | { type: 'roll'; gameId: string; held?: GameState['held'] }
  | {
      type: 'score_category';
      category: ScoreCategory;
      gameId: string;
      held?: GameState['held'];
    }
  | {
      type: 'scratch_category';
      category: ScoreCategory;
      gameId: string;
      held?: GameState['held'];
    }
  | { type: 'pass_response'; gameId: string }
  | { type: 'mulligan'; gameId: string }
  | { type: 'sucker_punch'; gameId: string; turnId: string }
  | { type: 'sucker_blocker'; gameId: string; turnId: string };

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Origin': '*',
};

Deno.serve(async (request) => {
  try {
    if (request.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const action = toAction(await request.json());
    const authHeader = request.headers.get('Authorization') ?? '';
    const supabaseUrl = requireEnv('SUPABASE_URL');
    const anonKey = requireEnv('SUPABASE_ANON_KEY');
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    const authClient = createClient<Database>(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient<Database>(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const result = await applyAction(admin, user.id, action);
    queueActionNotifications(admin, user.id, action, result);
    return json(result);
  } catch (error) {
    console.error('game-action failed', error);
    const message = toErrorMessage(error);
    return json({ error: message }, 400);
  }
});

async function applyAction(admin: DbClient, actorId: string, action: Action): Promise<ActionResult> {
  switch (action.type) {
    case 'create_game':
      return createRemoteGame(admin, actorId, action.opponentProfileId);
    case 'create_invite':
      return createInvite(admin, actorId);
    case 'accept_invite':
      return acceptInvite(admin, actorId, action.inviteCode);
    case 'roll':
      return mutateGame(
        admin,
        actorId,
        action.gameId,
        action.type,
        (state) => rollGame(state, actorId, action.held),
        (_state, nextState) => buildRollActionPayload(nextState.dice),
      );
    case 'extra_roll':
      return mutateGame(
        admin,
        actorId,
        action.gameId,
        action.type,
        (state) => purchaseExtraRoll(state, actorId, action.held),
        (state) => buildExtraRollActionPayload(state, actorId),
      );
    case 'score_category':
      return scoreRemoteTurn(admin, actorId, action.gameId, action.category, false, action.held);
    case 'scratch_category':
      return scratchRemoteScoreBox(admin, actorId, action.gameId, action.category, action.held);
    case 'pass_response':
      return passResponse(admin, actorId, action.gameId);
    case 'mulligan':
      return mulliganTurn(admin, actorId, action.gameId);
    case 'sucker_punch':
      return suckerPunchTurn(admin, actorId, action.gameId, action.turnId);
    case 'sucker_blocker':
      return blockSuckerPunch(admin, actorId, action.gameId, action.turnId);
    default:
      return assertNever(action);
  }
}

function queueActionNotifications(admin: DbClient, actorId: string, action: Action, result: ActionResult) {
  const task = sendActionNotifications(admin, actorId, action, result).catch((notificationError) => {
    console.error('Unable to send action notifications', notificationError);
  });
  const edgeRuntime = (globalThis as EdgeRuntimeGlobal).EdgeRuntime;

  if (edgeRuntime) {
    edgeRuntime.waitUntil(task);
    return;
  }

  void task;
}

async function sendActionNotifications(admin: DbClient, actorId: string, action: Action, result: ActionResult) {
  const game = result.game;
  const profileIds = result.notificationProfileIds?.filter((profileId) => profileId !== actorId);
  if (!game || !profileIds?.length) {
    return;
  }

  const uniqueProfileIds = [...new Set(profileIds)];
  const { data: pushTokens, error } = await admin
    .from('push_tokens')
    .select('expo_push_token, profile_id')
    .in('profile_id', uniqueProfileIds);

  if (error) {
    console.error('Unable to load push tokens', error);
    return;
  }
  if (!pushTokens?.length) {
    return;
  }

  const latestTurn = game.last_turn_id
    ? await loadTurn(admin, game.last_turn_id).catch((turnError) => {
        console.error('Unable to load latest turn for notification', turnError);
        return null;
      })
    : null;
  const tokens = pushTokens as PushTokenRow[];
  const messages = tokens.flatMap((pushToken) => {
    const content = buildNotificationContent(action, game, latestTurn, actorId, pushToken.profile_id);
    if (!content) {
      return [];
    }

    return [
      {
        body: content.body,
        data: {
          actionType: action.type,
          gameId: game.id,
        },
        sound: 'default',
        title: content.title,
        to: pushToken.expo_push_token,
      },
    ];
  });

  if (!messages.length) {
    return;
  }

  for (const chunk of chunkArray(messages, 100)) {
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        body: JSON.stringify(chunk),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });

      if (!response.ok) {
        console.error('Expo push send failed', response.status, await response.text());
      }
    } catch (pushError) {
      console.error('Expo push send failed', pushError);
    }
  }
}

function buildNotificationContent(
  action: Action,
  game: GameRow,
  latestTurn: TurnRow | null,
  actorId: string,
  recipientId: string,
): NotificationContent | null {
  const actor = game.state.players.find((player) => player.id === actorId);
  const actorName = actor?.name ?? 'Your opponent';

  if (game.status === 'complete') {
    return buildGameOverNotification(game, recipientId);
  }

  switch (action.type) {
    case 'create_game':
      return {
        body: `${actorName} started a game with you.`,
        title: 'New Sucker! game',
      };
    case 'accept_invite':
      return {
        body: `${actorName} joined your Sucker! game.`,
        title: 'Invite accepted',
      };
    case 'score_category':
    case 'scratch_category':
      return buildTurnSubmittedNotification(action, actorName, latestTurn);
    case 'sucker_punch':
      return {
        body: `${actorName} forced you to replay your last turn.`,
        title: 'You got Sucker Punched!',
      };
    case 'sucker_blocker':
      return {
        body: `${actorName} blocked your Sucker Punch.`,
        title: 'Sucker Punch blocked!',
      };
    default:
      return null;
  }
}

function buildTurnSubmittedNotification(
  action: Extract<Action, { type: 'score_category' } | { type: 'scratch_category' }>,
  actorName: string,
  latestTurn: TurnRow | null,
): NotificationContent {
  if (latestTurn && isSuckerRoll(toDice(latestTurn.dice))) {
    return {
      body: `${actorName} rolled a SUCKER!`,
      title: 'SUCKER!!',
    };
  }

  if (action.type === 'scratch_category') {
    return {
      body: `${actorName} scratched ${formatScoreCategory(action.category)}.`,
      title: 'Your turn',
    };
  }

  const scoreText = latestTurn ? ` for ${latestTurn.score}` : '';
  return {
    body: `${actorName} played ${formatScoreCategory(action.category)}${scoreText}.`,
    title: 'Your turn',
  };
}

function buildGameOverNotification(game: GameRow, recipientId: string): NotificationContent {
  const scores = game.state.players.map((player) => ({
    player,
    score: totalScore(player.scorecard),
  }));
  const topScore = Math.max(...scores.map((score) => score.score));
  const winners = scores.filter((score) => score.score === topScore);
  const recipientScore = scores.find((score) => score.player.id === recipientId)?.score ?? 0;

  if (winners.length > 1) {
    return {
      body: `Final score: ${topScore}-${topScore}.`,
      title: 'Game tied!',
    };
  }

  const winner = winners[0];
  if (winner.player.id === recipientId) {
    return {
      body: `Final score: ${winner.score}-${getOpponentScore(scores, recipientId)}.`,
      title: 'You win!',
    };
  }

  return {
    body: `Final score: ${recipientScore}-${winner.score}.`,
    title: `${winner.player.name} wins!`,
  };
}

function getOpponentScore(scores: Array<{ player: Player; score: number }>, playerId: string) {
  return scores.find((score) => score.player.id !== playerId)?.score ?? 0;
}

function formatScoreCategory(category: ScoreCategory) {
  switch (category) {
    case 'ones':
      return 'Ones';
    case 'twos':
      return 'Twos';
    case 'threes':
      return 'Threes';
    case 'fours':
      return 'Fours';
    case 'fives':
      return 'Fives';
    case 'sixes':
      return 'Sixes';
    case 'threeOfAKind':
      return '3x';
    case 'fourOfAKind':
      return '4x';
    case 'fullHouse':
      return 'Full House';
    case 'smallStraight':
      return 'Small Straight';
    case 'largeStraight':
      return 'Large Straight';
    case 'sucker':
      return 'Sucker';
    case 'chance':
      return 'Chance';
    default:
      return assertNever(category);
  }
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function toAction(value: unknown): Action {
  const action = toActionRecord(value);
  const type = readString(action, 'type');

  switch (type) {
    case 'create_game':
      return {
        opponentProfileId: readString(action, 'opponentProfileId'),
        type,
      };
    case 'create_invite':
      return { type };
    case 'accept_invite':
      return {
        inviteCode: readString(action, 'inviteCode'),
        type,
      };
    case 'extra_roll':
    case 'roll':
      return {
        gameId: readString(action, 'gameId'),
        held: readHeld(action),
        type,
      };
    case 'score_category':
    case 'scratch_category':
      return {
        category: toScoreCategory(readString(action, 'category')),
        gameId: readString(action, 'gameId'),
        held: readHeld(action),
        type,
      };
    case 'pass_response':
    case 'mulligan':
      return {
        gameId: readString(action, 'gameId'),
        type,
      };
    case 'sucker_punch':
    case 'sucker_blocker':
      return {
        gameId: readString(action, 'gameId'),
        turnId: readString(action, 'turnId'),
        type,
      };
    default:
      throw new Error('Invalid multiplayer action.');
  }
}

function toActionRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid multiplayer action.');
  }

  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid multiplayer action field: ${key}.`);
  }

  return value;
}

function readHeld(record: Record<string, unknown>): GameState['held'] | undefined {
  return record.held === undefined ? undefined : toHeldDice(record.held);
}

async function createRemoteGame(admin: DbClient, actorId: string, opponentId: string) {
  if (actorId === opponentId) {
    throw new Error('Choose a different opponent.');
  }

  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id, display_name')
    .in('id', [actorId, opponentId]);

  if (error) {
    throw error;
  }
  if (!profiles || profiles.length !== 2) {
    throw new Error('Both players need profiles before starting a game.');
  }

  const actorProfile = profiles.find((profile) => profile.id === actorId);
  const opponentProfile = profiles.find((profile) => profile.id === opponentId);
  if (!actorProfile || !opponentProfile) {
    throw new Error('Unable to load both players.');
  }

  const gameId = crypto.randomUUID();
  const state = createGameState(gameId, [
    { id: actorProfile.id, name: actorProfile.display_name },
    { id: opponentProfile.id, name: opponentProfile.display_name },
  ]);

  const { data: game, error: gameError } = await admin
    .from('games')
    .insert({
      created_by: actorId,
      current_player_id: actorId,
      id: gameId,
      state,
      status: 'active',
    })
    .select()
    .single();

  if (gameError) {
    throw gameError;
  }

  const { error: playersError } = await admin.from('game_players').insert([
    {
      game_id: gameId,
      player_id: actorId,
      seat_index: 0,
      sucker_tokens: startingSuckerTokens,
    },
    {
      game_id: gameId,
      player_id: opponentId,
      seat_index: 1,
      sucker_tokens: startingSuckerTokens,
    },
  ]);

  if (playersError) {
    throw playersError;
  }

  await insertAction(admin, gameId, actorId, 'create_game', {
    opponentProfileId: opponentId,
  });
  return { game, notificationProfileIds: [opponentId] };
}

async function createInvite(admin: DbClient, actorId: string) {
  const { data: profile, error } = await admin.from('profiles').select('id, display_name').eq('id', actorId).single();

  if (error) {
    throw error;
  }

  const gameId = crypto.randomUUID();
  const state = createGameState(gameId, [
    {
      id: profile.id,
      name: profile.display_name,
    },
  ]);
  const { data: game, error: gameError } = await admin
    .from('games')
    .insert({
      created_by: actorId,
      current_player_id: null,
      id: gameId,
      state,
      status: 'inviting',
    })
    .select()
    .single();

  if (gameError) {
    throw gameError;
  }

  const { error: playerError } = await admin.from('game_players').insert({
    game_id: gameId,
    player_id: actorId,
    seat_index: 0,
    sucker_tokens: startingSuckerTokens,
  });

  if (playerError) {
    throw playerError;
  }

  const { data: invite, error: inviteError } = await admin
    .from('game_invites')
    .insert({
      game_id: gameId,
      inviter_id: actorId,
    })
    .select()
    .single();

  if (inviteError) {
    throw inviteError;
  }

  await insertAction(admin, gameId, actorId, 'create_invite', {
    inviteCode: invite.invite_code,
  });
  return { game, inviteCode: invite.invite_code };
}

async function acceptInvite(admin: DbClient, actorId: string, inviteCode: string) {
  const normalizedInviteCode = inviteCode.trim().toUpperCase();
  const { data: invite, error: inviteError } = await admin
    .from('game_invites')
    .select('*')
    .eq('invite_code', normalizedInviteCode)
    .eq('status', 'pending')
    .single();

  if (inviteError) {
    throw inviteError;
  }
  if (invite.inviter_id === actorId) {
    throw new Error('You cannot accept your own invite.');
  }
  if (invite.invitee_id && invite.invitee_id !== actorId) {
    throw new Error('This invite is for another player.');
  }

  const { data: profiles, error: profileError } = await admin
    .from('profiles')
    .select('id, display_name')
    .in('id', [invite.inviter_id, actorId]);

  if (profileError) {
    throw profileError;
  }

  const inviter = profiles?.find((profile) => profile.id === invite.inviter_id);
  const invitee = profiles?.find((profile) => profile.id === actorId);
  if (!inviter || !invitee) {
    throw new Error('Both players need profiles before starting a game.');
  }

  const state = createGameState(invite.game_id, [
    { id: inviter.id, name: inviter.display_name },
    { id: invitee.id, name: invitee.display_name },
  ]);

  const { error: playerError } = await admin.from('game_players').insert({
    game_id: invite.game_id,
    player_id: actorId,
    seat_index: 1,
    sucker_tokens: startingSuckerTokens,
  });

  if (playerError) {
    throw playerError;
  }

  await admin
    .from('game_invites')
    .update({
      invitee_id: actorId,
      status: 'accepted',
    })
    .eq('id', invite.id);

  const { data: game, error: gameError } = await admin
    .from('games')
    .update({
      current_player_id: inviter.id,
      state,
      status: 'active',
    })
    .eq('id', invite.game_id)
    .select()
    .single();

  if (gameError) {
    throw gameError;
  }

  await insertAction(admin, invite.game_id, actorId, 'accept_invite', {
    inviteCode: normalizedInviteCode,
  });
  return { game, notificationProfileIds: [invite.inviter_id] };
}

async function mutateGame(
  admin: DbClient,
  actorId: string,
  gameId: string,
  actionType: ActionType,
  mutate: (state: GameState) => GameState,
  createPayload: (state: GameState, nextState: GameState) => Record<string, unknown> = () => ({}),
) {
  const game = await loadGameForActor(admin, gameId, actorId);
  const nextState = mutate(game.state);
  const nextPlayer = nextState.players[nextState.currentPlayerIndex];
  const { data, error } = await admin
    .from('games')
    .update({
      current_player_id: nextState.phase === 'complete' ? null : nextPlayer.id,
      state: nextState,
      status: nextState.phase === 'complete' ? 'complete' : 'active',
    })
    .eq('id', gameId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  await syncGamePlayers(admin, gameId, nextState, nextState.phase === 'complete');
  await insertAction(admin, gameId, actorId, actionType, createPayload(game.state, nextState));
  return { game: data };
}

async function scoreRemoteTurn(
  admin: DbClient,
  actorId: string,
  gameId: string,
  category: ScoreCategory,
  scratch = false,
  submittedHeld?: GameState['held'],
) {
  const game = await loadGameForActor(admin, gameId, actorId);
  const state = game.state;
  assertCurrentPlayer(state, actorId);

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (state.rollNumber === 0 || state.phase === 'complete') {
    throw new Error('Roll before playing a score.');
  }
  if (currentPlayer.scorecard[category] !== null) {
    throw new Error('That score box is already filled.');
  }

  const turnHeld = normalizeHeld(submittedHeld, state.held);
  const turnIndex = await loadNextTurnIndex(admin, gameId, game.last_turn_id);
  const turnScore = scratch ? 0 : scoreCategoryForScorecard(state.dice, category, currentPlayer.scorecard);
  const extraSuckerBonus =
    !scratch && category !== 'sucker' && currentPlayer.scorecard.sucker !== null && isSuckerRoll(state.dice);
  const tokenDelta = turnScore === 0 ? 1 : 0;
  const players = state.players.map((player) => {
    if (player.id !== actorId) {
      return player;
    }

    return {
      ...player,
      scorecard: {
        ...player.scorecard,
        [category]: turnScore,
      },
      suckerBonusCategories: extraSuckerBonus
        ? [...player.suckerBonusCategories, category]
        : player.suckerBonusCategories,
      suckerTokens: Math.max(0, player.suckerTokens + tokenDelta),
    };
  });
  const complete = players.every((player) =>
    scoreCategories.every((scoreCategory) => player.scorecard[scoreCategory] !== null),
  );
  const nextState: GameState = {
    ...state,
    currentPlayerIndex: complete ? state.currentPlayerIndex : (state.currentPlayerIndex + 1) % players.length,
    dice: [1, 1, 1, 1, 1],
    extraRollsAvailable: 0,
    held: [false, false, false, false, false],
    phase: complete ? 'complete' : 'rolling',
    players,
    rollNumber: 0,
  };
  const winner = complete ? [...players].sort((a, b) => totalScore(b.scorecard) - totalScore(a.scorecard))[0] : null;

  const { data: insertedTurn, error: turnError } = await admin
    .from('turns')
    .insert({
      category,
      dice: state.dice,
      game_id: gameId,
      held: turnHeld,
      player_id: actorId,
      roll_count: state.rollNumber,
      score: turnScore,
      status: complete ? 'finalized' : 'submitted',
      turn_index: turnIndex,
    })
    .select()
    .single();

  const turn = isDuplicateTurnIndexError(turnError)
    ? await loadDuplicateScoreTurn(admin, gameId, actorId, state, category, turnScore, complete)
    : insertedTurn;
  if (!turn) {
    throw turnError;
  }

  const { data: updatedGame, error: gameError } = await admin
    .from('games')
    .update({
      completed_at: complete ? new Date().toISOString() : null,
      current_player_id: complete ? null : players[nextState.currentPlayerIndex].id,
      last_turn_id: turn.id,
      state: nextState,
      status: complete ? 'complete' : 'response_window',
      winner_id: winner?.id ?? null,
    })
    .eq('id', gameId)
    .select()
    .single();

  if (gameError) {
    throw gameError;
  }

  for (const player of players) {
    await admin
      .from('game_players')
      .update({
        final_score: complete ? totalScore(player.scorecard) : null,
        sucker_tokens: player.suckerTokens,
        upper_bonus_awarded: upperBonus(player.scorecard) > 0,
      })
      .eq('game_id', gameId)
      .eq('player_id', player.id);
  }

  await insertAction(admin, gameId, actorId, scratch ? 'scratch_category' : 'score_category', {
    category,
    scratched: scratch,
    score: turnScore,
    turnId: turn.id,
  });

  if (complete) {
    await writeCompletedGameStats(admin, gameId, players, winner?.id ?? null);
  }

  return {
    game: updatedGame,
    notificationProfileIds: complete ? players.map((player) => player.id) : [players[nextState.currentPlayerIndex].id],
  };
}

function scratchRemoteScoreBox(
  admin: DbClient,
  actorId: string,
  gameId: string,
  category: ScoreCategory,
  held?: GameState['held'],
) {
  return scoreRemoteTurn(admin, actorId, gameId, category, true, held);
}

async function passResponse(admin: DbClient, actorId: string, gameId: string) {
  const game = await loadGameForActor(admin, gameId, actorId);
  if (game.status !== 'response_window') {
    throw new Error('There is no turn response to pass.');
  }
  if (game.current_player_id !== actorId) {
    throw new Error('Only the responding player can pass.');
  }

  const { data: updatedGame, error } = await admin
    .from('games')
    .update({
      status: 'active',
    })
    .eq('id', gameId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  await insertAction(admin, gameId, actorId, 'pass_response', {
    turnId: game.last_turn_id,
  });
  return { game: updatedGame };
}

async function mulliganTurn(admin: DbClient, actorId: string, gameId: string) {
  const game = await loadGameForActor(admin, gameId, actorId);
  if (game.status !== 'response_window' || !game.last_turn_id) {
    throw new Error('Mulligan is only available immediately after a submitted turn.');
  }

  const turn = await loadTurn(admin, game.last_turn_id);
  if (turn.player_id !== actorId) {
    throw new Error('You can only Mulligan your own latest turn.');
  }

  const state = game.state;
  const player = findPlayer(state, actorId);
  if (player.suckerTokens < suckerTokenCosts.mulligan) {
    throw new Error(`You need ${suckerTokenCosts.mulligan} Sucker Tokens to Mulligan.`);
  }

  const nextState = removeScoredTurn(state, turn, actorId, -suckerTokenCosts.mulligan);
  const { data: updatedGame, error } = await admin
    .from('games')
    .update({
      current_player_id: actorId,
      state: nextState,
      status: 'active',
    })
    .eq('id', gameId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  await admin.from('turns').update({ status: 'mulliganed' }).eq('id', turn.id);
  await admin.from('token_events').insert({
    event_type: 'mulligan',
    game_id: gameId,
    player_id: actorId,
    target_turn_id: turn.id,
    token_delta: -suckerTokenCosts.mulligan,
  });
  await syncGamePlayers(admin, gameId, nextState, false);
  await insertAction(admin, gameId, actorId, 'mulligan', { turnId: turn.id });

  return { game: updatedGame };
}

async function suckerPunchTurn(admin: DbClient, actorId: string, gameId: string, turnId: string) {
  const game = await loadGameForActor(admin, gameId, actorId);
  if (game.status !== 'response_window' || game.last_turn_id !== turnId) {
    throw new Error('Sucker Punch can only target the opponent’s latest submitted turn.');
  }

  const turn = await loadTurn(admin, turnId);
  if (turn.player_id === actorId) {
    throw new Error('You cannot Sucker Punch your own turn.');
  }

  const state = game.state;
  const actor = findPlayer(state, actorId);
  if (actor.suckerTokens < suckerTokenCosts.suckerPunch) {
    throw new Error(`You need ${suckerTokenCosts.suckerPunch} Sucker Tokens to Sucker Punch.`);
  }

  let nextState = removeScoredTurn(state, turn, turn.player_id, 0);
  nextState = updatePlayerTokens(nextState, actorId, -suckerTokenCosts.suckerPunch);

  const { data: updatedGame, error } = await admin
    .from('games')
    .update({
      current_player_id: turn.player_id,
      state: nextState,
      status: 'blocked_response',
    })
    .eq('id', gameId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  await admin.from('turns').update({ status: 'punched' }).eq('id', turn.id);
  await admin.from('token_events').insert({
    event_type: 'sucker_punch',
    game_id: gameId,
    player_id: actorId,
    target_turn_id: turn.id,
    token_delta: -suckerTokenCosts.suckerPunch,
  });
  await syncGamePlayers(admin, gameId, nextState, false);
  await insertAction(admin, gameId, actorId, 'sucker_punch', {
    turnId: turn.id,
    ...buildSuckerPunchActionPayload(turn.player_id),
  });

  return { game: updatedGame, notificationProfileIds: [turn.player_id] };
}

async function blockSuckerPunch(admin: DbClient, actorId: string, gameId: string, turnId: string) {
  const game = await loadGameForActor(admin, gameId, actorId);
  if (game.status !== 'blocked_response' || game.last_turn_id !== turnId) {
    throw new Error('There is no Sucker Punch to block.');
  }

  const turn = await loadTurn(admin, turnId);
  if (turn.player_id !== actorId || turn.status !== 'punched') {
    throw new Error('You can only block a Sucker Punch against your latest turn.');
  }

  const state = game.state;
  const target = findPlayer(state, actorId);
  if (target.suckerTokens < suckerTokenCosts.suckerBlocker) {
    throw new Error(`You need ${suckerTokenCosts.suckerBlocker} Sucker Tokens to use Sucker Blocker.`);
  }

  const restoredState = restoreScoredTurn(state, turn, -suckerTokenCosts.suckerBlocker);
  const nextPlayer = restoredState.players.find((player) => player.id !== actorId);
  if (!nextPlayer) {
    throw new Error('Unable to find the next player.');
  }
  const nextState: GameState = {
    ...restoredState,
    currentPlayerIndex: restoredState.players.findIndex((player) => player.id === nextPlayer.id),
    dice: [1, 1, 1, 1, 1],
    extraRollsAvailable: 0,
    held: [false, false, false, false, false],
    phase: 'rolling',
    rollNumber: 0,
  };

  const { data: updatedGame, error } = await admin
    .from('games')
    .update({
      current_player_id: nextPlayer.id,
      state: nextState,
      status: 'active',
    })
    .eq('id', gameId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  await admin.from('turns').update({ status: 'blocked' }).eq('id', turn.id);
  await admin.from('token_events').insert({
    event_type: 'sucker_blocker',
    game_id: gameId,
    player_id: actorId,
    target_turn_id: turn.id,
    token_delta: -suckerTokenCosts.suckerBlocker,
  });
  await syncGamePlayers(admin, gameId, nextState, false);
  await insertAction(admin, gameId, actorId, 'sucker_blocker', {
    turnId: turn.id,
  });

  return { game: updatedGame, notificationProfileIds: [nextPlayer.id] };
}

async function loadGameForActor(admin: DbClient, gameId: string, actorId: string): Promise<GameRow> {
  const { data: participant, error: participantError } = await admin
    .from('game_players')
    .select('game_id')
    .eq('game_id', gameId)
    .eq('player_id', actorId)
    .maybeSingle();

  if (participantError) {
    throw participantError;
  }
  if (!participant) {
    throw new Error('You are not a player in this game.');
  }

  const { data: game, error } = await admin.from('games').select('*').eq('id', gameId).single();
  if (error) {
    throw error;
  }

  return { ...game, state: toGameState(game.state) };
}

async function loadTurn(admin: DbClient, turnId: string): Promise<TurnRow> {
  const { data: turn, error } = await admin.from('turns').select('*').eq('id', turnId).single();
  if (error) {
    throw error;
  }

  return turn;
}

async function loadNextTurnIndex(admin: DbClient, gameId: string, lastTurnId: string | null) {
  const { data: latestTurn, error } = await admin
    .from('turns')
    .select('turn_index')
    .eq('game_id', gameId)
    .order('turn_index', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const lastTurn = lastTurnId ? await loadTurn(admin, lastTurnId) : null;
  return Math.max(latestTurn?.turn_index ?? 0, lastTurn?.turn_index ?? 0) + 1;
}

async function loadDuplicateScoreTurn(
  admin: DbClient,
  gameId: string,
  actorId: string,
  state: GameState,
  category: ScoreCategory,
  score: number,
  complete: boolean,
): Promise<TurnRow | null> {
  const { data: latestTurn, error } = await admin
    .from('turns')
    .select('*')
    .eq('game_id', gameId)
    .order('turn_index', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (
    !latestTurn ||
    latestTurn.player_id !== actorId ||
    latestTurn.category !== category ||
    latestTurn.score !== score ||
    latestTurn.roll_count !== state.rollNumber ||
    latestTurn.status !== (complete ? 'finalized' : 'submitted') ||
    !arraysEqual(toDice(latestTurn.dice), state.dice)
  ) {
    return null;
  }

  return latestTurn;
}

async function syncGamePlayers(admin: DbClient, gameId: string, state: GameState, complete: boolean) {
  for (const player of state.players) {
    await admin
      .from('game_players')
      .update({
        final_score: complete ? totalScore(player.scorecard) : null,
        sucker_tokens: player.suckerTokens,
        upper_bonus_awarded: upperBonus(player.scorecard) > 0,
      })
      .eq('game_id', gameId)
      .eq('player_id', player.id);
  }
}

function findPlayer(state: GameState, playerId: string): Player {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error('Player is not in this game.');
  }

  return player;
}

function removeScoredTurn(state: GameState, turn: TurnRow, playerId: string, tokenDelta: number): GameState {
  const category = toScoreCategory(turn.category);
  const playerIndex = state.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) {
    throw new Error('Turn player is not in this game.');
  }

  const players = state.players.map((player) => {
    if (player.id !== playerId) {
      return player;
    }

    return {
      ...player,
      scorecard: {
        ...player.scorecard,
        [category]: null,
      },
      suckerBonusCategories: player.suckerBonusCategories.filter((bonusCategory) => bonusCategory !== category),
      suckerTokens: Math.max(0, player.suckerTokens + tokenDelta),
    };
  });

  return {
    ...state,
    currentPlayerIndex: playerIndex,
    dice: [1, 1, 1, 1, 1],
    extraRollsAvailable: 0,
    held: [false, false, false, false, false],
    phase: 'rolling',
    players,
    rollNumber: 0,
  };
}

function restoreScoredTurn(state: GameState, turn: TurnRow, tokenDelta: number): GameState {
  const category = toScoreCategory(turn.category);
  const hasBonus = category !== 'sucker' && isSuckerRoll(toDice(turn.dice));
  const players = state.players.map((player) => {
    if (player.id !== turn.player_id) {
      return player;
    }

    return {
      ...player,
      scorecard: {
        ...player.scorecard,
        [category]: turn.score,
      },
      suckerBonusCategories:
        hasBonus && !player.suckerBonusCategories.includes(category)
          ? [...player.suckerBonusCategories, category]
          : player.suckerBonusCategories,
      suckerTokens: Math.max(0, player.suckerTokens + tokenDelta),
    };
  });

  return {
    ...state,
    players,
  };
}

function updatePlayerTokens(state: GameState, playerId: string, tokenDelta: number): GameState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === playerId
        ? {
            ...player,
            suckerTokens: Math.max(0, player.suckerTokens + tokenDelta),
          }
        : player,
    ),
  };
}

function createGameState(gameId: string, profiles: Array<{ id: string; name: string }>): GameState {
  return {
    currentPlayerIndex: 0,
    dice: [1, 1, 1, 1, 1],
    extraRollsAvailable: 0,
    held: [false, false, false, false, false],
    id: gameId,
    phase: 'rolling',
    players: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      scorecard: createEmptyScorecard(),
      suckerBonusCategories: [],
      suckerTokens: startingSuckerTokens,
    })),
    rollNumber: 0,
  };
}

function rollGame(state: GameState, actorId: string, submittedHeld?: GameState['held']): GameState {
  assertCurrentPlayer(state, actorId);
  if (state.phase === 'complete' || state.rollNumber >= maxAvailableRolls(state)) {
    throw new Error('No rolls remaining.');
  }

  const held =
    state.rollNumber === 0
      ? ([false, false, false, false, false] as GameState['held'])
      : normalizeHeld(submittedHeld, state.held);

  return {
    ...state,
    held,
    dice: state.dice.map((die, index) => (held[index] ? die : rollDie(edgeRollRandom))) as Dice,
    phase: 'scoring',
    rollNumber: state.rollNumber + 1,
  };
}

function purchaseExtraRoll(state: GameState, actorId: string, submittedHeld?: GameState['held']): GameState {
  assertCurrentPlayer(state, actorId);
  const player = findPlayer(state, actorId);
  if (state.phase === 'complete' || state.rollNumber < maxAvailableRolls(state)) {
    throw new Error('Extra Roll is available after you use every available roll.');
  }
  if (player.suckerTokens < suckerTokenCosts.extraRoll) {
    throw new Error(`You need ${suckerTokenCosts.extraRoll} Sucker Token to buy an Extra Roll.`);
  }

  return {
    ...updatePlayerTokens(state, actorId, -suckerTokenCosts.extraRoll),
    extraRollsAvailable: Math.max(0, state.extraRollsAvailable ?? 0) + 1,
    held: normalizeHeld(submittedHeld, state.held),
  };
}

function maxAvailableRolls(state: Pick<GameState, 'extraRollsAvailable'>): number {
  return maxRollsPerTurn + Math.max(0, state.extraRollsAvailable ?? 0);
}

function normalizeHeld(submittedHeld: GameState['held'] | undefined, fallback: GameState['held']): GameState['held'] {
  if (!submittedHeld) {
    return fallback;
  }
  if (submittedHeld.length !== 5 || submittedHeld.some((held) => typeof held !== 'boolean')) {
    throw new Error('Invalid held dice.');
  }

  return [...submittedHeld] as GameState['held'];
}

function cryptoRandom(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / (0xffffffff + 1);
}

function edgeRollRandom(): number {
  const fixedDie = Number(Deno.env.get('SUCKER_E2E_FIXED_DIE'));
  if (Number.isInteger(fixedDie) && fixedDie >= 1 && fixedDie <= 6) {
    return (fixedDie - 1) / 6;
  }

  return cryptoRandom();
}

function isDuplicateTurnIndexError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const postgrestError = error as { code?: unknown; details?: unknown; message?: unknown };
  return (
    postgrestError.code === '23505' &&
    ((typeof postgrestError.details === 'string' && postgrestError.details.includes('(game_id, turn_index)')) ||
      (typeof postgrestError.message === 'string' &&
        postgrestError.message.includes('turns_game_id_turn_index_key')))
  );
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertCurrentPlayer(state: GameState, actorId: string) {
  if (state.players[state.currentPlayerIndex]?.id !== actorId) {
    throw new Error('It is not your turn.');
  }
}

async function writeCompletedGameStats(admin: DbClient, gameId: string, players: Player[], winnerId: string | null) {
  for (const player of players) {
    const opponent = players.find((candidate) => candidate.id !== player.id)!;
    const result = await buildResult(admin, gameId, player, opponent, players, winnerId);
    await admin.from('game_player_results').upsert(result);
    const { data: existing, error } = await admin
      .from('head_to_head_stats')
      .select('*')
      .eq('player_id', player.id)
      .eq('opponent_id', opponent.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!existing) {
      await admin.from('head_to_head_stats').insert({
        player_id: player.id,
        opponent_id: opponent.id,
        games_played: 1,
        wins: result.won ? 1 : 0,
        losses: result.won ? 0 : 1,
        highest_score: result.final_score,
        total_score: result.final_score,
        average_score: result.final_score,
        upper_bonus_games: result.upper_bonus_awarded ? 1 : 0,
        sucker_games: result.sucker_count > 0 ? 1 : 0,
        three_of_a_kind_games: result.three_of_a_kind_count > 0 ? 1 : 0,
        four_of_a_kind_games: result.four_of_a_kind_count > 0 ? 1 : 0,
        full_house_games: result.full_house_count > 0 ? 1 : 0,
        small_straight_games: result.small_straight_count > 0 ? 1 : 0,
        large_straight_games: result.large_straight_count > 0 ? 1 : 0,
        blowout_losses: result.blowout_loss,
        blowout_wins: result.blowout_win,
        comeback_wins: result.comeback_win,
        extra_rolls_used: result.extra_rolls_used,
        mulligans_used: result.mulligans_used,
        sucker_hunt_misses: result.sucker_hunt_misses,
        sucker_hunts: result.sucker_hunts,
        sucker_punches_used: result.sucker_punches_used,
        sucker_punches_received: result.sucker_punches_received,
        sucker_blockers_used: result.sucker_blockers_used,
        forced_rerolls: result.forced_rerolls,
        sucker_tokens_spent: result.sucker_tokens_spent,
        average_sucker_tokens_spent: result.sucker_tokens_spent,
        sucker_tokens_leftover: result.sucker_tokens_leftover,
        average_sucker_tokens_leftover: result.sucker_tokens_leftover,
      });
      continue;
    }

    const gamesPlayed = existing.games_played + 1;
    const totalScoreValue = existing.total_score + result.final_score;
    await admin
      .from('head_to_head_stats')
      .update({
        average_score: Number((totalScoreValue / gamesPlayed).toFixed(2)),
        four_of_a_kind_games: existing.four_of_a_kind_games + (result.four_of_a_kind_count > 0 ? 1 : 0),
        full_house_games: existing.full_house_games + (result.full_house_count > 0 ? 1 : 0),
        games_played: gamesPlayed,
        highest_score: Math.max(existing.highest_score, result.final_score),
        large_straight_games: existing.large_straight_games + (result.large_straight_count > 0 ? 1 : 0),
        blowout_losses: existing.blowout_losses + result.blowout_loss,
        blowout_wins: existing.blowout_wins + result.blowout_win,
        comeback_wins: existing.comeback_wins + result.comeback_win,
        losses: existing.losses + (result.won ? 0 : 1),
        extra_rolls_used: existing.extra_rolls_used + result.extra_rolls_used,
        forced_rerolls: existing.forced_rerolls + result.forced_rerolls,
        mulligans_used: existing.mulligans_used + result.mulligans_used,
        sucker_hunt_misses: existing.sucker_hunt_misses + result.sucker_hunt_misses,
        sucker_hunts: existing.sucker_hunts + result.sucker_hunts,
        small_straight_games: existing.small_straight_games + (result.small_straight_count > 0 ? 1 : 0),
        sucker_blockers_used: existing.sucker_blockers_used + result.sucker_blockers_used,
        sucker_games: existing.sucker_games + (result.sucker_count > 0 ? 1 : 0),
        sucker_punches_received: existing.sucker_punches_received + result.sucker_punches_received,
        sucker_punches_used: existing.sucker_punches_used + result.sucker_punches_used,
        sucker_tokens_leftover: existing.sucker_tokens_leftover + result.sucker_tokens_leftover,
        average_sucker_tokens_leftover: Number(
          ((existing.sucker_tokens_leftover + result.sucker_tokens_leftover) / gamesPlayed).toFixed(2),
        ),
        sucker_tokens_spent: existing.sucker_tokens_spent + result.sucker_tokens_spent,
        average_sucker_tokens_spent: Number(
          ((existing.sucker_tokens_spent + result.sucker_tokens_spent) / gamesPlayed).toFixed(2),
        ),
        three_of_a_kind_games: existing.three_of_a_kind_games + (result.three_of_a_kind_count > 0 ? 1 : 0),
        total_score: totalScoreValue,
        upper_bonus_games: existing.upper_bonus_games + (result.upper_bonus_awarded ? 1 : 0),
        wins: existing.wins + (result.won ? 1 : 0),
      })
      .eq('player_id', player.id)
      .eq('opponent_id', opponent.id);
  }
}

async function buildResult(
  admin: DbClient,
  gameId: string,
  player: Player,
  opponent: Player,
  players: Player[],
  winnerId: string | null,
) {
  const [actions, turns] = await Promise.all([
    loadSuckerStatActions(admin, gameId),
    loadSuckerStatTurns(admin, gameId),
  ]);

  return buildCompletedPlayerStats({
    actions,
    gameId,
    opponent,
    player,
    players,
    turns,
    winnerId,
  });
}

async function loadSuckerStatTurns(admin: DbClient, gameId: string) {
  const { data: turns, error } = await admin
    .from('turns')
    .select('category, player_id, score, status, turn_index')
    .eq('game_id', gameId)
    .order('turn_index', { ascending: true });

  if (error) {
    throw error;
  }

  return (turns ?? []) as SuckerStatTurn[];
}

async function loadSuckerStatActions(admin: DbClient, gameId: string) {
  const { data: actions, error } = await admin
    .from('turn_actions')
    .select('action_type, actor_id, payload')
    .eq('game_id', gameId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return (actions ?? []) as SuckerStatAction[];
}

async function insertAction(
  admin: DbClient,
  gameId: string,
  actorId: string,
  actionType: ActionType,
  payload: Record<string, unknown>,
) {
  await admin.from('turn_actions').insert({
    action_type: actionType,
    actor_id: actorId,
    game_id: gameId,
    payload,
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }

    const details = (error as { details?: unknown }).details;
    if (typeof details === 'string' && details.length > 0) {
      return details;
    }
  }

  return 'Unexpected multiplayer error';
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${JSON.stringify(value)}`);
}
