-- A finished game stays in a player's game list until they have seen the
-- result. A reply to a rage quit clears the quitter's mark so it resurfaces.
alter table public.game_players
add column if not exists result_seen_at timestamptz;

-- Games that finished before this release count as seen.
update public.game_players player
set result_seen_at = coalesce(game.completed_at, game.updated_at)
from public.games game
where game.id = player.game_id
  and game.status = 'complete'
  and player.result_seen_at is null;

create or replace function public.mark_game_result_seen(target_game_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.game_players player
  set result_seen_at = now()
  from public.games game
  where player.game_id = target_game_id
    and player.player_id = (select auth.uid())
    and game.id = player.game_id
    and game.status = 'complete';
$$;

revoke all on function public.mark_game_result_seen(uuid) from public, anon;
grant execute on function public.mark_game_result_seen(uuid) to authenticated;
