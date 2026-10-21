-- Defeats, the losing side of feats, plus a 100-point comeback.
-- See docs/community-leaderboards.md.

alter table public.player_standings
  add column current_loss_streak integer not null default 0;

-- A loss means the opponent won; ties are neither a win nor a loss.
create view pg_temp.result_outcomes as
select
  r.game_id,
  r.player_id,
  r.opponent_id,
  r.completed_at,
  (not r.won and g.winner_id = r.opponent_id) as lost
from public.game_player_results r
join public.games g on g.id = r.game_id;

-- Each player's current run of losses, newest first until the first non-loss.
update public.player_standings standing
set current_loss_streak = streak.losses
from (
  select ordered.player_id, count(*)::integer as losses
  from (
    select
      outcome.player_id,
      sum(case when outcome.lost then 0 else 1 end) over (
        partition by outcome.player_id
        order by outcome.completed_at desc, outcome.game_id desc
        rows unbounded preceding
      ) as breaks
    from pg_temp.result_outcomes outcome
  ) ordered
  where ordered.breaks = 0
  group by ordered.player_id
) streak
where streak.player_id = standing.player_id;

create or replace function public.apply_completed_game_standings(target_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  results public.game_player_results[];
  result public.game_player_results;
  standing_a public.player_standings;
  standing_b public.player_standings;
  completed timestamptz;
  pair_games integer;
  damping numeric;
  score_a numeric;
  expected_a numeric;
  next_a numeric;
  next_b numeric;
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

  select count(*) into pair_games
  from public.game_player_results r
  where r.player_id = (results[1]).player_id
    and r.opponent_id = (results[2]).player_id
    and r.completed_at > completed - interval '7 days'
    and r.completed_at <= completed;
  damping := case when pair_games <= 3 then 1 else 0.25 end;

  score_a := case when (results[1]).won then 1 when (results[2]).won then 0 else 0.5 end;
  expected_a := 1 / (1 + power(10::numeric, (standing_b.rating - standing_a.rating) / 400));
  next_a := round(
    standing_a.rating
      + (case when standing_a.rated_games < 10 then 40 else 24 end) * damping * (score_a - expected_a),
    2
  );
  next_b := round(
    standing_b.rating
      + (case when standing_b.rated_games < 10 then 40 else 24 end) * damping * ((1 - score_a) - (1 - expected_a)),
    2
  );

  update public.player_standings set
    rating = next_a,
    rated_games = rated_games + 1,
    peak_rating = greatest(peak_rating, next_a),
    current_win_streak = case when (results[1]).won then current_win_streak + 1 else 0 end,
    current_loss_streak = case when (results[2]).won then current_loss_streak + 1 else 0 end,
    best_win_streak = greatest(best_win_streak, case when (results[1]).won then current_win_streak + 1 else 0 end),
    updated_at = now()
  where player_id = (results[1]).player_id;

  update public.player_standings set
    rating = next_b,
    rated_games = rated_games + 1,
    peak_rating = greatest(peak_rating, next_b),
    current_win_streak = case when (results[2]).won then current_win_streak + 1 else 0 end,
    current_loss_streak = case when (results[1]).won then current_loss_streak + 1 else 0 end,
    best_win_streak = greatest(best_win_streak, case when (results[2]).won then current_win_streak + 1 else 0 end),
    updated_at = now()
  where player_id = (results[2]).player_id;

  update public.game_player_results set rating_before = standing_a.rating, rating_after = next_a
  where game_id = target_game_id and player_id = (results[1]).player_id;
  update public.game_player_results set rating_before = standing_b.rating, rating_after = next_b
  where game_id = target_game_id and player_id = (results[2]).player_id;

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

-- Award milestone defeats already earned, on the game that earned them.
-- Losing streaks, overall and against one opponent, numbered within each run.
with ordered as (
  select
    outcome.*,
    row_number() over (partition by outcome.player_id order by outcome.completed_at, outcome.game_id)
      - row_number() over (
        partition by outcome.player_id, outcome.lost order by outcome.completed_at, outcome.game_id
      ) as overall_run,
    row_number() over (
      partition by outcome.player_id, outcome.opponent_id order by outcome.completed_at, outcome.game_id
    ) - row_number() over (
      partition by outcome.player_id, outcome.opponent_id, outcome.lost order by outcome.completed_at, outcome.game_id
    ) as pair_run
  from pg_temp.result_outcomes outcome
),
streaks as (
  select
    ordered.*,
    row_number() over (
      partition by ordered.player_id, ordered.overall_run order by ordered.completed_at, ordered.game_id
    ) as overall_length,
    row_number() over (
      partition by ordered.player_id, ordered.opponent_id, ordered.pair_run order by ordered.completed_at, ordered.game_id
    ) as pair_length,
    row_number() over (
      partition by ordered.player_id, ordered.lost order by ordered.completed_at, ordered.game_id
    ) as loss_number
  from ordered
),
earned as (
  select streak.player_id, 'ice_cold' as feat_key, streak.game_id, streak.completed_at
  from streaks streak where streak.lost and streak.overall_length = 5
  union all
  select streak.player_id, 'deep_freeze', streak.game_id, streak.completed_at
  from streaks streak where streak.lost and streak.overall_length = 10
  union all
  select streak.player_id, 'pigeon', streak.game_id, streak.completed_at
  from streaks streak where streak.lost and streak.pair_length = 5
  union all
  select streak.player_id, 'glutton_for_punishment', streak.game_id, streak.completed_at
  from streaks streak where streak.lost and streak.loss_number = 100
  union all
  -- Lost to someone in their first game, with 5 or more games of your own before it.
  select outcome.player_id, 'welcome_mat', outcome.game_id, outcome.completed_at
  from pg_temp.result_outcomes outcome
  where outcome.lost
    and (
      select count(*) from public.game_player_results r
      where r.player_id = outcome.opponent_id and r.completed_at <= outcome.completed_at
    ) = 1
    and (
      select count(*) from public.game_player_results r
      where r.player_id = outcome.player_id and r.completed_at <= outcome.completed_at
    ) >= 6
  union all
  select quits.player_id, 'table_flipper', quits.game_id, quits.completed_at
  from (
    select
      quit.player_id,
      quit.game_id,
      r.completed_at,
      row_number() over (partition by quit.player_id order by r.completed_at, quit.game_id) as quit_number
    from public.rage_quits quit
    join public.game_player_results r on r.game_id = quit.game_id and r.player_id = quit.player_id
  ) quits
  where quits.quit_number = 5
),
first_earned as (
  select distinct on (earned.player_id, earned.feat_key) earned.*
  from earned
  order by earned.player_id, earned.feat_key, earned.completed_at, earned.game_id
)
insert into public.player_feats (game_id, player_id, feat_key, earned_at)
select first_earned.game_id, first_earned.player_id, first_earned.feat_key, first_earned.completed_at
from first_earned
where not exists (
  select 1 from public.player_feats feat
  where feat.player_id = first_earned.player_id and feat.feat_key = first_earned.feat_key
);

-- Comebacks now need a 100-point deficit. Replay each past comeback's turns and
-- clear the ones that never trailed by 100, along with their stats and feats.
with candidates as (
  select r.game_id, r.player_id, r.opponent_id
  from public.game_player_results r
  where r.comeback_win = 1
),
timeline as (
  select
    candidate.game_id,
    candidate.player_id,
    sum(case when turn.player_id = candidate.player_id then turn.score else 0 end) over running as mine,
    sum(case when turn.player_id = candidate.opponent_id then turn.score else 0 end) over running as theirs,
    sum(case when turn.player_id = candidate.player_id and turn.category in ('ones', 'twos', 'threes', 'fours', 'fives', 'sixes')
      then case when turn.score >= 50 then turn.score - 50 else turn.score end else 0 end) over running as mine_upper,
    sum(case when turn.player_id = candidate.opponent_id and turn.category in ('ones', 'twos', 'threes', 'fours', 'fives', 'sixes')
      then case when turn.score >= 50 then turn.score - 50 else turn.score end else 0 end) over running as theirs_upper
  from candidates candidate
  join public.turns turn on turn.game_id = candidate.game_id
  where turn.status in ('submitted', 'blocked', 'finalized')
  window running as (
    partition by candidate.game_id, candidate.player_id
    order by turn.turn_index
    rows between unbounded preceding and current row
  )
),
still_comebacks as (
  select distinct timeline.game_id, timeline.player_id
  from timeline
  where (timeline.theirs + case when timeline.theirs_upper >= 63 then 35 else 0 end)
    - (timeline.mine + case when timeline.mine_upper >= 63 then 35 else 0 end) >= 100
),
cleared as (
  update public.game_player_results r
  set comeback_win = 0
  from candidates candidate
  where r.game_id = candidate.game_id
    and r.player_id = candidate.player_id
    and not exists (
      select 1 from still_comebacks kept
      where kept.game_id = candidate.game_id and kept.player_id = candidate.player_id
    )
  returning r.game_id, r.player_id, r.opponent_id
),
matchup_totals as (
  update public.head_to_head_stats stats
  set comeback_wins = greatest(0, stats.comeback_wins - removed.games)
  from (
    select cleared.player_id, cleared.opponent_id, count(*)::integer as games
    from cleared
    group by cleared.player_id, cleared.opponent_id
  ) removed
  where stats.player_id = removed.player_id and stats.opponent_id = removed.opponent_id
  returning stats.player_id
)
delete from public.player_feats feat
using cleared
where feat.game_id = cleared.game_id
  and feat.player_id = cleared.player_id
  and feat.feat_key = 'comeback_kid';
