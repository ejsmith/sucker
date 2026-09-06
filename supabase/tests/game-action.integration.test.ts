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
type ProfileStatsRow = Database['public']['Functions']['get_profile_stat_rates']['Returns'][number];
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

Deno.test('open invite codes stay private while deliberate code redemption works', async () => {
  const [alice, bob, charlie] = await createUsers('private-invite', ['Alice', 'Bob', 'Charlie']);
  const invite = await invokeGameAction(alice, { type: 'create_invite' });
  const game = invite.game as GameRow;

  const readInvite = (user: TestUser) =>
    selectMany<{ invite_code: string }>(user.client.from('game_invites').select('invite_code').eq('game_id', game.id));

  assertEquals(await readInvite(alice), [{ invite_code: invite.inviteCode }]);
  assertEquals(await readInvite(charlie), []);
  assertEquals(await readInvite(bob), []);

  const accepted = await invokeGameAction(bob, { inviteCode: invite.inviteCode, type: 'accept_invite' });
  assertEquals((accepted.game as GameRow).id, game.id);
  assertEquals(await readInvite(bob), [{ invite_code: invite.inviteCode }]);
  assertEquals(await readInvite(charlie), []);

  const targeted = await invokeGameAction(alice, { type: 'create_invite' });
  const targetedGame = targeted.game as GameRow;
  assertNoError((await admin.from('game_invites').update({ invitee_id: bob.id }).eq('game_id', targetedGame.id)).error);
  const recipientInvite = await selectMany<{ invite_code: string }>(
    bob.client.from('game_invites').select('invite_code').eq('game_id', targetedGame.id),
  );
  assertEquals(recipientInvite, [{ invite_code: targeted.inviteCode }]);
  const unrelatedInvite = await selectMany<{ invite_code: string }>(
    charlie.client.from('game_invites').select('invite_code').eq('game_id', targetedGame.id),
  );
  assertEquals(unrelatedInvite, []);
});

Deno.test('profile stats aggregate every matchup and are visible to signed-in players', async () => {
  const [alice, bob, charlie] = await createUsers('profile-stats', ['Alice', 'Bob', 'Charlie']);
  await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' });

  const inserted = await Promise.all([
    admin.from('head_to_head_stats').insert({
      games_played: 1,
      highest_score: 120,
      losses: 1,
      opponent_id: bob.id,
      player_id: alice.id,
      total_score: 120,
    }),
    admin.from('head_to_head_stats').insert({
      blowout_wins: 1,
      games_played: 2,
      highest_score: 200,
      losses: 1,
      opponent_id: alice.id,
      player_id: bob.id,
      sucker_punches_landed: 1,
      sucker_punches_used: 2,
      sucker_tokens_leftover: 16,
      sucker_tokens_spent: 4,
      total_score: 300,
      upper_bonus_games: 1,
      wins: 1,
    }),
    admin.from('head_to_head_stats').insert({
      blowout_wins: 2,
      games_played: 3,
      highest_score: 300,
      losses: 1,
      opponent_id: charlie.id,
      player_id: bob.id,
      sucker_punches_landed: 2,
      sucker_punches_used: 3,
      sucker_tokens_leftover: 24,
      sucker_tokens_spent: 11,
      total_score: 750,
      upper_bonus_games: 2,
      wins: 2,
    }),
  ]);
  inserted.forEach((result) => assertNoError(result.error));

  const [bobOverall] = await selectMany<ProfileStatsRow>(
    alice.client.rpc('get_profile_stat_rates', { target_profile_id: bob.id }),
  );
  assertEquals(bobOverall.games_played, 5);
  assertEquals(bobOverall.wins, 3);
  assertEquals(bobOverall.losses, 2);
  assertEquals(bobOverall.highest_score, 300);
  assertEquals(bobOverall.average_score, 210);
  assertEquals(bobOverall.blowout_wins, 3);
  assertEquals(bobOverall.upper_bonus_pct, 60);
  assertEquals(bobOverall.sucker_punch_landed_pct, 60);
  assertEquals(bobOverall.average_sucker_tokens_spent, 3);
  assertEquals(bobOverall.average_sucker_tokens_leftover, 8);

  const [aliceOverall] = await selectMany<ProfileStatsRow>(
    alice.client.rpc('get_profile_stat_rates', { target_profile_id: alice.id }),
  );
  assertEquals(aliceOverall.games_played, 1);
  assertEquals(aliceOverall.average_score, 120);

  const charlieStats = await alice.client.rpc('get_profile_stat_rates', { target_profile_id: charlie.id });
  assertNoError(charlieStats.error);
  assertEquals(charlieStats.data?.length, 0);
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

  const invalidInviteRequestId = crypto.randomUUID();
  const invalidInviteAction = {
    inviteCode: 'MISSING',
    requestId: invalidInviteRequestId,
    type: 'accept_invite',
  };
  const invalidInvite = await invokeGameAction(bob, invalidInviteAction, 400);
  const replayedInvalidInvite = await invokeGameAction(bob, invalidInviteAction, 400);
  assertEquals(replayedInvalidInvite.error, invalidInvite.error);

  const terminalRequest = await selectSingle<{ http_status: number; status: string }>(
    admin.from('game_action_requests').select('http_status, status').eq('request_id', invalidInviteRequestId).single(),
  );
  assertEquals(terminalRequest, { http_status: 400, status: 'completed' });
});

