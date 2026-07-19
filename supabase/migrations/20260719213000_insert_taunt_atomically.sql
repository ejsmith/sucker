create or replace function public.insert_taunt_if_open(
  target_game_id uuid,
  target_actor_id uuid,
  target_turn_id uuid,
  target_payload jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_game public.games%rowtype;
begin
  select game.*
  into locked_game
  from public.games game
  where game.id = target_game_id
  for update;

  if not found
    or locked_game.status in ('inviting', 'complete')
    or locked_game.last_turn_id is distinct from target_turn_id
    or locked_game.current_player_id is not distinct from target_actor_id
    or coalesce((locked_game.state ->> 'rollNumber')::integer, 0) <> 0
  then
    return false;
  end if;

  insert into public.turn_actions (action_type, actor_id, game_id, payload, turn_id)
  values ('taunt', target_actor_id, target_game_id, target_payload, target_turn_id);

  return true;
end;
$$;

revoke all on function public.insert_taunt_if_open(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.insert_taunt_if_open(uuid, uuid, uuid, jsonb) to service_role;
