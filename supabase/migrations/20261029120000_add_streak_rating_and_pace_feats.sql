-- More feats from the completion trigger: win streaks (Hot Streak, On Fire),
-- beating one opponent 5 in a row (Got Your Number), a Sucker of every face
-- (Sucker Collector), rating upsets (Giant Killer, Banana Peel), and game pace
-- (Blitz, The Long Game). See docs/community-leaderboards.md.

-- game-action replays a game's actions on most moves to award instant feats.
create index turn_actions_game_created_idx on public.turn_actions (game_id, created_at);

-- Bits 1 to 6 mark the Sucker faces a player has rolled in finished games.
alter table public.player_standings add column sucker_faces integer not null default 0;

-- Glicko rating, then streaks, milestone feats, and per-game feats that need
-- ratings or timing.
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
  win_streak integer;
  losses integer;
  quits integer;
  rage_quit boolean;
  first_roll timestamptz;
  rating_gap numeric;
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

  rage_quit := exists(select 1 from public.rage_quits quit where quit.game_id = target_game_id);
  select min(action.created_at) into first_roll
  from public.turn_actions action
  where action.game_id = target_game_id and action.action_type = 'roll';

  -- Every Sucker face each player has rolled in a finished game, as bits 1 to 6.
  update public.player_standings standing set
    sucker_faces = standing.sucker_faces | faces.rolled
  from (
    select action.actor_id, bit_or(1 << ((action.payload -> 'dice' ->> 0)::integer - 1)) as rolled
    from public.turn_actions action
    where action.game_id = target_game_id
      and action.action_type = 'roll'
      and action.payload -> 'dice' ->> 0 in ('1', '2', '3', '4', '5', '6')
      and action.payload -> 'dice' = jsonb_build_array(
        action.payload -> 'dice' -> 0,
        action.payload -> 'dice' -> 0,
        action.payload -> 'dice' -> 0,
        action.payload -> 'dice' -> 0,
        action.payload -> 'dice' -> 0
      )
    group by action.actor_id
  ) faces
  where standing.player_id = faces.actor_id;

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
    select standing.current_win_streak into win_streak
    from public.player_standings standing where standing.player_id = result.player_id;
    if win_streak >= 5 then perform public.award_milestone_feat(result.player_id, 'hot_streak', target_game_id, completed); end if;
    if win_streak >= 10 then perform public.award_milestone_feat(result.player_id, 'on_fire', target_game_id, completed); end if;
    if (select standing.sucker_faces = 63 from public.player_standings standing where standing.player_id = result.player_id) then
      perform public.award_milestone_feat(result.player_id, 'sucker_collector', target_game_id, completed);
    end if;
    if opponent_games = 1 and player_games >= 6 then
      perform public.award_milestone_feat(result.player_id, 'welcome_wagon', target_game_id, completed);
    end if;
    if (
      select count(*) from public.game_player_results r
      where r.player_id = result.player_id and r.opponent_id = result.opponent_id and r.completed_at <= completed
    ) >= 10 then
      perform public.award_milestone_feat(result.player_id, 'nemesis', target_game_id, completed);
    end if;
    if result.won and (
      select count(*) = 5 and bool_and(recent.won)
      from (
        select r.won
        from public.game_player_results r
        where r.player_id = result.player_id and r.opponent_id = result.opponent_id and r.completed_at <= completed
        order by r.completed_at desc, r.game_id desc
        limit 5
      ) recent
    ) then
      perform public.award_milestone_feat(result.player_id, 'got_your_number', target_game_id, completed);
    end if;

    -- Defeats: a loss means the opponent won; ties are neither.
    player_lost := case when result.player_id = (results[1]).player_id then (results[2]).won else (results[1]).won end;

    -- Per-game feats that need ratings or timing. A Rage Quit awards none.
    -- Rating gaps use the shown ratings before the game, once both players
    -- have 5 earlier games, so new players' settling ratings never count.
    if not rage_quit then
      if player_games >= 6 and opponent_games >= 6 then
        select opponent.rating_before - own.rating_before into rating_gap
        from public.game_player_results own
        join public.game_player_results opponent
          on opponent.game_id = own.game_id and opponent.player_id = own.opponent_id
        where own.game_id = target_game_id and own.player_id = result.player_id;
        if result.won and rating_gap >= 200 then
          insert into public.player_feats (game_id, player_id, feat_key, earned_at)
          values (target_game_id, result.player_id, 'giant_killer', completed)
          on conflict do nothing;
        end if;
        if player_lost and rating_gap <= -200 then
          insert into public.player_feats (game_id, player_id, feat_key, earned_at)
          values (target_game_id, result.player_id, 'banana_peel', completed)
          on conflict do nothing;
        end if;
      end if;
      if completed - first_roll <= interval '1 hour' then
        insert into public.player_feats (game_id, player_id, feat_key, earned_at)
        values (target_game_id, result.player_id, 'blitz', completed)
        on conflict do nothing;
      end if;
      if completed - first_roll >= interval '30 days' then
        insert into public.player_feats (game_id, player_id, feat_key, earned_at)
        values (target_game_id, result.player_id, 'the_long_game', completed)
        on conflict do nothing;
      end if;
    end if;
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