Deno.test('atomic move commits reject stale writes and roll back failed child records', async () => {
  const [alice, bob] = await createUsers('atomic-moves', ['Alice', 'Bob']);
  const original = (await invokeGameAction(alice, { type: 'create_game', opponentProfileId: bob.id })).game as GameRow;
  const claim = async () => {
    const requestId = crypto.randomUUID();
    const inserted = await admin.from('game_action_requests').insert({
      actor_id: alice.id,
      request_id: requestId,
      action_type: 'roll',
      game_id: original.id,
      status: 'processing',
    });
    assertNoError(inserted.error);
    return requestId;
  };
  const requestId = await claim();
  const nextState = { ...original.state, rollNumber: 1, phase: 'scoring' as const };
  const args = {
    p_actor_id: alice.id,
    p_request_id: requestId,
    p_game_id: original.id,
    p_expected_updated_at: original.updated_at,
    p_game_patch: { state: nextState },
    p_writes: [
      {
        table: 'turn_actions',
        operation: 'insert',
        data: {
          actor_id: alice.id,
          game_id: original.id,
          action_type: 'roll',
          payload: {},
        },
      },
    ],
    p_result: { game: original },
  } as unknown as Database['public']['Functions']['commit_game_move']['Args'];
  const denied = await alice.client.rpc('commit_game_move', args);
  if (!denied.error) throw new Error('Authenticated clients must not commit prepared moves directly.');
  const invalid = await admin.rpc('commit_game_move', {
    ...args,
    p_writes: [
      ...(args.p_writes as Array<Record<string, unknown>>),
      {
        table: 'token_events',
        operation: 'insert',
        data: { game_id: original.id, player_id: alice.id, event_type: 'invalid-test-event', token_delta: -3 },
      },
    ] as never,
  });
  if (!invalid.error) throw new Error('Invalid child record must fail the transaction.');
  const afterFailure = await admin.from('games').select('*').eq('id', original.id).single();
  assertEquals(afterFailure.data?.state, original.state);
  assertEquals((await loadActions(original.id)).filter((action) => action.action_type === 'roll').length, 0);
  const request = await admin
    .from('game_action_requests')
    .select('status')
    .eq('actor_id', alice.id)
    .eq('request_id', requestId)
    .single();
  assertEquals(request.data?.status, 'processing');
  const otherId = await claim();
  const commits = await Promise.all([
    admin.rpc('commit_game_move', args),
    admin.rpc('commit_game_move', { ...args, p_request_id: otherId }),
  ]);
  assertEquals(commits.filter((result) => !result.error).length, 1);
  assertEquals(commits.find((result) => result.error)?.error?.code, 'PT409');
  assertEquals((await loadActions(original.id)).filter((action) => action.action_type === 'roll').length, 1);
  const winnerId = commits[0].error ? otherId : requestId;
  const replay = await admin.rpc('commit_game_move', { ...args, p_request_id: winnerId });
  assertNoError(replay.error);
  assertEquals(replay.data, commits.find((result) => !result.error)?.data);
  assertEquals((await loadActions(original.id)).filter((action) => action.action_type === 'roll').length, 1);
});

