import { createClient, type Session, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Database } from '../functions/_shared/database.types.ts';
import {
  scoreCategories,
  startingSuckerTokens,
  suckerTokenCosts,
  type GameState,
  type ScoreCategory,
} from '../functions/_shared/game.ts';

type DbClient = SupabaseClient<Database>;
type GameRow = Database['public']['Tables']['games']['Row'];
type TurnRow = Database['public']['Tables']['turns']['Row'];
type ActionRow = Database['public']['Tables']['turn_actions']['Row'];
type TokenEventRow = Database['public']['Tables']['token_events']['Row'];
type GamePlayerTokenRow = Pick<Database['public']['Tables']['game_players']['Row'], 'player_id' | 'sucker_tokens'>;
type GamePlayerResultRow = Database['public']['Tables']['game_player_results']['Row'];
type HeadToHeadStatsRow = Database['public']['Tables']['head_to_head_stats']['Row'];
type TestUser = {
  client: DbClient;
  email: string;
  id: string;
  session: Session;
};

const supabaseUrl = requireEnv('SUPABASE_URL');
const anonKey = requireEnv('SUPABASE_ANON_KEY');
const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const functionUrl = `${supabaseUrl}/functions/v1/game-action`;
const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const supabaseClients: DbClient[] = [admin];
const falseHeld = [false, false, false, false, false] as GameState['held'];

Deno.test('avatar storage limits writes and deletes to the owning profile folder', async () => {
  const [alice, bob] = await createUsers('avatar-storage', ['Alice', 'Bob']);
  const path = `${alice.id}/rls-test.jpg`;
  const upload = await alice.client.storage.from('avatars').upload(path, new Uint8Array([255, 216, 255, 217]), {
    contentType: 'image/jpeg',
  });
  assertNoError(upload.error);

  const forbiddenDelete = await bob.client.storage.from('avatars').remove([path]);
  assertEquals(forbiddenDelete.data?.length ?? 0, 0);
  const stored = await admin.storage.from('avatars').list(alice.id, { search: 'rls-test.jpg' });
  assertNoError(stored.error);
  assertEquals(stored.data?.length ?? 0, 1);

  const ownerDelete = await alice.client.storage.from('avatars').remove([path]);
  assertNoError(ownerDelete.error);
  const removed = await admin.storage.from('avatars').list(alice.id, { search: 'rls-test.jpg' });
  assertNoError(removed.error);
  assertEquals(removed.data?.length ?? 0, 0);
});

Deno.test('game-action invite flow enforces auth, RLS, and turn ownership', async () => {
  const [alice, bob, charlie] = await createUsers('invite-flow', ['Alice', 'Bob', 'Charlie']);

  const unauthorized = await invokeWithoutAuth({ type: 'create_invite' });
  assertEquals(unauthorized.status, 401);
  assertEquals(unauthorized.body.error, 'Unauthorized');

  const legacyInvite = await invokeGameAction(alice, { type: 'create_invite' }, 200, false);
  assertString(legacyInvite.inviteCode);

  const invite = await invokeGameAction(alice, { type: 'create_invite' });
  assertString(invite.inviteCode);

  const accepted = await invokeGameAction(bob, { inviteCode: invite.inviteCode, type: 'accept_invite' });
  const game = accepted.game as GameRow;
  assertEquals(game.status, 'active');
  assertEquals(game.current_player_id, alice.id);

  const wrongTurn = await invokeGameAction(bob, { gameId: game.id, type: 'roll' }, 400);
  assertEquals(wrongTurn.error, 'It is not your turn.');

  const visibleToAlice = await selectSingle<{ id: string }>(
    alice.client.from('games').select('id').eq('id', game.id).single(),
  );
  assertEquals(visibleToAlice.id, game.id);

  const hiddenFromCharlie = await selectMaybe<{ id: string }>(
    charlie.client.from('games').select('id').eq('id', game.id).maybeSingle(),
  );
  assertEquals(hiddenFromCharlie, null);

  const players = await selectMany<GamePlayerTokenRow>(
    admin.from('game_players').select('player_id, sucker_tokens').eq('game_id', game.id).order('seat_index'),
  );
  assertEquals(players.length, 2);
  assertEquals(players[0].sucker_tokens, startingSuckerTokens);
  assertEquals(players[1].sucker_tokens, startingSuckerTokens);

  const actions = await loadActions(game.id);
  assertEquals(
    actions.map((action) => action.action_type),
    ['create_invite', 'accept_invite'],
  );
});