-- Sucker faces already rolled in finished games.
update public.player_standings standing
set sucker_faces = faces.rolled
from (
  select action.actor_id, bit_or(1 << ((action.payload -> 'dice' ->> 0)::integer - 1)) as rolled
  from public.turn_actions action
  join public.game_player_results r on r.game_id = action.game_id and r.player_id = action.actor_id
  where action.action_type = 'roll'
    and action.payload -> 'dice' ->> 0 in ('1', '2', '3', '4', '5', '6')
    and action.payload -> 'dice' = jsonb_build_array(
      action.payload -> 'dice' -> 0,
      action.payload -> 'dice' -> 0,
      action.payload -> 'dice' -> 0,
      action.payload -> 'dice' -> 0,
      action.payload -> 'dice' -> 0
    )
  group by action.actor_id
) faces
where faces.actor_id = standing.player_id;

-- Award the new milestones already earned, on the game that earned them.
-- Win streaks, overall and against one opponent, numbered within each run.
with ordered as (
  select
    r.game_id,
    r.player_id,
    r.opponent_id,
    r.completed_at,
    r.won,
    row_number() over (partition by r.player_id order by r.completed_at, r.game_id)
      - row_number() over (partition by r.player_id, r.won order by r.completed_at, r.game_id) as overall_run,
    row_number() over (partition by r.player_id, r.opponent_id order by r.completed_at, r.game_id)
      - row_number() over (
        partition by r.player_id, r.opponent_id, r.won order by r.completed_at, r.game_id
      ) as pair_run
  from public.game_player_results r
),
streaks as (
  select
    ordered.*,
    -- A run key is only unique together with its outcome, so partition by both.
    row_number() over (
      partition by ordered.player_id, ordered.won, ordered.overall_run order by ordered.completed_at, ordered.game_id
    ) as overall_length,
    row_number() over (
      partition by ordered.player_id, ordered.opponent_id, ordered.won, ordered.pair_run
      order by ordered.completed_at, ordered.game_id
    ) as pair_length
  from ordered
),
-- The first finished game in which each player rolled each Sucker face.
face_firsts as (
  select distinct on (action.actor_id, action.payload -> 'dice' ->> 0)
    action.actor_id as player_id,
    r.game_id,
    r.completed_at
  from public.turn_actions action
  join public.game_player_results r on r.game_id = action.game_id and r.player_id = action.actor_id
  where action.action_type = 'roll'
    and action.payload -> 'dice' ->> 0 in ('1', '2', '3', '4', '5', '6')
    and action.payload -> 'dice' = jsonb_build_array(
      action.payload -> 'dice' -> 0,
      action.payload -> 'dice' -> 0,
      action.payload -> 'dice' -> 0,
      action.payload -> 'dice' -> 0,
      action.payload -> 'dice' -> 0
    )
  order by action.actor_id, action.payload -> 'dice' ->> 0, r.completed_at, r.game_id
),
earned as (
  select streak.player_id, 'hot_streak' as feat_key, streak.game_id, streak.completed_at
  from streaks streak where streak.won and streak.overall_length = 5
  union all
  select streak.player_id, 'on_fire', streak.game_id, streak.completed_at
  from streaks streak where streak.won and streak.overall_length = 10
  union all
  select streak.player_id, 'got_your_number', streak.game_id, streak.completed_at
  from streaks streak where streak.won and streak.pair_length = 5
  union all
  -- The collection completes on the game that rolled its last new face.
  select collected.player_id, 'sucker_collector', collected.game_id, collected.completed_at
  from (
    select distinct on (face.player_id) face.player_id, face.game_id, face.completed_at
    from face_firsts face
    where face.player_id in (select player_id from face_firsts group by player_id having count(*) = 6)
    order by face.player_id, face.completed_at desc, face.game_id desc
  ) collected
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