Deno.test('completed games for one matchup retain every result under concurrent commits and replay', async () => {
  const [alice, bob] = await createUsers('concurrent-matchup-stats', ['Alice', 'Bob']);
  const plans: Database['public']['Functions']['commit_game_move']['Args'][] = [];
  for (let index = 0; index < 2; index += 1) {
    const game = (await invokeGameAction(alice, { type: 'create_game', opponentProfileId: bob.id })).game as GameRow;
    const requestId = crypto.randomUUID();
    assertNoError(
      (
        await admin.from('game_action_requests').insert({
          actor_id: alice.id,
          request_id: requestId,
          game_id: game.id,
          action_type: 'score_category',
          status: 'processing',
        })
      ).error,
    );
    const resultWrites = [alice, bob].map((player, seat) => ({
      table: 'game_player_results',
      operation: 'upsert',
      data: {
        game_id: game.id,
        player_id: player.id,
        opponent_id: seat === 0 ? bob.id : alice.id,
        final_score: seat === 0 ? 30 + index * 40 : 20 + index * 60,
        won: seat === index,
        upper_bonus_awarded: index === 1,
        sucker_tokens_spent: 3 + index * 2,
        sucker_tokens_leftover: 7 - index * 2,
        sucker_count: index,
        sucker_punches_landed: index,
        sucker_punches_used: 1,
      },
    }));
    plans.push({
      p_actor_id: alice.id,
      p_request_id: requestId,
      p_game_id: game.id,
      p_expected_updated_at: game.updated_at,
      p_game_patch: { status: 'complete' },
      p_writes: [
        ...resultWrites,
        // An older Edge worker may have prepared this value before another
        // completion. The database must derive totals rather than accept it.
        {
          table: 'head_to_head_stats',
          operation: 'upsert',
          data: {
            player_id: alice.id,
            opponent_id: bob.id,
            games_played: 1,
            total_score: 30 + index * 40,
            wins: index === 0 ? 1 : 0,
          },
        },
      ],
      p_result: { game },
    } as unknown as Database['public']['Functions']['commit_game_move']['Args']);
  }
  const commits = await Promise.all(plans.map((plan) => admin.rpc('commit_game_move', plan)));
  for (const commit of commits) assertNoError(commit.error);
  const stats = await selectSingle<HeadToHeadStatsRow>(
    admin.from('head_to_head_stats').select('*').eq('player_id', alice.id).eq('opponent_id', bob.id).single(),
  );
  assertEquals(stats.games_played, 2);
  assertEquals(stats.wins, 1);
  assertEquals(stats.losses, 1);
  assertEquals(stats.total_score, 100);
  assertEquals(stats.highest_score, 70);
  assertEquals(stats.average_score, 50);
  assertEquals(stats.upper_bonus_games, 1);
  assertEquals(stats.sucker_games, 1);
  assertEquals(stats.sucker_punches_landed, 1);
  assertEquals(stats.sucker_punches_used, 2);
  assertEquals(stats.sucker_tokens_spent, 8);
  assertEquals(stats.average_sucker_tokens_spent, 4);
  assertEquals(stats.sucker_tokens_leftover, 12);
  assertEquals(stats.average_sucker_tokens_leftover, 6);
  const opponentStats = await selectSingle<HeadToHeadStatsRow>(
    admin.from('head_to_head_stats').select('*').eq('player_id', bob.id).eq('opponent_id', alice.id).single(),
  );
  assertEquals(opponentStats.games_played, 2);
  assertEquals(opponentStats.total_score, 100);
  assertEquals(opponentStats.wins, 1);
  assertEquals(opponentStats.losses, 1);
  const replay = await admin.rpc('commit_game_move', plans[0]);
  assertNoError(replay.error);
  assertEquals(replay.data, commits[0].data);
  const replayStats = await selectSingle<HeadToHeadStatsRow>(
    admin.from('head_to_head_stats').select('*').eq('player_id', alice.id).eq('opponent_id', bob.id).single(),
  );
  assertEquals(replayStats, stats);

  // An invocation of the old SQL function can be waiting during migration and
  // resume with a stale absolute update after the migration commits.
  const legacyWrite = await admin
    .from('head_to_head_stats')
    .update({ games_played: 1, total_score: 30 })
    .eq('player_id', alice.id)
    .eq('opponent_id', bob.id);
  assertEquals(legacyWrite.error?.code, 'PT409');
  const afterLegacyWrite = await selectSingle<HeadToHeadStatsRow>(
    admin.from('head_to_head_stats').select('*').eq('player_id', alice.id).eq('opponent_id', bob.id).single(),
  );
  assertEquals(afterLegacyWrite, stats);
});