Deno.test('game-action request ids prevent replayed mutations and remain private', async () => {
  const [alice, bob] = await createUsers('idempotent-actions', ['Alice', 'Bob']);
  const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;
  const requestId = crypto.randomUUID();
  const action = { gameId: game.id, held: falseHeld, requestId, type: 'roll' };

  const first = (await invokeGameAction(alice, action)).game as GameRow;
  const replay = (await invokeGameAction(alice, action)).game as GameRow;
  assertEquals(replay.state, first.state);

  const rollActions = (await loadActions(game.id)).filter((item) => item.action_type === 'roll');
  assertEquals(rollActions.length, 1);

  const mismatchedReplay = await invokeGameAction(alice, { gameId: game.id, requestId, type: 'pass_response' }, 400);
  assertEquals(mismatchedReplay.error, 'Request id was already used for a different action.');

  const privateRequest = await alice.client
    .from('game_action_requests')
    .select('request_id')
    .eq('request_id', requestId)
    .maybeSingle();
  if (!privateRequest.error) {
    throw new Error('Expected the internal action request ledger to be inaccessible to authenticated clients.');
  }

  const malformed = await invokeGameAction(alice, { gameId: game.id, requestId: 'not-a-uuid', type: 'roll' }, 400);
  assertEquals(malformed.error, 'Invalid multiplayer action field: requestId.');
});

