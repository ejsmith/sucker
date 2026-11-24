-- Realtime Postgres Changes re-read the WAL and ran each listener's read
-- policy for every write to games and turn_actions. The game list listened to
-- every game, so each move was checked against every signed-in player. It was
-- the largest use of database time and grew with players times moves.
--
-- Writes now broadcast once, inside their transaction, to private topics:
--   player:<profile id>  games_changed {game_id}  one of the player's games changed
--   game:<game id>       game {game}              the game row after a change
--   game:<game id>       action {action}          a turn action was recorded
-- Clients are authorized once when they join a topic. Older binaries still use
-- Postgres Changes, so the publication stays until they are gone.

create or replace function public.broadcast_game_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  game_row public.games;
  participant_id uuid;
begin
  game_row := case when tg_op = 'DELETE' then old else new end;
  if tg_op <> 'DELETE' then
    perform realtime.send(jsonb_build_object('game', to_jsonb(new)), 'game', 'game:' || new.id, true);
  end if;
  -- A deleted game is broadcast before the delete, while its players still exist.
  for participant_id in
    select player_id from public.game_players where game_id = game_row.id and hidden_at is null
  loop
    perform realtime.send(jsonb_build_object('game_id', game_row.id), 'games_changed', 'player:' || participant_id, true);
  end loop;
  return case when tg_op = 'DELETE' then old else null end;
end;
$$;

create trigger games_broadcast_change
after insert or update on public.games
for each row execute function public.broadcast_game_change();

create trigger games_broadcast_delete
before delete on public.games
for each row execute function public.broadcast_game_change();

-- Joining or hiding a game changes that player's list without touching the game.
create or replace function public.broadcast_game_player_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform realtime.send(jsonb_build_object('game_id', new.game_id), 'games_changed', 'player:' || new.player_id, true);
  return null;
end;
$$;

create trigger game_players_broadcast_change
after insert or update of hidden_at on public.game_players
for each row execute function public.broadcast_game_player_change();

create or replace function public.broadcast_turn_action()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform realtime.send(jsonb_build_object('action', to_jsonb(new)), 'action', 'game:' || new.game_id, true);
  return null;
end;
$$;

create trigger turn_actions_broadcast_insert
after insert on public.turn_actions
for each row execute function public.broadcast_turn_action();

revoke all on function public.broadcast_game_change() from public, anon, authenticated;
revoke all on function public.broadcast_game_player_change() from public, anon, authenticated;
revoke all on function public.broadcast_turn_action() from public, anon, authenticated;

-- Players may listen to their own list topic and to the games they can read.
-- Nobody may send on these topics from a client.
create policy "Players receive their game broadcasts"
on realtime.messages for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and (
    (select realtime.topic()) = 'player:' || (select auth.uid())::text
    or (
      (select realtime.topic()) like 'game:%'
      and split_part((select realtime.topic()), ':', 2) in (
        select game_id::text from public.my_visible_game_ids() as game_id
      )
    )
  )
);
