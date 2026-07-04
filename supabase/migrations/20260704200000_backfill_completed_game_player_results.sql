with completed_games as (
  select id, winner_id, state, coalesce(completed_at, updated_at) as completed_at
  from public.games
  where status = 'complete'
    and jsonb_typeof(state->'players') = 'array'
),
completed_players as (
  select
    game.id as game_id,
    game.winner_id,
    game.completed_at,
    player.value as player_state,
    player.value->>'id' as player_id
  from completed_games game
  cross join lateral jsonb_array_elements(game.state->'players') as player(value)
  where player.value->>'id' is not null
),
player_scores as (
  select
    game_id,
    winner_id,
    completed_at,
    player_id::uuid as player_id,
    greatest(coalesce((player_state->>'suckerTokens')::integer, 0), 0) as sucker_tokens_leftover,
    coalesce((player_state #>> '{scorecard,ones}')::integer, 0) as ones_score,
    coalesce((player_state #>> '{scorecard,twos}')::integer, 0) as twos_score,
    coalesce((player_state #>> '{scorecard,threes}')::integer, 0) as threes_score,
    coalesce((player_state #>> '{scorecard,fours}')::integer, 0) as fours_score,
    coalesce((player_state #>> '{scorecard,fives}')::integer, 0) as fives_score,
    coalesce((player_state #>> '{scorecard,sixes}')::integer, 0) as sixes_score,
    coalesce((player_state #>> '{scorecard,threeOfAKind}')::integer, 0) as three_of_a_kind_score,
    coalesce((player_state #>> '{scorecard,fourOfAKind}')::integer, 0) as four_of_a_kind_score,
    coalesce((player_state #>> '{scorecard,fullHouse}')::integer, 0) as full_house_score,
    coalesce((player_state #>> '{scorecard,smallStraight}')::integer, 0) as small_straight_score,
    coalesce((player_state #>> '{scorecard,largeStraight}')::integer, 0) as large_straight_score,
    coalesce((player_state #>> '{scorecard,sucker}')::integer, 0) as sucker_score,
    coalesce((player_state #>> '{scorecard,chance}')::integer, 0) as chance_score
  from completed_players
),
scored_results as (
  select
    *,
    ones_score + twos_score + threes_score + fours_score + fives_score + sixes_score as upper_score,
    ones_score + twos_score + threes_score + fours_score + fives_score + sixes_score >= 63 as upper_bonus_awarded,
    ones_score + twos_score + threes_score + fours_score + fives_score + sixes_score +
      case when ones_score + twos_score + threes_score + fours_score + fives_score + sixes_score >= 63 then 35 else 0 end +
      three_of_a_kind_score + four_of_a_kind_score + full_house_score + small_straight_score +
      large_straight_score + sucker_score + chance_score as final_score
  from player_scores
),
action_stats as (
  select
    game_id,
    actor_id::uuid as player_id,
    count(*) filter (where action_type = 'extra_roll')::integer as extra_rolls_used,
    count(*) filter (where action_type = 'mulligan')::integer as mulligans_used,
    count(*) filter (where action_type = 'extra_roll' and payload->>'suckerHunt' = 'true')::integer as sucker_hunts,
    count(*) filter (where action_type = 'sucker_punch')::integer as sucker_punches_used,
    count(*) filter (where action_type = 'sucker_blocker')::integer as sucker_blockers_used,
    (
      count(*) filter (where action_type = 'extra_roll') * 1 +
      count(*) filter (where action_type in ('mulligan', 'sucker_punch', 'sucker_blocker')) * 3
    )::integer as sucker_tokens_spent
  from public.turn_actions
  group by game_id, actor_id
),
sucker_hunt_misses as (
  select
    hunt.game_id,
    hunt.actor_id::uuid as player_id,
    count(*) filter (
      where not coalesce(
        (
          select count(distinct die.value) = 1
          from jsonb_array_elements_text(next_roll.payload->'dice') as die(value)
        ),
        false
      )
    )::integer as sucker_hunt_misses
  from public.turn_actions hunt
  left join lateral (
    select payload
    from public.turn_actions roll
    where roll.game_id = hunt.game_id
      and roll.actor_id = hunt.actor_id
      and roll.action_type = 'roll'
      and roll.created_at > hunt.created_at
    order by roll.created_at
    limit 1
  ) next_roll on true
  where hunt.action_type = 'extra_roll'
    and hunt.payload->>'suckerHunt' = 'true'
  group by hunt.game_id, hunt.actor_id
),
received_stats as (
  select
    game_id,
    (payload->>'targetPlayerId')::uuid as player_id,
    count(*)::integer as sucker_punches_received
  from public.turn_actions
  where action_type = 'sucker_punch'
    and payload->>'targetPlayerId' is not null
  group by game_id, payload->>'targetPlayerId'
),
missing_results as (
  select
    player.game_id,
    player.player_id,
    opponent.player_id as opponent_id,
    player.player_id = player.winner_id as won,
    player.final_score,
    player.upper_bonus_awarded,
    case when player.sucker_score > 0 then 1 else 0 end as sucker_count,
    case when player.three_of_a_kind_score > 0 then 1 else 0 end as three_of_a_kind_count,
    case when player.four_of_a_kind_score > 0 then 1 else 0 end as four_of_a_kind_count,
    case when player.full_house_score > 0 then 1 else 0 end as full_house_count,
    case when player.small_straight_score > 0 then 1 else 0 end as small_straight_count,
    case when player.large_straight_score > 0 then 1 else 0 end as large_straight_count,
    case when player.player_id = player.winner_id and abs(player.final_score - opponent.final_score) >= 75 then 1 else 0 end as blowout_win,
    case when player.player_id <> player.winner_id and abs(player.final_score - opponent.final_score) >= 75 then 1 else 0 end as blowout_loss,
    0 as comeback_win,
    coalesce(action_stats.extra_rolls_used, 0) as extra_rolls_used,
    coalesce(action_stats.mulligans_used, 0) as mulligans_used,
    coalesce(action_stats.sucker_hunts, 0) as sucker_hunts,
    coalesce(sucker_hunt_misses.sucker_hunt_misses, 0) as sucker_hunt_misses,
    coalesce(action_stats.sucker_punches_used, 0) as sucker_punches_used,
    coalesce(received_stats.sucker_punches_received, 0) as sucker_punches_received,
    coalesce(action_stats.sucker_blockers_used, 0) as sucker_blockers_used,
    coalesce(received_stats.sucker_punches_received, 0) as forced_rerolls,
    coalesce(action_stats.sucker_tokens_spent, 0) as sucker_tokens_spent,
    player.sucker_tokens_leftover,
    player.completed_at
  from scored_results player
  join scored_results opponent
    on opponent.game_id = player.game_id
   and opponent.player_id <> player.player_id
  left join action_stats
    on action_stats.game_id = player.game_id
   and action_stats.player_id = player.player_id
  left join sucker_hunt_misses
    on sucker_hunt_misses.game_id = player.game_id
   and sucker_hunt_misses.player_id = player.player_id
  left join received_stats
    on received_stats.game_id = player.game_id
   and received_stats.player_id = player.player_id
  where not exists (
    select 1
    from public.game_player_results existing
    where existing.game_id = player.game_id
      and existing.player_id = player.player_id
  )
)
insert into public.game_player_results (
  game_id,
  player_id,
  opponent_id,
  won,
  final_score,
  upper_bonus_awarded,
  sucker_count,
  three_of_a_kind_count,
  four_of_a_kind_count,
  full_house_count,
  small_straight_count,
  large_straight_count,
  blowout_win,
  blowout_loss,
  comeback_win,
  extra_rolls_used,
  mulligans_used,
  sucker_hunts,
  sucker_hunt_misses,
  sucker_punches_used,
  sucker_punches_received,
  sucker_blockers_used,
  forced_rerolls,
  sucker_tokens_spent,
  sucker_tokens_leftover,
  completed_at
)
select
  game_id,
  player_id,
  opponent_id,
  won,
  final_score,
  upper_bonus_awarded,
  sucker_count,
  three_of_a_kind_count,
  four_of_a_kind_count,
  full_house_count,
  small_straight_count,
  large_straight_count,
  blowout_win,
  blowout_loss,
  comeback_win,
  extra_rolls_used,
  mulligans_used,
  sucker_hunts,
  sucker_hunt_misses,
  sucker_punches_used,
  sucker_punches_received,
  sucker_blockers_used,
  forced_rerolls,
  sucker_tokens_spent,
  sucker_tokens_leftover,
  completed_at
from missing_results;

delete from public.head_to_head_stats;

insert into public.head_to_head_stats (
  player_id,
  opponent_id,
  games_played,
  wins,
  losses,
  highest_score,
  total_score,
  average_score,
  upper_bonus_games,
  sucker_games,
  three_of_a_kind_games,
  four_of_a_kind_games,
  full_house_games,
  small_straight_games,
  large_straight_games,
  blowout_wins,
  blowout_losses,
  comeback_wins,
  extra_rolls_used,
  mulligans_used,
  sucker_hunts,
  sucker_hunt_misses,
  sucker_punches_used,
  sucker_punches_received,
  sucker_blockers_used,
  forced_rerolls,
  sucker_tokens_spent,
  average_sucker_tokens_spent,
  sucker_tokens_leftover,
  average_sucker_tokens_leftover
)
select
  player_id,
  opponent_id,
  count(*)::integer as games_played,
  sum(case when won then 1 else 0 end)::integer as wins,
  sum(case when won then 0 else 1 end)::integer as losses,
  max(final_score)::integer as highest_score,
  sum(final_score)::integer as total_score,
  round(avg(final_score)::numeric, 2) as average_score,
  sum(case when upper_bonus_awarded then 1 else 0 end)::integer as upper_bonus_games,
  sum(case when sucker_count > 0 then 1 else 0 end)::integer as sucker_games,
  sum(case when three_of_a_kind_count > 0 then 1 else 0 end)::integer as three_of_a_kind_games,
  sum(case when four_of_a_kind_count > 0 then 1 else 0 end)::integer as four_of_a_kind_games,
  sum(case when full_house_count > 0 then 1 else 0 end)::integer as full_house_games,
  sum(case when small_straight_count > 0 then 1 else 0 end)::integer as small_straight_games,
  sum(case when large_straight_count > 0 then 1 else 0 end)::integer as large_straight_games,
  sum(blowout_win)::integer as blowout_wins,
  sum(blowout_loss)::integer as blowout_losses,
  sum(comeback_win)::integer as comeback_wins,
  sum(extra_rolls_used)::integer as extra_rolls_used,
  sum(mulligans_used)::integer as mulligans_used,
  sum(sucker_hunts)::integer as sucker_hunts,
  sum(sucker_hunt_misses)::integer as sucker_hunt_misses,
  sum(sucker_punches_used)::integer as sucker_punches_used,
  sum(sucker_punches_received)::integer as sucker_punches_received,
  sum(sucker_blockers_used)::integer as sucker_blockers_used,
  sum(forced_rerolls)::integer as forced_rerolls,
  sum(sucker_tokens_spent)::integer as sucker_tokens_spent,
  round(avg(sucker_tokens_spent)::numeric, 2) as average_sucker_tokens_spent,
  sum(sucker_tokens_leftover)::integer as sucker_tokens_leftover,
  round(avg(sucker_tokens_leftover)::numeric, 2) as average_sucker_tokens_leftover
from public.game_player_results
group by player_id, opponent_id;
