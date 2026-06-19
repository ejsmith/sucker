import {
  createClient,
  type SupabaseClient,
} from "jsr:@supabase/supabase-js@2.108.2";
import type { Database } from "../_shared/database.types.ts";
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
  toScoreCategory,
  totalScore,
  upperBonus,
} from "../_shared/game.ts";

type DbClient = SupabaseClient<Database>;
type GameRow = Database["public"]["Tables"]["games"]["Row"];
type TurnRow = Database["public"]["Tables"]["turns"]["Row"];
type ActionType =
  Database["public"]["Tables"]["turn_actions"]["Insert"]["action_type"];

type Action =
  | { type: "create_game"; opponentProfileId: string }
  | { type: "create_invite" }
  | { type: "accept_invite"; inviteCode: string }
  | { type: "extra_roll"; gameId: string; held?: GameState["held"] }
  | { type: "roll"; gameId: string; held?: GameState["held"] }
  | {
    type: "score_category";
    category: ScoreCategory;
    gameId: string;
    held?: GameState["held"];
  }
  | {
    type: "scratch_category";
    category: ScoreCategory;
    gameId: string;
    held?: GameState["held"];
  }
  | { type: "pass_response"; gameId: string }
  | { type: "mulligan"; gameId: string }
  | { type: "sucker_punch"; gameId: string; turnId: string }
  | { type: "sucker_blocker"; gameId: string; turnId: string };

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*",
};