Deno.test('taunts are available only after the sender finishes the latest turn', async () => {
  const [alice, bob] = await createUsers('post-turn-taunts', ['Alice', 'Bob']);
  const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;

  const beforeTurn = await invokeGameAction(alice, { gameId: game.id, tauntId: 'sucker', type: 'taunt' }, 400);
  assertEquals(beforeTurn.error, 'Finish your turn before sending a taunt.');

  await invokeGameAction(alice, { gameId: game.id, held: falseHeld, type: 'roll' });
  await invokeGameAction(alice, { category: 'ones', gameId: game.id, held: falseHeld, type: 'score_category' });

  const opponentTaunt = await invokeGameAction(bob, { gameId: game.id, tauntId: 'sucker', type: 'taunt' }, 400);
  assertEquals(opponentTaunt.error, 'You can only taunt after finishing your own turn.');

  const lockedScenarioTaunt = await invokeGameAction(
    alice,
    { gameId: game.id, tauntId: 'sucker-punched', type: 'taunt' },
    400,
  );
  assertEquals(lockedScenarioTaunt.error, 'That taunt is not available for this play.');

  await invokeGameAction(alice, { gameId: game.id, tauntId: 'beat-that', type: 'taunt' });
  const duplicate = await invokeGameAction(alice, { gameId: game.id, tauntId: 'all-that', type: 'taunt' }, 400);
  assertEquals(duplicate.error, 'Save some trash talk for the next turn.');

  const taunts = (await loadActions(game.id)).filter((action) => action.action_type === 'taunt');
  assertEquals(taunts.length, 1);
  assertEquals(taunts[0]?.actor_id, alice.id);
});

Deno.test('post-turn taunts expire when the recipient starts rolling', async () => {
  const [alice, bob] = await createUsers('expired-post-turn-taunts', ['Alice', 'Bob']);
  const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;

  await scratchAndPass(game.id, alice, bob, 'ones');
  await invokeGameAction(bob, { gameId: game.id, held: falseHeld, type: 'roll' });

  const lateTaunt = await invokeGameAction(alice, { gameId: game.id, tauntId: 'beat-that', type: 'taunt' }, 400);
  assertEquals(lateTaunt.error, 'You can only taunt after finishing your own turn.');
});

