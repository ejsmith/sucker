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

-- Older app versions never mark results seen, so only recent ones resurface.
-- Anything older shows under Completed Games as it always did.
create or replace function public.get_unseen_game_results()
returns table (game_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select player.game_id
  from public.game_players player
  join public.games game on game.id = player.game_id
  where player.player_id = (select auth.uid())
    and player.hidden_at is null
    and player.result_seen_at is null
    and game.status = 'complete'
    and game.completed_at > now() - interval '7 days';
$$;

revoke all on function public.get_unseen_game_results() from public, anon;
grant execute on function public.get_unseen_game_results() to authenticated;

-- Marks only the version the player was shown. A newer update, like an insult
-- that landed after the screen loaded, stays unseen.
create or replace function public.mark_game_result_seen(target_game_id uuid, seen_updated_at timestamptz)
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
    and game.status = 'complete'
    and game.updated_at <= seen_updated_at;
$$;

revoke all on function public.mark_game_result_seen(uuid, timestamptz) from public, anon;
grant execute on function public.mark_game_result_seen(uuid, timestamptz) to authenticated;