Deno.serve(async (request) => {
  try {
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const action = (await request.json()) as Action;
    const authHeader = request.headers.get("Authorization") ?? "";
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const anonKey = requireEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authClient = createClient<Database>(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient<Database>(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser();

    if (userError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const result = await applyAction(admin, user.id, action);
    return json(result);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unexpected multiplayer error";
    return json({ error: message }, 400);
  }
});

async function applyAction(admin: DbClient, actorId: string, action: Action) {
  switch (action.type) {
    case "create_game":
      return createRemoteGame(admin, actorId, action.opponentProfileId);
    case "create_invite":
      return createInvite(admin, actorId);
    case "accept_invite":
      return acceptInvite(admin, actorId, action.inviteCode);
    case "roll":
      return mutateGame(
        admin,
        actorId,
        action.gameId,
        action.type,
        (state) => rollGame(state, actorId, action.held),
      );
    case "extra_roll":
      return mutateGame(
        admin,
        actorId,
        action.gameId,
        action.type,
        (state) => purchaseExtraRoll(state, actorId, action.held),
      );
    case "score_category":
      return scoreRemoteTurn(
        admin,
        actorId,
        action.gameId,
        action.category,
        false,
        action.held,
      );
    case "scratch_category":
      return scratchRemoteScoreBox(
        admin,
        actorId,
        action.gameId,
        action.category,
        action.held,
      );
    case "pass_response":
      return passResponse(admin, actorId, action.gameId);
    case "mulligan":
      return mulliganTurn(admin, actorId, action.gameId);
    case "sucker_punch":
      return suckerPunchTurn(admin, actorId, action.gameId, action.turnId);
    case "sucker_blocker":
      return blockSuckerPunch(admin, actorId, action.gameId, action.turnId);
    default:
      return assertNever(action);
  }
}

async function createRemoteGame(
  admin: DbClient,
  actorId: string,
  opponentId: string,
) {
  if (actorId === opponentId) {
    throw new Error("Choose a different opponent.");
  }

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", [actorId, opponentId]);

  if (error) {
    throw error;
  }
  if (!profiles || profiles.length !== 2) {
    throw new Error("Both players need profiles before starting a game.");
  }

  const actorProfile = profiles.find((profile) => profile.id === actorId);
  const opponentProfile = profiles.find((profile) => profile.id === opponentId);
  if (!actorProfile || !opponentProfile) {
    throw new Error("Unable to load both players.");
  }

  const gameId = crypto.randomUUID();
  const state = createGameState(gameId, [
    { id: actorProfile.id, name: actorProfile.display_name },
    { id: opponentProfile.id, name: opponentProfile.display_name },
  ]);

  const { data: game, error: gameError } = await admin
    .from("games")
    .insert({
      created_by: actorId,
      current_player_id: actorId,
      id: gameId,
      state,
      status: "active",
    })
    .select()
    .single();

  if (gameError) {
    throw gameError;
  }

  const { error: playersError } = await admin.from("game_players").insert([
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

  await insertAction(admin, gameId, actorId, "create_game", {
    opponentProfileId: opponentId,
  });
  return { game, notificationProfileIds: [opponentId] };
}

async function createInvite(admin: DbClient, actorId: string) {
  const { data: profile, error } = await admin.from("profiles").select(
    "id, display_name",
  ).eq("id", actorId).single();

  if (error) {
    throw error;
  }

  const gameId = crypto.randomUUID();
  const state = createGameState(gameId, [{
    id: profile.id,
    name: profile.display_name,
  }]);
  const { data: game, error: gameError } = await admin
    .from("games")
    .insert({
      created_by: actorId,
      current_player_id: null,
      id: gameId,
      state,
      status: "inviting",
    })
    .select()
    .single();

  if (gameError) {
    throw gameError;
  }

  const { error: playerError } = await admin.from("game_players").insert({
    game_id: gameId,
    player_id: actorId,
    seat_index: 0,
    sucker_tokens: startingSuckerTokens,
  });

  if (playerError) {
    throw playerError;
  }

  const { data: invite, error: inviteError } = await admin
    .from("game_invites")
    .insert({
      game_id: gameId,
      inviter_id: actorId,
    })
    .select()
    .single();

  if (inviteError) {
    throw inviteError;
  }

  await insertAction(admin, gameId, actorId, "create_invite", {
    inviteCode: invite.invite_code,
  });
  return { game, inviteCode: invite.invite_code };
}

async function acceptInvite(
  admin: DbClient,
  actorId: string,
  inviteCode: string,
) {
  const normalizedInviteCode = inviteCode.trim().toUpperCase();
  const { data: invite, error: inviteError } = await admin
    .from("game_invites")
    .select("*")
    .eq("invite_code", normalizedInviteCode)
    .eq("status", "pending")
    .single();

  if (inviteError) {
    throw inviteError;
  }
  if (invite.inviter_id === actorId) {
    throw new Error("You cannot accept your own invite.");
  }
  if (invite.invitee_id && invite.invitee_id !== actorId) {
    throw new Error("This invite is for another player.");
  }

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", [invite.inviter_id, actorId]);

  if (profileError) {
    throw profileError;
  }

  const inviter = profiles?.find((profile) => profile.id === invite.inviter_id);
  const invitee = profiles?.find((profile) => profile.id === actorId);
  if (!inviter || !invitee) {
    throw new Error("Both players need profiles before starting a game.");
  }

  const state = createGameState(invite.game_id, [
    { id: inviter.id, name: inviter.display_name },
    { id: invitee.id, name: invitee.display_name },
  ]);

  const { error: playerError } = await admin.from("game_players").insert({
    game_id: invite.game_id,
    player_id: actorId,
    seat_index: 1,
    sucker_tokens: startingSuckerTokens,
  });

  if (playerError) {
    throw playerError;
  }

  await admin
    .from("game_invites")
    .update({
      invitee_id: actorId,
      status: "accepted",
    })
    .eq("id", invite.id);

  const { data: game, error: gameError } = await admin
    .from("games")
    .update({
      current_player_id: inviter.id,
      state,
      status: "active",
    })
    .eq("id", invite.game_id)
    .select()
    .single();

  if (gameError) {
    throw gameError;
  }

  await insertAction(admin, invite.game_id, actorId, "accept_invite", {
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
) {
  const game = await loadGameForActor(admin, gameId, actorId);
  const nextState = mutate(game.state);
  const nextPlayer = nextState.players[nextState.currentPlayerIndex];
  const { data, error } = await admin
    .from("games")
    .update({
      current_player_id: nextState.phase === "complete" ? null : nextPlayer.id,
      state: nextState,
      status: nextState.phase === "complete" ? "complete" : "active",
    })
    .eq("id", gameId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  await syncGamePlayers(
    admin,
    gameId,
    nextState,
    nextState.phase === "complete",
  );
  await insertAction(admin, gameId, actorId, actionType, {});
  return { game: data };
}

async function scoreRemoteTurn(
  admin: DbClient,
  actorId: string,
  gameId: string,
  category: ScoreCategory,
  scratch = false,
  submittedHeld?: GameState["held"],
) {
  const game = await loadGameForActor(admin, gameId, actorId);
  const state = game.state;
  assertCurrentPlayer(state, actorId);

  const currentPlayer = state.players[state.currentPlayerIndex];
  if (state.rollNumber === 0 || state.phase === "complete") {
    throw new Error("Roll before playing a score.");
  }
  if (currentPlayer.scorecard[category] !== null) {
    throw new Error("That score box is already filled.");
  }

  const turnHeld = normalizeHeld(submittedHeld, state.held);
  const turnIndex = countCompletedScores(state) + 1;
  const turnScore = scratch ? 0 : scoreCategoryForScorecard(
    state.dice,
    category,
    currentPlayer.scorecard,
  );
  const extraSuckerBonus = !scratch && category !== "sucker" &&
    currentPlayer.scorecard.sucker !== null && isSuckerRoll(state.dice);
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
    scoreCategories.every((scoreCategory) =>
      player.scorecard[scoreCategory] !== null
    )
  );
  const nextState: GameState = {
    ...state,
    currentPlayerIndex: complete
      ? state.currentPlayerIndex
      : (state.currentPlayerIndex + 1) % players.length,
    dice: [1, 1, 1, 1, 1],
    extraRollsAvailable: 0,
    held: [false, false, false, false, false],
    phase: complete ? "complete" : "rolling",
    players,
    rollNumber: 0,
  };
  const winner = complete
    ? [...players].sort((a, b) =>
      totalScore(b.scorecard) - totalScore(a.scorecard)
    )[0]
    : null;

  const { data: turn, error: turnError } = await admin
    .from("turns")
    .insert({
      category,
      dice: state.dice,
      game_id: gameId,
      held: turnHeld,
      player_id: actorId,
      roll_count: state.rollNumber,
      score: turnScore,
      status: complete ? "finalized" : "submitted",
      turn_index: turnIndex,
    })
    .select()
    .single();

  if (turnError) {
    throw turnError;
  }

  const { data: updatedGame, error: gameError } = await admin
    .from("games")
    .update({
      completed_at: complete ? new Date().toISOString() : null,
      current_player_id: complete
        ? null
        : players[nextState.currentPlayerIndex].id,
      last_turn_id: turn.id,
      state: nextState,
      status: complete ? "complete" : "response_window",
      winner_id: winner?.id ?? null,
    })
    .eq("id", gameId)
    .select()
    .single();

  if (gameError) {
    throw gameError;
  }

  for (const player of players) {
    await admin
      .from("game_players")
      .update({
        final_score: complete ? totalScore(player.scorecard) : null,
        sucker_tokens: player.suckerTokens,
        upper_bonus_awarded: upperBonus(player.scorecard) > 0,
      })
      .eq("game_id", gameId)
      .eq("player_id", player.id);
  }

  await insertAction(
    admin,
    gameId,
    actorId,
    scratch ? "scratch_category" : "score_category",
    {
      category,
      scratched: scratch,
      score: turnScore,
      turnId: turn.id,
    },
  );

  if (complete) {
    await writeCompletedGameStats(admin, gameId, players, winner?.id ?? null);
  }

  return {
    game: updatedGame,
    notificationProfileIds: complete
      ? players.map((player) => player.id)
      : [players[nextState.currentPlayerIndex].id],
  };
}

function scratchRemoteScoreBox(
  admin: DbClient,
  actorId: string,
  gameId: string,
  category: ScoreCategory,
  held?: GameState["held"],
) {
  return scoreRemoteTurn(admin, actorId, gameId, category, true, held);
}

async function passResponse(admin: DbClient, actorId: string, gameId: string) {
  const game = await loadGameForActor(admin, gameId, actorId);
  if (game.status !== "response_window") {
    throw new Error("There is no turn response to pass.");
  }
  if (game.current_player_id !== actorId) {
    throw new Error("Only the responding player can pass.");
  }

  const { data: updatedGame, error } = await admin
    .from("games")
    .update({
      status: "active",
    })
    .eq("id", gameId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  await insertAction(admin, gameId, actorId, "pass_response", {
    turnId: game.last_turn_id,
  });
  return { game: updatedGame };
}

async function mulliganTurn(admin: DbClient, actorId: string, gameId: string) {
  const game = await loadGameForActor(admin, gameId, actorId);
  if (game.status !== "response_window" || !game.last_turn_id) {
    throw new Error(
      "Mulligan is only available immediately after a submitted turn.",
    );
  }

  const turn = await loadTurn(admin, game.last_turn_id);
  if (turn.player_id !== actorId) {
    throw new Error("You can only Mulligan your own latest turn.");
  }

  const state = game.state;
  const player = findPlayer(state, actorId);
  if (player.suckerTokens < suckerTokenCosts.mulligan) {
    throw new Error(
      `You need ${suckerTokenCosts.mulligan} Sucker Tokens to Mulligan.`,
    );
  }

  const nextState = removeScoredTurn(
    state,
    turn,
    actorId,
    -suckerTokenCosts.mulligan,
  );
  const { data: updatedGame, error } = await admin
    .from("games")
    .update({
      current_player_id: actorId,
      state: nextState,
      status: "active",
    })
    .eq("id", gameId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  await admin.from("turns").update({ status: "mulliganed" }).eq("id", turn.id);
  await admin.from("token_events").insert({
    event_type: "mulligan",
    game_id: gameId,
    player_id: actorId,
    target_turn_id: turn.id,
    token_delta: -suckerTokenCosts.mulligan,
  });
  await syncGamePlayers(admin, gameId, nextState, false);
  await insertAction(admin, gameId, actorId, "mulligan", { turnId: turn.id });

  return { game: updatedGame };
}

async function suckerPunchTurn(
  admin: DbClient,
  actorId: string,
  gameId: string,
  turnId: string,
) {
  const game = await loadGameForActor(admin, gameId, actorId);
  if (game.status !== "response_window" || game.last_turn_id !== turnId) {
    throw new Error(
      "Sucker Punch can only target the opponent’s latest submitted turn.",
    );
  }

  const turn = await loadTurn(admin, turnId);
  if (turn.player_id === actorId) {
    throw new Error("You cannot Sucker Punch your own turn.");
  }

  const state = game.state;
  const actor = findPlayer(state, actorId);
  if (actor.suckerTokens < suckerTokenCosts.suckerPunch) {
    throw new Error(
      `You need ${suckerTokenCosts.suckerPunch} Sucker Tokens to Sucker Punch.`,
    );
  }

  let nextState = removeScoredTurn(state, turn, turn.player_id, 0);
  nextState = updatePlayerTokens(
    nextState,
    actorId,
    -suckerTokenCosts.suckerPunch,
  );

  const { data: updatedGame, error } = await admin
    .from("games")
    .update({
      current_player_id: turn.player_id,
      state: nextState,
      status: "blocked_response",
    })
    .eq("id", gameId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  await admin.from("turns").update({ status: "punched" }).eq("id", turn.id);
  await admin.from("token_events").insert({
    event_type: "sucker_punch",
    game_id: gameId,
    player_id: actorId,
    target_turn_id: turn.id,
    token_delta: -suckerTokenCosts.suckerPunch,
  });
  await syncGamePlayers(admin, gameId, nextState, false);
  await insertAction(admin, gameId, actorId, "sucker_punch", {
    turnId: turn.id,
    targetPlayerId: turn.player_id,
  });

  return { game: updatedGame, notificationProfileIds: [turn.player_id] };
}

async function blockSuckerPunch(
  admin: DbClient,
  actorId: string,
  gameId: string,
  turnId: string,
) {
  const game = await loadGameForActor(admin, gameId, actorId);
  if (game.status !== "blocked_response" || game.last_turn_id !== turnId) {
    throw new Error("There is no Sucker Punch to block.");
  }

  const turn = await loadTurn(admin, turnId);
  if (turn.player_id !== actorId || turn.status !== "punched") {
    throw new Error(
      "You can only block a Sucker Punch against your latest turn.",
    );
  }

  const state = game.state;
  const target = findPlayer(state, actorId);
  if (target.suckerTokens < suckerTokenCosts.suckerBlocker) {
    throw new Error(
      `You need ${suckerTokenCosts.suckerBlocker} Sucker Tokens to use Sucker Blocker.`,
    );
  }

  const restoredState = restoreScoredTurn(
    state,
    turn,
    -suckerTokenCosts.suckerBlocker,
  );
  const nextPlayer = restoredState.players.find((player) =>
    player.id !== actorId
  );
  if (!nextPlayer) {
    throw new Error("Unable to find the next player.");
  }
  const nextState: GameState = {
    ...restoredState,
    currentPlayerIndex: restoredState.players.findIndex((player) =>
      player.id === nextPlayer.id
    ),
    dice: [1, 1, 1, 1, 1],
    extraRollsAvailable: 0,
    held: [false, false, false, false, false],
    phase: "rolling",
    rollNumber: 0,
  };

  const { data: updatedGame, error } = await admin
    .from("games")
    .update({
      current_player_id: nextPlayer.id,
      state: nextState,
      status: "active",
    })
    .eq("id", gameId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  await admin.from("turns").update({ status: "blocked" }).eq("id", turn.id);
  await admin.from("token_events").insert({
    event_type: "sucker_blocker",
    game_id: gameId,
    player_id: actorId,
    target_turn_id: turn.id,
    token_delta: -suckerTokenCosts.suckerBlocker,
  });
  await syncGamePlayers(admin, gameId, nextState, false);
  await insertAction(admin, gameId, actorId, "sucker_blocker", {
    turnId: turn.id,
  });

  return { game: updatedGame, notificationProfileIds: [nextPlayer.id] };
}

async function loadGameForActor(
  admin: DbClient,
  gameId: string,
  actorId: string,
): Promise<GameRow> {
  const { data: participant, error: participantError } = await admin
    .from("game_players")
    .select("game_id")
    .eq("game_id", gameId)
    .eq("player_id", actorId)
    .maybeSingle();

  if (participantError) {
    throw participantError;
  }
  if (!participant) {
    throw new Error("You are not a player in this game.");
  }

  const { data: game, error } = await admin.from("games").select("*").eq(
    "id",
    gameId,
  ).single();
  if (error) {
    throw error;
  }

  return game;
}

async function loadTurn(admin: DbClient, turnId: string): Promise<TurnRow> {
  const { data: turn, error } = await admin.from("turns").select("*").eq(
    "id",
    turnId,
  ).single();
  if (error) {
    throw error;
  }

  return turn;
}

async function syncGamePlayers(
  admin: DbClient,
  gameId: string,
  state: GameState,
  complete: boolean,
) {
  for (const player of state.players) {
    await admin
      .from("game_players")
      .update({
        final_score: complete ? totalScore(player.scorecard) : null,
        sucker_tokens: player.suckerTokens,
        upper_bonus_awarded: upperBonus(player.scorecard) > 0,
      })
      .eq("game_id", gameId)
      .eq("player_id", player.id);
  }
}

function findPlayer(state: GameState, playerId: string): Player {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error("Player is not in this game.");
  }

  return player;
}

function removeScoredTurn(
  state: GameState,
  turn: TurnRow,
  playerId: string,
  tokenDelta: number,
): GameState {
  const category = toScoreCategory(turn.category);
  const playerIndex = state.players.findIndex((player) =>
    player.id === playerId
  );
  if (playerIndex < 0) {
    throw new Error("Turn player is not in this game.");
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
      suckerBonusCategories: player.suckerBonusCategories.filter((
        bonusCategory,
      ) => bonusCategory !== category),
      suckerTokens: Math.max(0, player.suckerTokens + tokenDelta),
    };
  });

  return {
    ...state,
    currentPlayerIndex: playerIndex,
    dice: [1, 1, 1, 1, 1],
    extraRollsAvailable: 0,
    held: [false, false, false, false, false],
    phase: "rolling",
    players,
    rollNumber: 0,
  };
}

function restoreScoredTurn(
  state: GameState,
  turn: TurnRow,
  tokenDelta: number,
): GameState {
  const category = toScoreCategory(turn.category);
  const hasBonus = category !== "sucker" && isSuckerRoll(toDice(turn.dice));
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

function updatePlayerTokens(
  state: GameState,
  playerId: string,
  tokenDelta: number,
): GameState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === playerId
        ? {
          ...player,
          suckerTokens: Math.max(0, player.suckerTokens + tokenDelta),
        }
        : player
    ),
  };
}

function createGameState(
  gameId: string,
  profiles: Array<{ id: string; name: string }>,
): GameState {
  return {
    currentPlayerIndex: 0,
    dice: [1, 1, 1, 1, 1],
    extraRollsAvailable: 0,
    held: [false, false, false, false, false],
    id: gameId,
    phase: "rolling",
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

function rollGame(
  state: GameState,
  actorId: string,
  submittedHeld?: GameState["held"],
): GameState {
  assertCurrentPlayer(state, actorId);
  if (
    state.phase === "complete" || state.rollNumber >= maxAvailableRolls(state)
  ) {
    throw new Error("No rolls remaining.");
  }

  const held = state.rollNumber === 0
    ? [false, false, false, false, false] as GameState["held"]
    : normalizeHeld(submittedHeld, state.held);

  return {
    ...state,
    held,
    dice: state.dice.map((
      die,
      index,
    ) => (held[index] ? die : rollDie(cryptoRandom))) as Dice,
    phase: "scoring",
    rollNumber: state.rollNumber + 1,
  };
}

function purchaseExtraRoll(
  state: GameState,
  actorId: string,
  submittedHeld?: GameState["held"],
): GameState {
  assertCurrentPlayer(state, actorId);
  const player = findPlayer(state, actorId);
  if (
    state.phase === "complete" || state.rollNumber < maxAvailableRolls(state)
  ) {
    throw new Error(
      "Extra Roll is available after you use every available roll.",
    );
  }
  if (player.suckerTokens < suckerTokenCosts.extraRoll) {
    throw new Error(
      `You need ${suckerTokenCosts.extraRoll} Sucker Token to buy an Extra Roll.`,
    );
  }

  return {
    ...updatePlayerTokens(state, actorId, -suckerTokenCosts.extraRoll),
    extraRollsAvailable: Math.max(0, state.extraRollsAvailable ?? 0) + 1,
    held: normalizeHeld(submittedHeld, state.held),
  };
}

function maxAvailableRolls(
  state: Pick<GameState, "extraRollsAvailable">,
): number {
  return maxRollsPerTurn + Math.max(0, state.extraRollsAvailable ?? 0);
}

function normalizeHeld(
  submittedHeld: GameState["held"] | undefined,
  fallback: GameState["held"],
): GameState["held"] {
  if (!submittedHeld) {
    return fallback;
  }
  if (
    submittedHeld.length !== 5 ||
    submittedHeld.some((held) => typeof held !== "boolean")
  ) {
    throw new Error("Invalid held dice.");
  }

  return [...submittedHeld] as GameState["held"];
}

function cryptoRandom(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / (0xffffffff + 1);
}

function assertCurrentPlayer(state: GameState, actorId: string) {
  if (state.players[state.currentPlayerIndex]?.id !== actorId) {
    throw new Error("It is not your turn.");
  }
}

function countCompletedScores(state: GameState): number {
  return state.players.reduce(
    (total, player) =>
      total +
      scoreCategories.filter((category) => player.scorecard[category] !== null)
        .length,
    0,
  );
}

async function writeCompletedGameStats(
  admin: DbClient,
  gameId: string,
  players: Player[],
  winnerId: string | null,
) {
  for (const player of players) {
    const opponent = players.find((candidate) => candidate.id !== player.id)!;
    const result = buildResult(gameId, player, opponent.id, winnerId);
    await admin.from("game_player_results").upsert(result);
    const { data: existing, error } = await admin
      .from("head_to_head_stats")
      .select("*")
      .eq("player_id", player.id)
      .eq("opponent_id", opponent.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!existing) {
      await admin.from("head_to_head_stats").insert({
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
      });
      continue;
    }

    const gamesPlayed = existing.games_played + 1;
    const totalScoreValue = existing.total_score + result.final_score;
    await admin
      .from("head_to_head_stats")
      .update({
        average_score: Number((totalScoreValue / gamesPlayed).toFixed(2)),
        four_of_a_kind_games: existing.four_of_a_kind_games +
          (result.four_of_a_kind_count > 0 ? 1 : 0),
        full_house_games: existing.full_house_games +
          (result.full_house_count > 0 ? 1 : 0),
        games_played: gamesPlayed,
        highest_score: Math.max(existing.highest_score, result.final_score),
        large_straight_games: existing.large_straight_games +
          (result.large_straight_count > 0 ? 1 : 0),
        losses: existing.losses + (result.won ? 0 : 1),
        small_straight_games: existing.small_straight_games +
          (result.small_straight_count > 0 ? 1 : 0),
        sucker_games: existing.sucker_games + (result.sucker_count > 0 ? 1 : 0),
        three_of_a_kind_games: existing.three_of_a_kind_games +
          (result.three_of_a_kind_count > 0 ? 1 : 0),
        total_score: totalScoreValue,
        upper_bonus_games: existing.upper_bonus_games +
          (result.upper_bonus_awarded ? 1 : 0),
        wins: existing.wins + (result.won ? 1 : 0),
      })
      .eq("player_id", player.id)
      .eq("opponent_id", opponent.id);
  }
}

function buildResult(
  gameId: string,
  player: Player,
  opponentId: string,
  winnerId: string | null,
) {
  return {
    final_score: totalScore(player.scorecard),
    four_of_a_kind_count:
      player.scorecard.fourOfAKind !== null && player.scorecard.fourOfAKind > 0
        ? 1
        : 0,
    full_house_count:
      player.scorecard.fullHouse !== null && player.scorecard.fullHouse > 0
        ? 1
        : 0,
    game_id: gameId,
    large_straight_count: player.scorecard.largeStraight !== null &&
        player.scorecard.largeStraight > 0
      ? 1
      : 0,
    opponent_id: opponentId,
    player_id: player.id,
    small_straight_count: player.scorecard.smallStraight !== null &&
        player.scorecard.smallStraight > 0
      ? 1
      : 0,
    sucker_count:
      player.scorecard.sucker !== null && player.scorecard.sucker > 0 ? 1 : 0,
    three_of_a_kind_count: player.scorecard.threeOfAKind !== null &&
        player.scorecard.threeOfAKind > 0
      ? 1
      : 0,
    upper_bonus_awarded: upperBonus(player.scorecard) > 0,
    won: player.id === winnerId,
  };
}

async function insertAction(
  admin: DbClient,
  gameId: string,
  actorId: string,
  actionType: ActionType,
  payload: Record<string, unknown>,
) {
  await admin.from("turn_actions").insert({
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${JSON.stringify(value)}`);
}