Deno.test('a missed-punch taunt remains available when the puncher is the active player', async () => {
  const [alice, bob] = await createUsers('missed-punch-taunts', ['Alice', 'Bob']);
  const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;
  const afterTurn = await scratchAndPass(game.id, alice, bob, 'ones');
  assertString(afterTurn.last_turn_id);

  const { error } = await admin.from('turn_actions').insert({
    action_type: 'sucker_punch',
    actor_id: bob.id,
    game_id: game.id,
    payload: { landed: false, targetTurnId: afterTurn.last_turn_id },
    turn_id: afterTurn.last_turn_id,
  });
  assertNoError(error);

  await invokeGameAction(bob, { gameId: game.id, tauntId: 'disrespect-didnt', type: 'taunt' });
  const taunts = (await loadActions(game.id)).filter((action) => action.action_type === 'taunt');
  assertEquals(taunts.length, 1);
  assertEquals(taunts[0]?.actor_id, bob.id);
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
  const removeInviteRequestId = crypto.randomUUID();
  const removeInviteAction = { gameId: inviteGameId, requestId: removeInviteRequestId, type: 'remove_game' };
  const removedInvite = await invokeGameAction(alice, removeInviteAction);
  assertEquals(removedInvite.removedGameId, inviteGameId);
  const replayedRemoval = await invokeGameAction(alice, removeInviteAction);
  assertEquals(replayedRemoval.removedGameId, inviteGameId);

  const retainedRemovalRequest = await selectSingle<{ game_id: string; status: string }>(
    admin.from('game_action_requests').select('game_id, status').eq('request_id', removeInviteRequestId).single(),
  );
  assertEquals(retainedRemovalRequest, { game_id: inviteGameId, status: 'completed' });

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

Deno.test('legacy direct Punch cannot charge tokens using an unseen server chance', async () => {
  const [alice, bob] = await createUsers('legacy-punch', ['Alice', 'Bob']);
  const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;
  await invokeGameAction(alice, { gameId: game.id, type: 'roll' });
  const scored = (await invokeGameAction(alice, { gameId: game.id, type: 'score_category', category: 'sucker' }))
    .game as GameRow;
  const rejected = await invokeGameAction(
    bob,
    { gameId: game.id, turnId: scored.last_turn_id, type: 'sucker_punch', chanceDie: 1 },
    400,
  );
  assertEquals(rejected.error, 'Update Sucker and roll the Sucker Punch chance before throwing.');
  const stored = await admin.from('games').select('*').eq('id', game.id).single();
  assertNoError(stored.error);
  assertEquals(stored.data?.status, 'response_window');
  assertPlayerTokens(stored.data as GameRow, bob.id, startingSuckerTokens);
  assertEquals((await loadTokenEvents(game.id)).length, 0);
});
Deno.test('Sucker Punch displays one authoritative chance across preparation, retries, and throwing', async () => {
  const [alice, bob, outsider] = await createUsers('punch-prepare', ['Alice', 'Bob', 'Outsider']);
  const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;
  await invokeGameAction(alice, { gameId: game.id, held: falseHeld, type: 'roll' });
  const scored = (
    await invokeGameAction(alice, {
      gameId: game.id,
      held: falseHeld,
      category: 'sucker',
      type: 'score_category',
    })
  ).game as GameRow;
  const prepare = { gameId: game.id, turnId: scored.last_turn_id, type: 'prepare_sucker_punch' };
  await invokeGameAction(alice, prepare, 400);
  await invokeGameAction(outsider, prepare, 400);
  const requestId = crypto.randomUUID();
  const first = await invokeGameAction(bob, { ...prepare, requestId });
  assertEquals(first.suckerPunchChanceDie, 6);
  assertPlayerTokens(first.game as GameRow, bob.id, startingSuckerTokens);
  const repeat = await invokeGameAction(bob, { ...prepare, requestId });
  assertEquals(repeat.suckerPunchChanceDie, first.suckerPunchChanceDie);
  const concurrent = await Promise.all([invokeGameAction(bob, prepare), invokeGameAction(bob, prepare)]);
  for (const result of concurrent) assertEquals(result.suckerPunchChanceDie, first.suckerPunchChanceDie);
  const attempts = await admin.from('sucker_punch_attempts').select('chance_die').eq('game_id', game.id);
  assertNoError(attempts.error);
  assertEquals(attempts.data, [{ chance_die: 6 }]);
  const direct = await bob.client.from('sucker_punch_attempts').select('chance_die').eq('game_id', game.id);
  if (!direct.error) throw new Error('Authenticated clients must not access chance storage directly.');
  const mismatch = await invokeGameAction(bob, { ...prepare, type: 'sucker_punch', chanceDie: 1 }, 400);
  assertEquals(mismatch.error, 'The Sucker Punch chance changed. Reopen Sucker Punch to see the saved chance.');
  const throwRequest = {
    ...prepare,
    type: 'sucker_punch',
    chanceDie: first.suckerPunchChanceDie,
    requestId: crypto.randomUUID(),
  };
  const thrown = await invokeGameAction(bob, throwRequest);
  assertEquals((thrown.suckerPunchOutcome as { chanceDie: number }).chanceDie, first.suckerPunchChanceDie);
  assertPlayerTokens(thrown.game as GameRow, bob.id, startingSuckerTokens - suckerTokenCosts.suckerPunch);
  const replay = await invokeGameAction(bob, throwRequest);
  for (const key of ['chanceDie', 'chancePercent', 'rollPercent', 'landed']) {
    assertEquals(
      (replay.suckerPunchOutcome as Record<string, unknown>)[key],
      (thrown.suckerPunchOutcome as Record<string, unknown>)[key],
    );
  }
  assertEquals((await loadTokenEvents(game.id)).filter((event) => event.event_type === 'sucker_punch').length, 1);
  await invokeGameAction(bob, prepare, 400);
});

Deno.test('game-action preserves token accounting when mulligan races other turn actions', async () => {
  const [alice, bob] = await createUsers('mixed-mulligan', ['Alice', 'Bob']);
  for (const type of ['roll', 'extra_roll', 'score_category', 'scratch_category']) {
    const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;
    await invokeGameAction(alice, { gameId: game.id, type: 'roll' });
    const results = await Promise.all(
      ['mulligan', type].map(async (actionType) => {
        const response = await fetch(functionUrl, {
          body: JSON.stringify({ gameId: game.id, requestId: crypto.randomUUID(), type: actionType, category: 'ones' }),
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${alice.session.access_token}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
        });
        return { type: actionType, status: response.status, body: await response.json() };
      }),
    );
    const accepted = results.filter((result) => result.status === 200).map((result) => result.type);
    if (accepted.length === 0) throw new Error('Expected at least one racing action to succeed.');
    for (const result of results.filter((result) => result.status !== 200)) {
      if (result.status === 409) {
        assertEquals(result.body.error, 'The game changed on another device. Refresh and try again.');
      } else {
        assertEquals(result.status, 400);
        assertEquals(result.body.error, 'Roll before playing a score.');
      }
    }
    const saved = await selectSingle<GameRow>(admin.from('games').select('*').eq('id', game.id).single());
    const expectedTokens =
      startingSuckerTokens -
      (accepted.includes('mulligan') ? suckerTokenCosts.mulligan : 0) -
      (accepted.includes('extra_roll') ? suckerTokenCosts.extraRoll : 0) +
      (accepted.includes('scratch_category') ? 1 : 0);
    assertPlayerTokens(saved, alice.id, expectedTokens);
    const player = await selectSingle<GamePlayerTokenRow>(
      admin
        .from('game_players')
        .select('player_id, sucker_tokens')
        .eq('game_id', game.id)
        .eq('player_id', alice.id)
        .single(),
    );
    assertEquals(player.sucker_tokens, expectedTokens);
    const actions = await loadActions(game.id);
    for (const actionType of ['mulligan', type]) {
      assertEquals(
        actions.filter((action) => action.action_type === actionType).length,
        (accepted.includes(actionType) ? 1 : 0) + (actionType === 'roll' ? 1 : 0),
      );
    }
    const turns = await selectMany<TurnRow>(admin.from('turns').select('*').eq('game_id', game.id));
    assertEquals(
      turns.length,
      accepted.some((action) => action === 'score_category' || action === 'scratch_category') ? 1 : 0,
    );
    assertEquals((await loadTokenEvents(game.id)).length, accepted.includes('mulligan') ? 1 : 0);
  }
});

Deno.test('game state transaction rejects stale writes and cannot be called by players', async () => {
  const [alice, bob] = await createUsers('game-transaction', ['Alice', 'Bob']);
  const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;
  const args = {
    target_game_id: game.id,
    expected_updated_at: game.updated_at,
    next_game: game as unknown as Database['public']['Functions']['commit_game_mutation']['Args']['next_game'],
    player_updates: [],
  };
  const denied = await alice.client.rpc('commit_game_mutation', args);
  if (!denied.error) throw new Error('Players must not be able to commit arbitrary game states.');
  const attempts = await Promise.all([
    admin.rpc('commit_game_mutation', args),
    admin.rpc('commit_game_mutation', args),
  ]);
  for (const attempt of attempts) assertNoError(attempt.error);
  assertEquals(attempts.filter((attempt) => attempt.data !== null).length, 1);
  const stale = await admin.rpc('commit_game_mutation', {
    ...args,
    submitted_turn: { id: crypto.randomUUID() },
  });
  assertNoError(stale.error);
  assertEquals(stale.data, null);
  assertEquals((await selectMany<TurnRow>(admin.from('turns').select('*').eq('game_id', game.id))).length, 0);
});

Deno.test('game-action charges every accepted concurrent mulligan exactly once', async () => {
  const [alice, bob] = await createUsers('concurrent-mulligan', ['Alice', 'Bob']);
  const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;
  const requests = Array.from({ length: 3 }, () => ({
    gameId: game.id,
    requestId: crypto.randomUUID(),
    type: 'mulligan',
  }));
  const results = await Promise.all(
    requests.map(async (body) => {
      const response = await fetch(functionUrl, {
        body: JSON.stringify(body),
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${alice.session.access_token}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      return { status: response.status, body: await response.json() };
    }),
  );
  const accepted = results.filter((result) => result.status === 200).length;
  if (accepted === 0) throw new Error('Expected at least one concurrent Mulligan to succeed.');
  for (const result of results.filter((result) => result.status !== 200)) {
    assertEquals(result.status, 409);
    assertEquals(result.body.error, 'The game changed on another device. Refresh and try again.');
  }
  const saved = await selectSingle<GameRow>(admin.from('games').select('*').eq('id', game.id).single());
  const expectedTokens = startingSuckerTokens - accepted * suckerTokenCosts.mulligan;
  assertPlayerTokens(saved, alice.id, expectedTokens);
  const player = await selectSingle<GamePlayerTokenRow>(
    admin
      .from('game_players')
      .select('player_id, sucker_tokens')
      .eq('game_id', game.id)
      .eq('player_id', alice.id)
      .single(),
  );
  assertEquals(player.sucker_tokens, expectedTokens);
  assertEquals((await loadActions(game.id)).filter((action) => action.action_type === 'mulligan').length, accepted);
  const events = await loadTokenEvents(game.id);
  assertEquals(events.length, accepted);
  assertEquals(
    events.reduce((total, event) => total + event.token_delta, 0),
    -accepted * suckerTokenCosts.mulligan,
  );

  // Both successes and conflicts must be terminal, replayable outcomes.
  for (const [index, request] of requests.entries()) {
    const replay = await invokeGameAction(alice, request, results[index].status);
    if (results[index].status === 200) {
      const replayedGame = replay.game as GameRow;
      assertEquals(replayedGame.state, results[index].body.game.state);
      assertEquals(replayedGame.updated_at, results[index].body.game.updated_at);
    } else {
      assertEquals(replay.error, results[index].body.error);
    }
  }
  assertEquals((await loadTokenEvents(game.id)).length, accepted);
});

Deno.test('game-action allows repeated active-turn mulligans before and after rolling', async () => {
  const [alice, bob] = await createUsers('active-mulligan', ['Alice', 'Bob']);
  const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;

  const wrongTurn = await invokeGameAction(bob, { gameId: game.id, type: 'mulligan' }, 400);
  assertEquals(wrongTurn.error, 'It is not your turn.');

  for (let usage = 1; usage <= 3; usage += 1) {
    if (usage === 2) {
      await invokeGameAction(alice, { gameId: game.id, held: falseHeld, type: 'roll' });
      await invokeGameAction(alice, {
        gameId: game.id,
        held: [true, false, true, false, true],
        type: 'extra_roll',
      });
    }
    if (usage === 3) {
      for (let roll = 0; roll < 4; roll += 1) {
        await invokeGameAction(alice, { gameId: game.id, held: falseHeld, type: 'roll' });
      }
    }
    const request = { gameId: game.id, requestId: crypto.randomUUID(), type: 'mulligan' };
    const reset = (await invokeGameAction(alice, request)).game as GameRow;
    const retried = (await invokeGameAction(alice, request)).game as GameRow;
    assertEquals(retried.state, reset.state);
    assertEquals(retried.updated_at, reset.updated_at);
    assertEquals(reset.status, 'active');
    assertEquals(reset.current_player_id, alice.id);
    assertEquals(reset.state.rollNumber, 0);
    assertEquals(reset.state.phase, 'rolling');
    assertEquals(reset.state.extraRollsAvailable, 0);
    assertEquals(reset.state.dice, [1, 1, 1, 1, 1]);
    assertEquals(reset.state.held, falseHeld);
    assertEquals(reset.state.players[0].scorecard, game.state.players[0].scorecard);
    assertPlayerTokens(
      reset,
      alice.id,
      startingSuckerTokens - usage * suckerTokenCosts.mulligan - (usage >= 2 ? 1 : 0),
    );
    assertPlayerTokens(reset, bob.id, startingSuckerTokens);
  }

  const tooPoor = await invokeGameAction(alice, { gameId: game.id, type: 'mulligan' }, 400);
  assertEquals(tooPoor.error, 'You need 3 Sucker Tokens to Mulligan.');
  const events = await loadTokenEvents(game.id);
  assertEquals(
    events.map((event) => [event.token_delta, event.target_turn_id]),
    [
      [-3, null],
      [-3, null],
      [-3, null],
    ],
  );
  assertEquals((await loadActions(game.id)).filter((action) => action.action_type === 'mulligan').length, 3);
});

Deno.test(
  'game-action mulligan at turn start preserves the opponent score and closes the response window',
  async () => {
    const [alice, bob] = await createUsers('response-mulligan', ['Alice', 'Bob']);
    const game = (await invokeGameAction(alice, { opponentProfileId: bob.id, type: 'create_game' })).game as GameRow;
    await invokeGameAction(alice, { gameId: game.id, held: falseHeld, type: 'roll' });
    const scored = (await invokeGameAction(alice, { gameId: game.id, category: 'sucker', type: 'score_category' }))
      .game as GameRow;
    assertEquals(scored.status, 'response_window');
    assertString(scored.last_turn_id);

    const reset = (await invokeGameAction(bob, { gameId: game.id, type: 'mulligan' })).game as GameRow;
    assertEquals(reset.status, 'active');
    assertEquals(reset.current_player_id, bob.id);
    assertEquals(reset.state.rollNumber, 0);
    assertEquals(reset.state.players[0], scored.state.players[0]);
    assertPlayerTokens(reset, bob.id, startingSuckerTokens - suckerTokenCosts.mulligan);
    assertEquals((await loadTurn(scored.last_turn_id)).status, 'submitted');
    const tooLate = await invokeGameAction(alice, { gameId: game.id, type: 'mulligan' }, 400);
    assertEquals(tooLate.error, 'It is not your turn.');
  },
);
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

  await invokeGameAction(bob, { gameId: game.id, turnId: secondScore.last_turn_id, type: 'prepare_sucker_punch' });

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

  await invokeGameAction(bob, { gameId: game.id, tauntId: 'sucker-punched', type: 'taunt' });

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
  assertEquals(actionPayloadValue(punchAction?.payload, 'chancePercent'), 75);
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

  await invokeGameAction(bob, { gameId: game.id, turnId: firstScore.last_turn_id, type: 'prepare_sucker_punch' });

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
  const [alice, bob, charlie] = await createUsers('completion', ['Alice', 'Bob', 'Charlie']);
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

  const stats = await selectMany<HeadToHeadStatsRow>(
    admin.from('head_to_head_stats').select('*').in('player_id', [alice.id, bob.id]),
  );
  assertEquals(stats.length, 2);
  assertEquals(
    stats.every((row) => row.games_played === 1),
    true,
  );
  assertEquals(
    stats.every((row) => row.wins === 0 && row.losses === 0),
    true,
  );

  const { data: publicStats, error: publicStatsError } = await charlie.client.rpc('get_profile_stat_rates', {
    target_profile_id: alice.id,
  });
  assertNoError(publicStatsError);
  assertEquals(publicStats?.[0]?.games_played, 1);

  const { data: publicHistory, error: publicHistoryError } = await charlie.client.rpc('get_profile_recent_games', {
    game_limit: 25,
    target_profile_id: alice.id,
  });
  assertNoError(publicHistoryError);
  assertEquals(publicHistory?.length, 1);
  assertEquals(publicHistory?.[0]?.game_id, gameId);
  assertEquals(publicHistory?.[0]?.player_name, 'Alice');
  assertEquals(publicHistory?.[0]?.opponent_name, 'Bob');
  assertEquals(
    publicHistory?.[0]?.player_scorecard,
    latestGame.state.players.find((player) => player.id === alice.id)?.scorecard,
  );
  assertEquals(
    publicHistory?.[0]?.opponent_scorecard,
    latestGame.state.players.find((player) => player.id === bob.id)?.scorecard,
  );

  const removedCompletedGame = await invokeGameAction(alice, { gameId, type: 'remove_game' });
  assertEquals(removedCompletedGame.removedGameId, gameId);

  const { data: hiddenHistory, error: hiddenHistoryError } = await charlie.client.rpc('get_profile_recent_games', {
    game_limit: 25,
    target_profile_id: alice.id,
  });
  assertNoError(hiddenHistoryError);
  assertEquals(hiddenHistory?.length, 0);

  const { data: opponentHistory, error: opponentHistoryError } = await charlie.client.rpc('get_profile_recent_games', {
    game_limit: 25,
    target_profile_id: bob.id,
  });
  assertNoError(opponentHistoryError);
  assertEquals(opponentHistory?.length, 1);
  assertEquals(opponentHistory?.[0]?.game_id, gameId);

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
  const canonical = (value: unknown) =>
    JSON.stringify(value, (_key, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
        : item,
    );
  if (canonical(actual) !== canonical(expected)) {
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