Deno.test('game-action rejects direct writes, token spoofing, oversized bodies, and action floods', async () => {
  const [alice, bob] = await createUsers('action-abuse', ['Alice', 'Bob']);
  const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;

  const directGameWrite = await alice.client.from('games').update({ status: 'complete' }).eq('id', game.id);
  assertNoError(directGameWrite.error);
  const unchangedGame = await selectSingle<{ status: string }>(
    admin.from('games').select('status').eq('id', game.id).single(),
  );
  assertEquals(unchangedGame.status, 'active');

  const spoofedPushToken = await alice.client.from('push_tokens').insert({
    expo_push_token: `ExponentPushToken[${crypto.randomUUID()}]`,
    platform: 'ios',
    profile_id: bob.id,
  });
  if (!spoofedPushToken.error) {
    throw new Error('Expected users to be unable to register push tokens for another profile.');
  }

  const ownWebPush = await alice.client.from('web_push_subscriptions').insert({
    auth_key: 'test-auth',
    endpoint: `https://push.example.test/${crypto.randomUUID()}`,
    p256dh_key: 'test-p256dh',
    profile_id: alice.id,
  });
  assertNoError(ownWebPush.error);

  const oversized = await fetch(functionUrl, {
    body: JSON.stringify({ padding: 'x'.repeat(33_000), requestId: crypto.randomUUID(), type: 'create_invite' }),
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${alice.session.access_token}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  assertEquals(oversized.status, 413);

  const floodRows = Array.from({ length: 120 }, () => ({
    action_type: 'abuse-test',
    actor_id: alice.id,
    http_status: 200,
    request_id: crypto.randomUUID(),
    response: {},
    status: 'completed' as const,
  }));
  assertNoError((await admin.from('game_action_requests').insert(floodRows)).error);
  const rateLimited = await invokeGameAction(alice, { type: 'create_invite' }, 429);
  assertEquals(rateLimited.error, 'Too many game actions. Wait a moment and try again.');
});

Deno.test('game-action removes open invites and hides started games from the actor', async () => {
  const [alice, bob] = await createUsers('remove-games', ['Alice', 'Bob']);

  const invite = await invokeGameAction(alice, { type: 'create_invite' });
  const inviteGameId = (invite.game as GameRow).id;
  const removedInvite = await invokeGameAction(alice, { gameId: inviteGameId, type: 'remove_game' });
  assertEquals(removedInvite.removedGameId, inviteGameId);

  const deletedGame = await selectMaybe<{ id: string }>(
    admin.from('games').select('id').eq('id', inviteGameId).maybeSingle(),
  );
  assertEquals(deletedGame, null);
  const deletedInvite = await selectMaybe<{ game_id: string }>(
    admin.from('game_invites').select('game_id').eq('game_id', inviteGameId).maybeSingle(),
  );
  assertEquals(deletedInvite, null);

  const activeGame = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' }))
    .game as GameRow;
  const removedGame = await invokeGameAction(alice, { gameId: activeGame.id, type: 'remove_game' });
  assertEquals(removedGame.removedGameId, activeGame.id);

  const hiddenFromAlice = await selectMaybe<{ id: string }>(
    alice.client.from('games').select('id').eq('id', activeGame.id).maybeSingle(),
  );
  assertEquals(hiddenFromAlice, null);

  const visibleToBob = await selectSingle<{ id: string }>(
    bob.client.from('games').select('id').eq('id', activeGame.id).single(),
  );
  assertEquals(visibleToBob.id, activeGame.id);

  const alicePlayer = await selectSingle<{ hidden_at: string | null }>(
    admin.from('game_players').select('hidden_at').eq('game_id', activeGame.id).eq('player_id', alice.id).single(),
  );
  assertString(alicePlayer.hidden_at);

  const hiddenPlayerAction = await invokeGameAction(alice, { gameId: activeGame.id, type: 'roll' }, 400);
  assertEquals(hiddenPlayerAction.error, 'You are not a player in this game.');
});

Deno.test('game-action nudges the current player only after the wait window and cooldown', async () => {
  const [alice, bob] = await createUsers('nudge-turn', ['Alice', 'Bob']);
  const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;

  const currentPlayerNudge = await invokeGameAction(alice, { gameId: game.id, type: 'nudge_turn' }, 400);
  assertEquals(currentPlayerNudge.error, 'It is your turn.');

  const earlyNudge = await invokeGameAction(bob, { gameId: game.id, type: 'nudge_turn' }, 400);
  assertEquals(earlyNudge.error, 'You can nudge after it has been their turn for 1 hour.');

  await delay(1_100);

  const nudge = await invokeGameAction(bob, { gameId: game.id, type: 'nudge_turn' });
  assertEquals((nudge.game as GameRow).id, game.id);
  assertEquals(nudge.notificationProfileIds, [alice.id]);

  const repeatNudge = await invokeGameAction(bob, { gameId: game.id, type: 'nudge_turn' }, 400);
  assertEquals(repeatNudge.error, 'You can nudge this player again 8 hours after your last nudge.');

  const actions = await loadActions(game.id);
  assertEquals(
    actions.filter((action) => action.action_type === 'nudge_turn').map((action) => action.actor_id),
    [bob.id],
  );
});

Deno.test('game-action persists extra roll, mulligan, and sucker punch chance state', async () => {
  const [alice, bob] = await createUsers('token-actions', ['Alice', 'Bob']);
  const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;

  for (let rollIndex = 0; rollIndex < 4; rollIndex += 1) {
    await invokeGameAction(alice, { gameId: game.id, held: falseHeld, type: 'roll' });
  }
  await invokeGameAction(alice, { gameId: game.id, held: falseHeld, type: 'extra_roll' });
  await invokeGameAction(alice, { gameId: game.id, held: falseHeld, type: 'roll' });

  const firstScore = (
    await invokeGameAction(alice, {
      category: 'sucker',
      gameId: game.id,
      held: falseHeld,
      type: 'score_category',
    })
  ).game as GameRow;
  assertEquals(firstScore.status, 'response_window');
  assertString(firstScore.last_turn_id);
  assertPlayerTokens(firstScore, alice.id, startingSuckerTokens - suckerTokenCosts.extraRoll);

  const mulligan = (await invokeGameAction(alice, { gameId: game.id, type: 'mulligan' })).game as GameRow;
  assertEquals(mulligan.status, 'active');
  assertEquals(mulligan.current_player_id, alice.id);
  assertPlayerTokens(mulligan, alice.id, startingSuckerTokens - suckerTokenCosts.extraRoll - suckerTokenCosts.mulligan);
  assertEquals((await loadTurn(firstScore.last_turn_id)).status, 'mulliganed');

  await invokeGameAction(alice, { gameId: game.id, held: falseHeld, type: 'roll' });
  const secondScore = (
    await invokeGameAction(alice, {
      category: 'ones',
      gameId: game.id,
      held: falseHeld,
      type: 'score_category',
    })
  ).game as GameRow;
  assertEquals(secondScore.status, 'response_window');
  assertString(secondScore.last_turn_id);

  const punched = (
    await invokeGameAction(bob, {
      gameId: game.id,
      turnId: secondScore.last_turn_id,
      type: 'sucker_punch',
    })
  ).game as GameRow;
  assertEquals(punched.status, 'active');
  assertEquals(punched.current_player_id, alice.id);
  assertPlayerTokens(punched, bob.id, startingSuckerTokens - suckerTokenCosts.suckerPunch);
  assertEquals((await loadTurn(secondScore.last_turn_id)).status, 'punched');
  assertEquals(punched.state.players.find((player) => player.id === alice.id)?.scorecard.ones, null);

  const events = await loadTokenEvents(game.id);
  assertEquals(
    events.map((event) => [event.event_type, event.player_id, event.token_delta]),
    [
      ['mulligan', alice.id, -suckerTokenCosts.mulligan],
      ['sucker_punch', bob.id, -suckerTokenCosts.suckerPunch],
    ],
  );

  const actions = await loadActions(game.id);
  assertIncludes(
    actions.map((action) => action.action_type),
    'extra_roll',
  );
  assertIncludes(
    actions.map((action) => action.action_type),
    'mulligan',
  );
  assertIncludes(
    actions.map((action) => action.action_type),
    'sucker_punch',
  );
  const punchAction = actions.find((action) => action.action_type === 'sucker_punch');
  assertEquals(actionPayloadValue(punchAction?.payload, 'landed'), true);
  assertEquals(actionPayloadValue(punchAction?.payload, 'chanceDie'), 6);
  assertEquals(actionPayloadValue(punchAction?.payload, 'chancePercent'), 90);
});

Deno.test('game-action scoring zero does not award a sucker token', async () => {
  const [alice, bob] = await createUsers('zero-score-token', ['Alice', 'Bob']);
  const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;
  const scoringState: GameState = {
    ...game.state,
    dice: [1, 2, 3, 4, 5],
    phase: 'scoring',
    rollNumber: 1,
  };

  assertNoError((await admin.from('games').update({ state: scoringState }).eq('id', game.id)).error);

  const scored = (
    await invokeGameAction(alice, {
      category: 'sixes',
      gameId: game.id,
      held: falseHeld,
      type: 'score_category',
    })
  ).game as GameRow;

  assertEquals(scored.state.players[0].scorecard.sixes, 0);
  assertPlayerTokens(scored, alice.id, startingSuckerTokens);
});

Deno.test('game-action lets a punched player replay instead of blocking', async () => {
  const [alice, bob] = await createUsers('punch-replay', ['Alice', 'Bob']);
  const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;

  await invokeGameAction(alice, { gameId: game.id, held: falseHeld, type: 'roll' });
  const firstScore = (
    await invokeGameAction(alice, {
      category: 'sucker',
      gameId: game.id,
      held: falseHeld,
      type: 'score_category',
    })
  ).game as GameRow;
  assertEquals(firstScore.status, 'response_window');
  assertString(firstScore.last_turn_id);

  const punched = (
    await invokeGameAction(bob, {
      gameId: game.id,
      turnId: firstScore.last_turn_id,
      type: 'sucker_punch',
    })
  ).game as GameRow;
  assertEquals(punched.status, 'active');
  assertEquals(punched.current_player_id, alice.id);
  assertEquals((await loadTurn(firstScore.last_turn_id)).status, 'punched');

  const replayRoll = (await invokeGameAction(alice, { gameId: game.id, held: falseHeld, type: 'roll' }))
    .game as GameRow;
  assertEquals(replayRoll.status, 'active');
  assertEquals(replayRoll.current_player_id, alice.id);

  const replayScore = (
    await invokeGameAction(alice, {
      category: 'sucker',
      gameId: game.id,
      held: falseHeld,
      type: 'score_category',
    })
  ).game as GameRow;
  assertEquals(replayScore.status, 'response_window');
  assertEquals(replayScore.current_player_id, bob.id);
  assertString(replayScore.last_turn_id);
  assertEquals((await loadTurn(replayScore.last_turn_id)).status, 'submitted');

  const turns = await selectMany<TurnRow>(admin.from('turns').select('*').eq('game_id', game.id).order('turn_index'));
  assertEquals(
    turns.map((turn) => turn.status),
    ['punched', 'submitted'],
  );
});

Deno.test('game-action scratches, pass responses, game completion, and stats are written end to end', async () => {
  const [alice, bob] = await createUsers('completion', ['Alice', 'Bob']);
  const created = await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' });
  const gameId = (created.game as GameRow).id;
  let latestGame = created.game as GameRow;

  for (const category of scoreCategories) {
    latestGame = await scratchAndPass(gameId, alice, bob, category);
    latestGame = await scratchAndPass(gameId, bob, alice, category);
  }

  assertEquals(latestGame.status, 'complete');
  assertEquals(latestGame.current_player_id, null);
  assertEquals(latestGame.winner_id, null);
  assertString(latestGame.completed_at);

  const turns = await selectMany<TurnRow>(admin.from('turns').select('*').eq('game_id', gameId));
  assertEquals(turns.length, scoreCategories.length * 2);
  assertEquals(
    turns.every((turn) => turn.status === 'finalized' || turn.status === 'submitted'),
    true,
  );

  const results = await selectMany<GamePlayerResultRow>(
    admin.from('game_player_results').select('*').eq('game_id', gameId),
  );
  assertEquals(results.length, 2);
  assertEquals(
    results.every((result) => result.final_score === 0),
    true,
  );
  assertEquals(
    results.every((result) => result.sucker_tokens_leftover === startingSuckerTokens + scoreCategories.length),
    true,
  );
  assertEquals(
    results.every((result) => !result.won),
    true,
  );

  const stats = await selectMany<HeadToHeadStatsRow>(admin.from('head_to_head_stats').select('*'));
  assertEquals(stats.length, 2);
  assertEquals(
    stats.every((row) => row.games_played === 1),
    true,
  );
  assertEquals(
    stats.every((row) => row.wins === 0 && row.losses === 0),
    true,
  );

  const actions = await loadActions(gameId);
  assertEquals(
    actions.filter((action) => action.action_type === 'scratch_category').length,
    scoreCategories.length * 2,
  );
  assertEquals(
    actions.filter((action) => action.action_type === 'pass_response').length,
    scoreCategories.length * 2 - 1,
  );
});

Deno.test('game-action creates one rematch and alternates the first player', async () => {
  const [alice, bob] = await createUsers('rematch', ['Alice', 'Bob']);
  const created = await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' });
  const originalGameId = (created.game as GameRow).id;
  let completedGame = created.game as GameRow;

  for (const category of scoreCategories) {
    completedGame = await scratchAndPass(originalGameId, alice, bob, category);
    completedGame = await scratchAndPass(originalGameId, bob, alice, category);
  }

  assertEquals(completedGame.status, 'complete');

  const [aliceRematchResult, bobRematchResult] = await Promise.all([
    invokeGameAction(alice, { gameId: originalGameId, type: 'rematch_game' }),
    invokeGameAction(bob, { gameId: originalGameId, type: 'rematch_game' }),
  ]);
  const aliceRematch = aliceRematchResult.game as GameRow;
  const bobRematch = bobRematchResult.game as GameRow;

  assertEquals(aliceRematch.id, bobRematch.id);
  assertEquals(aliceRematch.rematch_of_game_id, originalGameId);
  assertEquals(aliceRematch.current_player_id, bob.id);
  assertEquals(
    aliceRematch.state.players.map((player) => player.id),
    [bob.id, alice.id],
  );

  const rematchGames = await selectMany<GameRow>(
    admin.from('games').select('*').eq('rematch_of_game_id', originalGameId),
  );
  assertEquals(rematchGames.length, 1);

  const rematchPlayers = await selectMany<{ player_id: string; seat_index: number }>(
    admin.from('game_players').select('player_id, seat_index').eq('game_id', aliceRematch.id).order('seat_index'),
  );
  assertEquals(
    rematchPlayers.map((player) => player.player_id),
    [bob.id, alice.id],
  );

  const rematchActions = await loadActions(aliceRematch.id);
  assertEquals(
    rematchActions.map((action) => action.action_type),
    ['rematch_game'],
  );

  let completedRematch = aliceRematch;
  for (const category of scoreCategories) {
    completedRematch = await scratchAndPass(aliceRematch.id, bob, alice, category);
    completedRematch = await scratchAndPass(aliceRematch.id, alice, bob, category);
  }
  assertEquals(completedRematch.status, 'complete');

  const stats = await selectMany<HeadToHeadStatsRow>(
    admin.from('head_to_head_stats').select('*').in('player_id', [alice.id, bob.id]),
  );
  assertEquals(stats.length, 2);
  assertEquals(
    stats.every((row) => row.games_played === 2),
    true,
  );
  assertEquals(
    stats.every((row) => row.wins === 0 && row.losses === 0),
    true,
  );

  const secondRematch = (await invokeGameAction(bob, { gameId: aliceRematch.id, type: 'rematch_game' }))
    .game as GameRow;
  assertEquals(secondRematch.current_player_id, alice.id);
  assertEquals(
    secondRematch.state.players.map((player) => player.id),
    [alice.id, bob.id],
  );
});

Deno.test({
  name: 'cleanup Supabase clients',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await Promise.all(supabaseClients.map((client) => client.removeAllChannels()));
    supabaseClients.forEach((client) => {
      client.realtime.disconnect();
      client.auth.stopAutoRefresh();
    });
  },
});

async function scratchAndPass(gameId: string, actor: TestUser, responder: TestUser, category: ScoreCategory) {
  await invokeGameAction(actor, { gameId, held: falseHeld, type: 'roll' });
  const scratched = (
    await invokeGameAction(actor, {
      category,
      gameId,
      held: falseHeld,
      type: 'scratch_category',
    })
  ).game as GameRow;
  const player = scratched.state.players.find((candidate) => candidate.id === actor.id);
  assertEquals(player?.scorecard[category], 0);

  if (scratched.status === 'complete') {
    return scratched;
  }

  assertEquals(scratched.status, 'response_window');
  assertEquals(scratched.current_player_id, responder.id);
  return (await invokeGameAction(responder, { gameId, type: 'pass_response' })).game as GameRow;
}

async function createUsers(prefix: string, displayNames: string[]) {
  const unique = `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const users: TestUser[] = [];

  for (const displayName of displayNames) {
    const email = `${unique}-${slugify(displayName)}@example.test`;
    const password = 'Password1!';
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
      user_metadata: { display_name: displayName },
    });
    assertNoError(createError);
    if (!created.user) {
      throw new Error(`Unable to create ${displayName}.`);
    }

    await upsertProfile(created.user.id, displayName);

    const client = createClient<Database>(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    supabaseClients.push(client);
    const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email, password });
    assertNoError(signInError);
    if (!signedIn.session) {
      throw new Error(`Unable to sign in ${displayName}.`);
    }

    users.push({
      client,
      email,
      id: created.user.id,
      session: signedIn.session,
    });
  }

  return users;
}

async function upsertProfile(id: string, displayName: string) {
  const { error } = await admin.from('profiles').upsert({
    display_name: displayName,
    id,
    username: `${slugify(displayName)}_${id.slice(0, 8)}`,
  });
  assertNoError(error);
}

async function invokeWithoutAuth(body: Record<string, unknown>) {
  const requestBody = { requestId: crypto.randomUUID(), ...body };
  const {
    body: payload,
    serverTiming,
    status,
  } = await fetchJsonWithRetry(
    functionUrl,
    {
      body: JSON.stringify(requestBody),
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
    401,
  );
  return { body: payload, status };
}

async function invokeGameAction(
  user: TestUser,
  body: Record<string, unknown>,
  expectedStatus = 200,
  includeRequestId = true,
) {
  const requestBody = includeRequestId ? { requestId: crypto.randomUUID(), ...body } : body;
  const {
    body: payload,
    serverTiming,
    status,
  } = await fetchJsonWithRetry(
    functionUrl,
    {
      body: JSON.stringify(requestBody),
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${user.session.access_token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
    expectedStatus,
  );
  if (status !== expectedStatus) {
    throw new Error(`Expected game-action ${expectedStatus}, received ${status}: ${JSON.stringify(payload)}`);
  }
  if (expectedStatus === 200) {
    assertString(serverTiming);
    if (!serverTiming.includes('total;dur=')) {
      throw new Error(`Expected Server-Timing total duration, received ${serverTiming}.`);
    }
  }
  return payload;
}

async function fetchJsonWithRetry(url: string, init: RequestInit, expectedStatus: number) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, init);
      const text = await response.text();
      const parsed = text.length > 0 ? JSON.parse(text) : null;
      if (response.status === expectedStatus && parsed !== null) {
        return {
          body: parsed as Record<string, unknown>,
          serverTiming: response.headers.get('server-timing'),
          status: response.status,
        };
      }

      const isTransient = response.status >= 500 || parsed === null;
      if (!isTransient || attempt === 2) {
        return { body: parsed, serverTiming: response.headers.get('server-timing'), status: response.status };
      }
      lastError = new Error(`Transient game-action response ${response.status}: ${text || '<empty body>'}`);
    } catch (error) {
      lastError = error;
      if (attempt === 2) {
        throw error;
      }
    }

    await delay(250 * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function loadTurn(turnId: string | null): Promise<TurnRow> {
  assertString(turnId);
  return selectSingle(admin.from('turns').select('*').eq('id', turnId).single());
}

async function loadActions(gameId: string): Promise<ActionRow[]> {
  return selectMany(admin.from('turn_actions').select('*').eq('game_id', gameId).order('created_at'));
}

async function loadTokenEvents(gameId: string): Promise<TokenEventRow[]> {
  return selectMany(admin.from('token_events').select('*').eq('game_id', gameId).order('created_at'));
}

async function selectSingle<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await query;
  assertNoError(error);
  if (!data) {
    throw new Error('Expected one row.');
  }
  return data;
}

async function selectMaybe<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  const { data, error } = await query;
  assertNoError(error);
  return data;
}

async function selectMany<T>(query: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await query;
  assertNoError(error);
  return data ?? [];
}

function assertPlayerTokens(game: GameRow, playerId: string, expected: number) {
  const player = game.state.players.find((candidate) => candidate.id === playerId);
  assertEquals(player?.suckerTokens, expected);
}

function assertNoError(error: unknown) {
  if (error) {
    throw new Error(error instanceof Error ? error.message : JSON.stringify(error));
  }
}

function assertString(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected a non-empty string, received ${JSON.stringify(value)}.`);
  }
}

function assertIncludes<T>(values: T[], expected: T) {
  if (!values.includes(expected)) {
    throw new Error(`Expected ${JSON.stringify(values)} to include ${JSON.stringify(expected)}.`);
  }
}

function actionPayloadValue(payload: unknown, key: string) {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)[key]
    : undefined;
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
  }
}

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
