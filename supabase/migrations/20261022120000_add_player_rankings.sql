-- Player profiles show every board a player is ranked on. get_leaderboard and
-- get_player_rankings share one ranking so a profile never disagrees with a board.

create function public.ranked_leaderboard(board text)
returns table (
  rank integer,
  player_id uuid,
  display_name text,
  username text,
  avatar_url text,
  value numeric,
  sample_size integer
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
declare
  week_start timestamptz := date_trunc('week', now() at time zone 'utc') at time zone 'utc';
begin
  if board not in ('rating', 'weekly_high_score', 'all_time_high_score', 'sharpshooter', 'win_streak') then
    raise exception 'Unknown leaderboard.' using errcode = '22023';
  end if;

  return query
  -- Forfeits count toward ratings and streaks only, never scores or punch rates.
  with entries as (
    select standing.player_id, standing.rating as value, standing.rated_games as sample_size
    from public.player_standings standing
    where board = 'rating' and standing.rated_games >= 5
    union all
    select r.player_id, max(r.final_score)::numeric, count(*)::integer
    from public.game_player_results r
    where board = 'weekly_high_score' and r.completed_at >= week_start
      and not exists (select 1 from public.rage_quits quit where quit.game_id = r.game_id)
    group by r.player_id
    union all
    select r.player_id, max(r.final_score)::numeric, count(*)::integer
    from public.game_player_results r
    where board = 'all_time_high_score'
      and not exists (select 1 from public.rage_quits quit where quit.game_id = r.game_id)
    group by r.player_id
    union all
    select r.player_id,
      round(100.0 * sum(r.sucker_punches_landed) / sum(r.sucker_punches_used), 1),
      sum(r.sucker_punches_used)::integer
    from public.game_player_results r
    where board = 'sharpshooter'
      and not exists (select 1 from public.rage_quits quit where quit.game_id = r.game_id)
    group by r.player_id
    having sum(r.sucker_punches_used) >= 10
    union all
    select standing.player_id, standing.best_win_streak::numeric, standing.rated_games
    from public.player_standings standing
    where board = 'win_streak' and standing.best_win_streak >= 3
  )
  select
    (rank() over (order by entry.value desc))::integer,
    entry.player_id,
    profile.display_name,
    profile.username,
    profile.avatar_url,
    entry.value,
    entry.sample_size
  from entries entry
  join public.profiles profile on profile.id = entry.player_id
  where profile.show_on_leaderboards;
end;
$$;

revoke all on function public.ranked_leaderboard(text) from public, anon, authenticated;
grant execute on function public.ranked_leaderboard(text) to service_role;

create or replace function public.get_leaderboard(board text, max_rows integer default 25)
returns table (
  rank integer,
  player_id uuid,
  display_name text,
  username text,
  avatar_url text,
  value numeric,
  sample_size integer,
  is_me boolean
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
declare
  viewer uuid := auth.uid();
  row_limit integer := least(greatest(coalesce(max_rows, 25), 1), 100);
begin
  if viewer is null then
    raise exception 'You must be signed in to view leaderboards.' using errcode = '42501';
  end if;

  return query
  with positioned as (
    select ranked.*, row_number() over (order by ranked.rank, ranked.display_name, ranked.player_id) as position
    from public.ranked_leaderboard(board) ranked
  )
  select
    positioned.rank,
    positioned.player_id,
    positioned.display_name,
    positioned.username,
    positioned.avatar_url,
    positioned.value,
    positioned.sample_size,
    positioned.player_id = viewer
  from positioned
  where positioned.position <= row_limit or positioned.player_id = viewer
  order by positioned.position;
end;
$$;

revoke all on function public.get_leaderboard(text, integer) from public;
grant execute on function public.get_leaderboard(text, integer) to authenticated;

-- Hidden players appear on no board, so they have no rankings.
create function public.get_player_rankings(target_profile_id uuid)
returns table (
  board text,
  rank integer,
  value numeric,
  sample_size integer,
  ranked_players integer
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to view rankings.' using errcode = '42501';
  end if;

  return query
  select boards.board, ranked.rank, ranked.value, ranked.sample_size, ranked.ranked_players
  from unnest(array['rating', 'weekly_high_score', 'all_time_high_score', 'sharpshooter', 'win_streak'])
    with ordinality as boards(board, sort_order)
  cross join lateral (
    select entry.rank, entry.value, entry.sample_size, (count(*) over ())::integer as ranked_players, entry.player_id
    from public.ranked_leaderboard(boards.board) entry
  ) ranked
  where ranked.player_id = target_profile_id
  order by boards.sort_order;
end;
$$;

revoke all on function public.get_player_rankings(uuid) from public;
grant execute on function public.get_player_rankings(uuid) to authenticated;
