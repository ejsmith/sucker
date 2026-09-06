-- Every active-turn action uses the same version check and transaction.
-- Scratching is already legal before rolling, including after a Mulligan.
alter table public.turns drop constraint turns_roll_count_check;
alter table public.turns add constraint turns_roll_count_check check (roll_count >= 0);

create or replace function public.commit_game_mutation(
  target_game_id uuid,
  expected_updated_at timestamptz,
  next_game jsonb,
  player_updates jsonb,
  submitted_turn jsonb default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  current_game public.games;
begin
  select * into current_game from public.games where id = target_game_id for update;
  if not found or current_game.updated_at is distinct from expected_updated_at then
    return null;
  end if;

  if submitted_turn is not null then
    insert into public.turns (id, game_id, player_id, turn_index, category, dice, held, roll_count, score, status)
    values (
      (submitted_turn->>'id')::uuid, target_game_id, (submitted_turn->>'player_id')::uuid,
      (submitted_turn->>'turn_index')::integer, submitted_turn->>'category',
      array(select jsonb_array_elements_text(submitted_turn->'dice')::integer),
      array(select jsonb_array_elements_text(submitted_turn->'held')::boolean),
      (submitted_turn->>'roll_count')::integer, (submitted_turn->>'score')::integer,
      submitted_turn->>'status'
    );
  end if;

  update public.games set
    state = next_game->'state',
    status = next_game->>'status',
    current_player_id = (next_game->>'current_player_id')::uuid,
    last_turn_id = (next_game->>'last_turn_id')::uuid,
    winner_id = (next_game->>'winner_id')::uuid,
    completed_at = (next_game->>'completed_at')::timestamptz
  where id = target_game_id
  returning * into current_game;

  update public.game_players as player set
    final_score = synced.final_score,
    sucker_tokens = synced.sucker_tokens,
    upper_bonus_awarded = synced.upper_bonus_awarded
  from jsonb_to_recordset(player_updates) as synced(
    player_id uuid, final_score integer, sucker_tokens integer, upper_bonus_awarded boolean
  )
  where player.game_id = target_game_id and player.player_id = synced.player_id;

  return to_jsonb(current_game);
end;
$$;

revoke all on function public.commit_game_mutation(uuid, timestamptz, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_game_mutation(uuid, timestamptz, jsonb, jsonb, jsonb) to service_role;
