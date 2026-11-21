-- Ratings move from Elo to Glicko. See docs/community-leaderboards.md.
-- `rating` and `rating_deviation` are a player's Glicko estimate and its
-- uncertainty. Players see and rank by the cautious end of that range,
-- rating minus twice the deviation: it starts at 900, climbs as games build
-- confidence, and sinks while a player sits out.

alter table public.player_standings
  add column rating_deviation numeric(6, 2) not null default 150,
  add column rated_at timestamptz,
  alter column peak_rating set default 900;

-- Boards rank by a value computed at read time, so this index no longer helps.
drop index public.player_standings_rating_idx;

-- Uncertainty grows while a player sits out (its variance gains 10² a day),
-- back up to the starting 150.
create function public.rating_deviation_at(deviation numeric, rated_at timestamptz, as_of timestamptz)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when rated_at is null then deviation
    else least(150, sqrt(deviation ^ 2 + 100 * greatest(extract(epoch from as_of - rated_at) / 86400, 0)))
  end;
$$;

revoke all on function public.rating_deviation_at(numeric, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.rating_deviation_at(numeric, timestamptz, timestamptz) to service_role;

-- The rating players see and rank by.
create function public.conservative_rating(rating numeric, deviation numeric, rated_at timestamptz, as_of timestamptz)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(rating - 2 * public.rating_deviation_at(deviation, rated_at, as_of), 2);
$$;

revoke all on function public.conservative_rating(numeric, numeric, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.conservative_rating(numeric, numeric, timestamptz, timestamptz) to service_role;

-- Glicko-1, one game at a time. The first 3 games a pair plays in 7 days count
-- fully and later ones a quarter. Once either player has won 19 of the pair's
-- last 20 games, their games stop counting, so throwing games to a second
-- account goes nowhere. Each result records the shown rating before and after.
-- Idempotent: a game whose results already carry ratings is skipped.
create function public.rate_completed_game(target_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  q constant double precision := ln(10) / 400;
  results public.game_player_results[];
  standing_a public.player_standings;
  standing_b public.player_standings;
  completed timestamptz;
  pair_games integer;
  lopsided boolean;
  weight double precision;
  score_a double precision;
  rating_a double precision;
  rating_b double precision;
  deviation_a double precision;
  deviation_b double precision;
  -- How much a result against each player reveals, given their uncertainty.
  reveal_a double precision;
  reveal_b double precision;
  expected_a double precision;
  expected_b double precision;
  variance_a double precision;
  variance_b double precision;
  next_rating_a numeric;
  next_rating_b numeric;
  next_deviation_a numeric;
  next_deviation_b numeric;
  before_a numeric;
  before_b numeric;
  after_a numeric;
  after_b numeric;
begin
  select array_agg(r order by r.player_id) into results
  from public.game_player_results r
  where r.game_id = target_game_id;

  if coalesce(array_length(results, 1), 0) <> 2 or (results[1]).rating_after is not null then
    return;
  end if;

  completed := greatest((results[1]).completed_at, (results[2]).completed_at);

  insert into public.player_standings (player_id)
  values ((results[1]).player_id), ((results[2]).player_id)
  on conflict (player_id) do nothing;

  -- Lock in a global order so concurrent completions sharing a player cannot deadlock.
  perform 1 from public.player_standings standing
  where standing.player_id in ((results[1]).player_id, (results[2]).player_id)
  order by standing.player_id
  for update;

  select * into strict standing_a from public.player_standings where player_id = (results[1]).player_id;
  select * into strict standing_b from public.player_standings where player_id = (results[2]).player_id;

  before_a := public.conservative_rating(standing_a.rating, standing_a.rating_deviation, standing_a.rated_at, completed);
  before_b := public.conservative_rating(standing_b.rating, standing_b.rating_deviation, standing_b.rated_at, completed);

  select count(*) into pair_games
  from public.game_player_results r
  where r.player_id = (results[1]).player_id
    and r.opponent_id = (results[2]).player_id
    and r.completed_at > completed - interval '7 days'
    and r.completed_at <= completed;

  select count(*) = 20 and greatest(count(*) filter (where recent.a_won), count(*) filter (where recent.b_won)) >= 19
  into lopsided
  from (
    select own.won as a_won, other.won as b_won
    from public.game_player_results own
    join public.game_player_results other on other.game_id = own.game_id and other.player_id = own.opponent_id
    where own.player_id = (results[1]).player_id
      and own.opponent_id = (results[2]).player_id
      and own.game_id <> target_game_id
      and own.completed_at <= completed
    order by own.completed_at desc, own.game_id desc
    limit 20
  ) recent;

  if lopsided then
    update public.game_player_results set rating_before = before_a, rating_after = before_a
    where game_id = target_game_id and player_id = (results[1]).player_id;
    update public.game_player_results set rating_before = before_b, rating_after = before_b
    where game_id = target_game_id and player_id = (results[2]).player_id;
    return;
  end if;

  weight := case when pair_games <= 3 then 1 else 0.25 end;
  score_a := case when (results[1]).won then 1 when (results[2]).won then 0 else 0.5 end;
  rating_a := standing_a.rating;
  rating_b := standing_b.rating;
  deviation_a := public.rating_deviation_at(standing_a.rating_deviation, standing_a.rated_at, completed);
  deviation_b := public.rating_deviation_at(standing_b.rating_deviation, standing_b.rated_at, completed);
  reveal_a := 1 / sqrt(1 + 3 * q ^ 2 * deviation_a ^ 2 / pi() ^ 2);
  reveal_b := 1 / sqrt(1 + 3 * q ^ 2 * deviation_b ^ 2 / pi() ^ 2);
  expected_a := 1 / (1 + 10 ^ (-reveal_b * (rating_a - rating_b) / 400));
  expected_b := 1 / (1 + 10 ^ (-reveal_a * (rating_b - rating_a) / 400));
  variance_a := 1 / (1 / deviation_a ^ 2 + weight * q ^ 2 * reveal_b ^ 2 * expected_a * (1 - expected_a));
  variance_b := 1 / (1 / deviation_b ^ 2 + weight * q ^ 2 * reveal_a ^ 2 * expected_b * (1 - expected_b));
  next_rating_a := round((rating_a + q * variance_a * weight * reveal_b * (score_a - expected_a))::numeric, 2);
  next_rating_b := round((rating_b + q * variance_b * weight * reveal_a * ((1 - score_a) - expected_b))::numeric, 2);
  next_deviation_a := round(sqrt(variance_a)::numeric, 2);
  next_deviation_b := round(sqrt(variance_b)::numeric, 2);
  after_a := public.conservative_rating(next_rating_a, next_deviation_a, completed, completed);
  after_b := public.conservative_rating(next_rating_b, next_deviation_b, completed, completed);

  update public.player_standings set
    rating = next_rating_a,
    rating_deviation = next_deviation_a,
    rated_at = completed,
    rated_games = rated_games + 1,
    peak_rating = greatest(peak_rating, after_a),
    updated_at = now()
  where player_id = (results[1]).player_id;

  update public.player_standings set
    rating = next_rating_b,
    rating_deviation = next_deviation_b,
    rated_at = completed,
    rated_games = rated_games + 1,
    peak_rating = greatest(peak_rating, after_b),
    updated_at = now()
  where player_id = (results[2]).player_id;

  update public.game_player_results set rating_before = before_a, rating_after = after_a
  where game_id = target_game_id and player_id = (results[1]).player_id;
  update public.game_player_results set rating_before = before_b, rating_after = after_b
  where game_id = target_game_id and player_id = (results[2]).player_id;
end;
$$;

revoke all on function public.rate_completed_game(uuid) from public, anon, authenticated;
grant execute on function public.rate_completed_game(uuid) to service_role;

-- Glicko rating, then streaks and milestone feats.
-- Idempotent: a game whose results already carry ratings is skipped.
create or replace function public.apply_completed_game_standings(target_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  results public.game_player_results[];
  result public.game_player_results;
  completed timestamptz;
  player_games integer;
  opponent_games integer;
  beaten integer;
  player_lost boolean;
  loss_streak integer;
  losses integer;
  quits integer;
begin
  select array_agg(r order by r.player_id) into results
  from public.game_player_results r
  where r.game_id = target_game_id;

  if coalesce(array_length(results, 1), 0) <> 2 or (results[1]).rating_after is not null then
    return;
  end if;

  completed := greatest((results[1]).completed_at, (results[2]).completed_at);

  -- Creates and locks both standings rows.
  perform public.rate_completed_game(target_game_id);

  update public.player_standings set
    current_win_streak = case when (results[1]).won then current_win_streak + 1 else 0 end,
    current_loss_streak = case when (results[2]).won then current_loss_streak + 1 else 0 end,
    best_win_streak = greatest(best_win_streak, case when (results[1]).won then current_win_streak + 1 else 0 end),
    updated_at = now()
  where player_id = (results[1]).player_id;

  update public.player_standings set
    current_win_streak = case when (results[2]).won then current_win_streak + 1 else 0 end,
    current_loss_streak = case when (results[1]).won then current_loss_streak + 1 else 0 end,
    best_win_streak = greatest(best_win_streak, case when (results[2]).won then current_win_streak + 1 else 0 end),
    updated_at = now()
  where player_id = (results[2]).player_id;

  foreach result in array results loop
    select count(*) into player_games from public.game_player_results r
    where r.player_id = result.player_id and r.completed_at <= completed;
    select count(*) into opponent_games from public.game_player_results r
    where r.player_id = result.opponent_id and r.completed_at <= completed;
    select count(distinct r.opponent_id) into beaten from public.game_player_results r
    where r.player_id = result.player_id and r.won and r.completed_at <= completed;

    if beaten >= 10 then perform public.award_milestone_feat(result.player_id, 'globetrotter_10', target_game_id, completed); end if;
    if beaten >= 25 then perform public.award_milestone_feat(result.player_id, 'globetrotter_25', target_game_id, completed); end if;
    if beaten >= 100 then perform public.award_milestone_feat(result.player_id, 'globetrotter_100', target_game_id, completed); end if;
    if player_games >= 100 then perform public.award_milestone_feat(result.player_id, 'centurion', target_game_id, completed); end if;
    if opponent_games = 1 and player_games >= 6 then
      perform public.award_milestone_feat(result.player_id, 'welcome_wagon', target_game_id, completed);
    end if;
    if (
      select count(*) from public.game_player_results r
      where r.player_id = result.player_id and r.opponent_id = result.opponent_id and r.completed_at <= completed
    ) >= 10 then
      perform public.award_milestone_feat(result.player_id, 'nemesis', target_game_id, completed);
    end if;

    -- Defeats: a loss means the opponent won; ties are neither.
    player_lost := case when result.player_id = (results[1]).player_id then (results[2]).won else (results[1]).won end;
    select standing.current_loss_streak into loss_streak
    from public.player_standings standing where standing.player_id = result.player_id;
    if loss_streak >= 5 then perform public.award_milestone_feat(result.player_id, 'ice_cold', target_game_id, completed); end if;
    if loss_streak >= 10 then perform public.award_milestone_feat(result.player_id, 'deep_freeze', target_game_id, completed); end if;

    if player_lost then
      if (
        select count(*) = 5 and bool_and(recent.lost)
        from (
          select (not r.won and g.winner_id = r.opponent_id) as lost
          from public.game_player_results r
          join public.games g on g.id = r.game_id
          where r.player_id = result.player_id and r.opponent_id = result.opponent_id and r.completed_at <= completed
          order by r.completed_at desc, r.game_id desc
          limit 5
        ) recent
      ) then
        perform public.award_milestone_feat(result.player_id, 'pigeon', target_game_id, completed);
      end if;
      if opponent_games = 1 and player_games >= 6 then
        perform public.award_milestone_feat(result.player_id, 'welcome_mat', target_game_id, completed);
      end if;
      select count(*) into losses
      from public.game_player_results r
      join public.games g on g.id = r.game_id
      where r.player_id = result.player_id and not r.won and g.winner_id = r.opponent_id and r.completed_at <= completed;
      if losses >= 100 then
        perform public.award_milestone_feat(result.player_id, 'glutton_for_punishment', target_game_id, completed);
      end if;
    end if;

    select count(*) into quits
    from public.rage_quits quit
    join public.game_player_results r on r.game_id = quit.game_id and r.player_id = quit.player_id
    where quit.player_id = result.player_id and r.completed_at <= completed;
    if quits >= 5 then perform public.award_milestone_feat(result.player_id, 'table_flipper', target_game_id, completed); end if;
  end loop;
end;
$$;

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
  -- Forfeits count toward ratings and streaks only, never scores or punch rates.
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
    profile.show_on_leaderboards,
    public.conservative_rating(standing.rating, standing.rating_deviation, standing.rated_at, now()),
    coalesce(standing.rated_games, 0),
    standing.peak_rating,
    -- The rating board's own rank, so a card never disagrees with the board.
    (select ranked.rank from public.ranked_leaderboard('rating') ranked where ranked.player_id = profile.id),
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

-- Rerate every completed game from a fresh start, oldest first. Streaks and
-- feats are unchanged.
update public.player_standings set
  rating = 1200,
  rating_deviation = 150,
  rated_at = null,
  rated_games = 0,
  peak_rating = 900;

update public.game_player_results set rating_before = null, rating_after = null;

do $$
declare
  completed_game record;
begin
  for completed_game in
    select r.game_id
    from public.game_player_results r
    group by r.game_id
    having count(*) = 2
    order by max(r.completed_at), r.game_id
  loop
    perform public.rate_completed_game(completed_game.game_id);
  end loop;
end;
$$;
