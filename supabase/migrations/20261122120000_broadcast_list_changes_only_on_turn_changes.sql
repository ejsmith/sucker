-- Every roll, hold and extra roll updates the games row, and each update sent
-- games_changed to both players. Each one made both lobbies reload the whole
-- game list. The list only shows whose turn it is, scores and results, so tell
-- players about an update only when one of those can have changed. The game
-- topic still gets every update for the open game screen.

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
  -- Scores change only with a new or removed turn, which moves last_turn_id,
  -- status or the current player. Finished games always notify, so a Rage
  -- Quit reply shows up as unseen.
  if tg_op = 'UPDATE'
    and old.status <> 'complete'
    and new.status <> 'complete'
    and (old.status, old.current_player_id, old.last_turn_id, old.winner_id)
      is not distinct from (new.status, new.current_player_id, new.last_turn_id, new.winner_id)
  then
    return null;
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

revoke all on function public.broadcast_game_change() from public, anon, authenticated;
