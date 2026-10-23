-- Hall of Shame boards, and every player on every board.
-- See docs/community-leaderboards.md.

-- Sucker is a community: nobody hides from the boards. The column stays so
-- installed apps that still read or write it keep working; nothing reads it.
update public.profiles set show_on_leaderboards = true where not show_on_leaderboards;

comment on column public.profiles.show_on_leaderboards is
  'Retired. Every player appears on every board; kept for installed apps.';

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
  if board not in (
    'rating', 'weekly_high_score', 'all_time_high_score', 'sharpshooter', 'win_streak',
    'saltiest', 'weekly_salt', 'most_punchable', 'whiff_champion', 'biggest_loser'
  ) then
    raise exception 'Unknown leaderboard.' using errcode = '22023';
  end if;

  return query
  -- Forfeits count toward ratings and streaks only, never scores or punch rates.
  -- Shame boards are the exception: quitting must never hide a player from them.
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
    union all
    -- Rage quits, out of every completed game.
    select r.player_id, count(quit.game_id)::numeric, count(*)::integer
    from public.game_player_results r
    left join public.rage_quits quit on quit.game_id = r.game_id and quit.player_id = r.player_id
    where board = 'saltiest'
    group by r.player_id
    having count(quit.game_id) > 0
    union all
    select r.player_id, count(quit.game_id)::numeric, count(*)::integer
    from public.game_player_results r
    left join public.rage_quits quit on quit.game_id = r.game_id and quit.player_id = r.player_id
    where board = 'weekly_salt' and r.completed_at >= week_start
    group by r.player_id
    having count(quit.game_id) > 0
    union all
    -- Landed punches taken. A landed punch forces a reroll.
    select r.player_id, sum(r.forced_rerolls)::numeric, count(*)::integer
    from public.game_player_results r
    where board = 'most_punchable'
    group by r.player_id
    having sum(r.forced_rerolls) > 0
    union all
    select r.player_id, sum(r.sucker_punches_used - r.sucker_punches_landed)::numeric, sum(r.sucker_punches_used)::integer
    from public.game_player_results r
    where board = 'whiff_champion'
    group by r.player_id
    having sum(r.sucker_punches_used - r.sucker_punches_landed) > 0
    union all
    -- Worst losing margin. A rage quit counts at the margin when they quit,
    -- so flipping the table never hides a blowout.
    select r.player_id, max(opponent.final_score - r.final_score)::numeric, count(*)::integer
    from public.game_player_results r
    join public.games game on game.id = r.game_id and game.winner_id = r.opponent_id
    join public.game_player_results opponent on opponent.game_id = r.game_id and opponent.player_id = r.opponent_id
    where board = 'biggest_loser'
    group by r.player_id
    having max(opponent.final_score - r.final_score) > 0
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
  join public.profiles profile on profile.id = entry.player_id;
end;
$$;

create or replace function public.get_player_rankings(target_profile_id uuid)
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
  from unnest(array[
    'rating', 'weekly_high_score', 'all_time_high_score', 'sharpshooter', 'win_streak',
    'saltiest', 'weekly_salt', 'most_punchable', 'whiff_champion', 'biggest_loser'
  ]) with ordinality as boards(board, sort_order)
  cross join lateral (
    select entry.rank, entry.value, entry.sample_size, (count(*) over ())::integer as ranked_players, entry.player_id
    from public.ranked_leaderboard(boards.board) entry
  ) ranked
  where ranked.player_id = target_profile_id
  order by boards.sort_order;
end;
$$;

-- show_on_leaderboards is always true, for installed apps that still read it.
create or replace function public.get_player_card(target_profile_id uuid)
returns table (
  player_id uuid,
  display_name text,
  username text,
  avatar_url text,
  show_on_leaderboards boolean,
  rating numeric,
  rated_games integer,
  peak_rating numeric,
  rating_rank integer,
  current_win_streak integer,
  best_win_streak integer,
  games_played integer,
  wins integer,
  losses integer,
  highest_score integer,
  feats_earned integer
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to view players.' using errcode = '42501';
  end if;

  return query
  select
    profile.id,
    profile.display_name,
    profile.username,
    profile.avatar_url,
    true,
    standing.rating,
    coalesce(standing.rated_games, 0),
    standing.peak_rating,
    case
      when standing.rated_games >= 5 then (
        select count(*)::integer + 1
        from public.player_standings other
        where other.rated_games >= 5 and other.rating > standing.rating
      )
    end,
    coalesce(standing.current_win_streak, 0),
    coalesce(standing.best_win_streak, 0),
    coalesce(totals.games_played, 0),
    coalesce(totals.wins, 0),
    coalesce(totals.losses, 0),
    coalesce(totals.highest_score, 0),
    (select count(distinct feat.feat_key)::integer from public.player_feats feat where feat.player_id = profile.id)
  from public.profiles profile
  left join public.player_standings standing on standing.player_id = profile.id
  left join lateral (
    select
      sum(stats.games_played)::integer as games_played,
      sum(stats.wins)::integer as wins,
      sum(stats.losses)::integer as losses,
      max(stats.highest_score)::integer as highest_score
    from public.head_to_head_stats stats
    where stats.player_id = profile.id
  ) totals on true
  where profile.id = target_profile_id;
end;
$$;
