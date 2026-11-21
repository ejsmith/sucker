-- Game read policies called is_game_participant once per row. It is SECURITY
-- DEFINER, so Postgres cannot inline it, and every lobby read scanned every
-- game (and every listed game's actions) calling it row by row. Reads got
-- slower as the whole game table grew, not just the player's own games. A set
-- of the player's visible game ids is computed once per query instead.
-- It takes no argument, so a player can only ever list their own games.
create or replace function public.my_visible_game_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
rows 50
as $$
  select game_id
  from public.game_players
  where player_id = (select auth.uid())
    and hidden_at is null;
$$;

revoke all on function public.my_visible_game_ids() from public, anon;
grant execute on function public.my_visible_game_ids() to authenticated, service_role;

drop policy "Participants can read games" on public.games;
create policy "Participants can read games"
on public.games for select
to authenticated
using (id in (select public.my_visible_game_ids()));

drop policy "Participants can read game players" on public.game_players;
create policy "Participants can read game players"
on public.game_players for select
to authenticated
using (game_id in (select public.my_visible_game_ids()));

drop policy "Participants can read turns" on public.turns;
create policy "Participants can read turns"
on public.turns for select
to authenticated
using (game_id in (select public.my_visible_game_ids()));

drop policy "Participants can read turn actions" on public.turn_actions;
create policy "Participants can read turn actions"
on public.turn_actions for select
to authenticated
using (game_id in (select public.my_visible_game_ids()));

drop policy "Participants can read token events" on public.token_events;
create policy "Participants can read token events"
on public.token_events for select
to authenticated
using (game_id in (select public.my_visible_game_ids()));

-- game-action claimed a request with an insert, then counted the player's
-- recent requests for rate limiting, or read the existing request on a retry:
-- two sequential round trips before every move. This does both in one.
create or replace function public.claim_game_action_request(
  p_actor_id uuid,
  p_request_id uuid,
  p_action_type text,
  p_game_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.game_action_requests;
  recent_count integer;
begin
  insert into public.game_action_requests (actor_id, request_id, action_type, game_id)
  values (p_actor_id, p_request_id, p_action_type, p_game_id)
  on conflict (actor_id, request_id) do nothing;

  if found then
    select count(*) into recent_count
    from public.game_action_requests
    where actor_id = p_actor_id
      and created_at >= now() - interval '60 seconds';
    return jsonb_build_object('claimed', true, 'recent_count', recent_count);
  end if;

  select * into strict existing
  from public.game_action_requests
  where actor_id = p_actor_id and request_id = p_request_id;
  return jsonb_build_object('claimed', false, 'request', to_jsonb(existing));
end;
$$;

revoke all on function public.claim_game_action_request(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_game_action_request(uuid, uuid, text, uuid) to service_role;
