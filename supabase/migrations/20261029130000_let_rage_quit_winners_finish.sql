-- After a Rage Quit, the player who stayed may finish their own card, and a
-- card already full at the quit counts at once. A full card posts its final
-- score to the high score boards; the result, rating, and streaks stay as they
-- were at the quit. See the Rage Quit section
-- of docs/game-design-spec-v2.md.
alter table public.game_player_results add column played_out_at timestamptz;

-- The rating board ranks by the shown rating, as of now.
create or replace function public.ranked_leaderboard(board text)
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
  -- Forfeits count toward ratings and streaks only, never punch rates. Their
  -- scores count only when the winner finished their card after the quit.
  with entries as (
    select
      standing.player_id,
      public.conservative_rating(standing.rating, standing.rating_deviation, standing.rated_at, now()) as value,
      standing.rated_games as sample_size
    from public.player_standings standing
    where board = 'rating' and standing.rated_games >= 5
    union all
    select r.player_id, max(r.final_score)::numeric, count(*)::integer
    from public.game_player_results r
    where board = 'weekly_high_score' and coalesce(r.played_out_at, r.completed_at) >= week_start
      and (r.played_out_at is not null or not exists (select 1 from public.rage_quits quit where quit.game_id = r.game_id))
    group by r.player_id
    union all
    select r.player_id, max(r.final_score)::numeric, count(*)::integer
    from public.game_player_results r
    where board = 'all_time_high_score'
      and (r.played_out_at is not null or not exists (select 1 from public.rage_quits quit where quit.game_id = r.game_id))
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
