alter table public.game_player_results
add column sucker_punches_landed integer not null default 0;

alter table public.head_to_head_stats
add column sucker_punches_landed integer not null default 0;

alter table public.computer_stats
add column sucker_punches_landed integer not null default 0;

update public.game_player_results result
set sucker_punches_landed = coalesce((
  select count(*)::integer
  from public.turn_actions action
  where action.game_id = result.game_id
    and action.actor_id = result.player_id
    and action.action_type = 'sucker_punch'
    and coalesce((action.payload->>'landed')::boolean, true)
), 0);

update public.head_to_head_stats stats
set sucker_punches_landed = coalesce((
  select sum(result.sucker_punches_landed)::integer
  from public.game_player_results result
  where result.player_id = stats.player_id
    and result.opponent_id = stats.opponent_id
), 0);

create or replace view public.head_to_head_stat_rates as
select
  player_id,
  opponent_id,
  games_played,
  wins,
  losses,
  highest_score,
  average_score,
  blowout_wins,
  blowout_losses,
  comeback_wins,
  extra_rolls_used,
  sucker_hunts,
  sucker_hunt_misses,
  sucker_punches_received,
  sucker_punches_used,
  sucker_blockers_used,
  mulligans_used,
  forced_rerolls,
  average_sucker_tokens_spent,
  average_sucker_tokens_leftover,
  case when games_played = 0 then 0 else round(upper_bonus_games::numeric / games_played * 100, 2) end as upper_bonus_pct,
  case when games_played = 0 then 0 else round(sucker_games::numeric / games_played * 100, 2) end as sucker_pct,
  case when games_played = 0 then 0 else round(three_of_a_kind_games::numeric / games_played * 100, 2) end as three_of_a_kind_pct,
  case when games_played = 0 then 0 else round(four_of_a_kind_games::numeric / games_played * 100, 2) end as four_of_a_kind_pct,
  case when games_played = 0 then 0 else round(full_house_games::numeric / games_played * 100, 2) end as full_house_pct,
  case when games_played = 0 then 0 else round(small_straight_games::numeric / games_played * 100, 2) end as small_straight_pct,
  case when games_played = 0 then 0 else round(large_straight_games::numeric / games_played * 100, 2) end as large_straight_pct,
  buzzer_beater_wins,
  case when sucker_punches_used = 0 then 0 else round(sucker_punches_landed::numeric / sucker_punches_used * 100, 2) end as sucker_punch_landed_pct
from public.head_to_head_stats;

drop function public.record_computer_game_result(
  integer, integer,
  boolean, boolean, boolean, boolean, boolean, boolean, boolean,
  boolean, boolean, boolean, boolean, boolean, boolean, boolean,
  integer, integer, integer, integer, integer, integer, integer, integer, integer, integer
);

create function public.record_computer_game_result(
  player_score integer,
  computer_score integer,
  upper_bonus_awarded boolean,
  scored_sucker boolean,
  scored_three_of_a_kind boolean,
  scored_four_of_a_kind boolean,
  scored_full_house boolean,
  scored_small_straight boolean,
  scored_large_straight boolean,
  computer_upper_bonus_awarded boolean,
  computer_scored_sucker boolean,
  computer_scored_three_of_a_kind boolean,
  computer_scored_four_of_a_kind boolean,
  computer_scored_full_house boolean,
  computer_scored_small_straight boolean,
  computer_scored_large_straight boolean,
  buzzer_beater_wins integer,
  comeback_wins integer,
  extra_rolls_used integer,
  mulligans_used integer,
  sucker_hunts integer,
  sucker_hunt_misses integer,
  sucker_punches_landed integer,
  sucker_punches_used integer,
  sucker_blockers_used integer,
  sucker_tokens_spent integer,
  sucker_tokens_leftover integer
)
returns public.computer_stats
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_profile_id uuid := auth.uid();
  result public.computer_stats;
begin
  if current_profile_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.computer_stats (
    profile_id, games_played, wins, losses, highest_score, total_score, average_score,
    upper_bonus_games, sucker_games, three_of_a_kind_games, four_of_a_kind_games,
    full_house_games, small_straight_games, large_straight_games, blowout_wins,
    blowout_losses, buzzer_beater_wins, comeback_wins, extra_rolls_used, mulligans_used,
    sucker_hunts, sucker_hunt_misses, sucker_punches_landed, sucker_punches_used,
    sucker_blockers_used, sucker_tokens_spent, average_sucker_tokens_spent,
    sucker_tokens_leftover, average_sucker_tokens_leftover, computer_highest_score,
    computer_total_score, computer_average_score, computer_upper_bonus_games,
    computer_sucker_games, computer_three_of_a_kind_games, computer_four_of_a_kind_games,
    computer_full_house_games, computer_small_straight_games, computer_large_straight_games
  )
  values (
    current_profile_id, 1,
    case when player_score > computer_score then 1 else 0 end,
    case when player_score < computer_score then 1 else 0 end,
    greatest(player_score, 0), greatest(player_score, 0), greatest(player_score, 0),
    case when upper_bonus_awarded then 1 else 0 end,
    case when scored_sucker then 1 else 0 end,
    case when scored_three_of_a_kind then 1 else 0 end,
    case when scored_four_of_a_kind then 1 else 0 end,
    case when scored_full_house then 1 else 0 end,
    case when scored_small_straight then 1 else 0 end,
    case when scored_large_straight then 1 else 0 end,
    case when player_score - computer_score >= 75 then 1 else 0 end,
    case when computer_score - player_score >= 75 then 1 else 0 end,
    greatest(buzzer_beater_wins, 0), greatest(comeback_wins, 0), greatest(extra_rolls_used, 0),
    greatest(mulligans_used, 0), greatest(sucker_hunts, 0), greatest(sucker_hunt_misses, 0),
    greatest(sucker_punches_landed, 0), greatest(sucker_punches_used, 0),
    greatest(sucker_blockers_used, 0), greatest(sucker_tokens_spent, 0),
    greatest(sucker_tokens_spent, 0), greatest(sucker_tokens_leftover, 0),
    greatest(sucker_tokens_leftover, 0), greatest(computer_score, 0),
    greatest(computer_score, 0), greatest(computer_score, 0),
    case when computer_upper_bonus_awarded then 1 else 0 end,
    case when computer_scored_sucker then 1 else 0 end,
    case when computer_scored_three_of_a_kind then 1 else 0 end,
    case when computer_scored_four_of_a_kind then 1 else 0 end,
    case when computer_scored_full_house then 1 else 0 end,
    case when computer_scored_small_straight then 1 else 0 end,
    case when computer_scored_large_straight then 1 else 0 end
  )
  on conflict (profile_id) do update set
    games_played = public.computer_stats.games_played + 1,
    wins = public.computer_stats.wins + excluded.wins,
    losses = public.computer_stats.losses + excluded.losses,
    highest_score = greatest(public.computer_stats.highest_score, excluded.highest_score),
    total_score = public.computer_stats.total_score + excluded.total_score,
    average_score = round((public.computer_stats.total_score + excluded.total_score)::numeric / (public.computer_stats.games_played + 1), 2),
    upper_bonus_games = public.computer_stats.upper_bonus_games + excluded.upper_bonus_games,
    sucker_games = public.computer_stats.sucker_games + excluded.sucker_games,
    three_of_a_kind_games = public.computer_stats.three_of_a_kind_games + excluded.three_of_a_kind_games,
    four_of_a_kind_games = public.computer_stats.four_of_a_kind_games + excluded.four_of_a_kind_games,
    full_house_games = public.computer_stats.full_house_games + excluded.full_house_games,
    small_straight_games = public.computer_stats.small_straight_games + excluded.small_straight_games,
    large_straight_games = public.computer_stats.large_straight_games + excluded.large_straight_games,
    blowout_wins = public.computer_stats.blowout_wins + excluded.blowout_wins,
    blowout_losses = public.computer_stats.blowout_losses + excluded.blowout_losses,
    buzzer_beater_wins = public.computer_stats.buzzer_beater_wins + excluded.buzzer_beater_wins,
    comeback_wins = public.computer_stats.comeback_wins + excluded.comeback_wins,
    extra_rolls_used = public.computer_stats.extra_rolls_used + excluded.extra_rolls_used,
    mulligans_used = public.computer_stats.mulligans_used + excluded.mulligans_used,
    sucker_hunts = public.computer_stats.sucker_hunts + excluded.sucker_hunts,
    sucker_hunt_misses = public.computer_stats.sucker_hunt_misses + excluded.sucker_hunt_misses,
    sucker_punches_landed = public.computer_stats.sucker_punches_landed + excluded.sucker_punches_landed,
    sucker_punches_used = public.computer_stats.sucker_punches_used + excluded.sucker_punches_used,
    sucker_blockers_used = public.computer_stats.sucker_blockers_used + excluded.sucker_blockers_used,
    sucker_tokens_spent = public.computer_stats.sucker_tokens_spent + excluded.sucker_tokens_spent,
    average_sucker_tokens_spent = round((public.computer_stats.sucker_tokens_spent + excluded.sucker_tokens_spent)::numeric / (public.computer_stats.games_played + 1), 2),
    sucker_tokens_leftover = public.computer_stats.sucker_tokens_leftover + excluded.sucker_tokens_leftover,
    average_sucker_tokens_leftover = round((public.computer_stats.sucker_tokens_leftover + excluded.sucker_tokens_leftover)::numeric / (public.computer_stats.games_played + 1), 2),
    computer_highest_score = greatest(public.computer_stats.computer_highest_score, excluded.computer_highest_score),
    computer_total_score = public.computer_stats.computer_total_score + excluded.computer_total_score,
    computer_average_score = round((public.computer_stats.computer_total_score + excluded.computer_total_score)::numeric / (public.computer_stats.games_played + 1), 2),
    computer_upper_bonus_games = public.computer_stats.computer_upper_bonus_games + excluded.computer_upper_bonus_games,
    computer_sucker_games = public.computer_stats.computer_sucker_games + excluded.computer_sucker_games,
    computer_three_of_a_kind_games = public.computer_stats.computer_three_of_a_kind_games + excluded.computer_three_of_a_kind_games,
    computer_four_of_a_kind_games = public.computer_stats.computer_four_of_a_kind_games + excluded.computer_four_of_a_kind_games,
    computer_full_house_games = public.computer_stats.computer_full_house_games + excluded.computer_full_house_games,
    computer_small_straight_games = public.computer_stats.computer_small_straight_games + excluded.computer_small_straight_games,
    computer_large_straight_games = public.computer_stats.computer_large_straight_games + excluded.computer_large_straight_games
  returning * into result;

  return result;
end;
$$;

grant execute on function public.record_computer_game_result(
  integer, integer,
  boolean, boolean, boolean, boolean, boolean, boolean, boolean,
  boolean, boolean, boolean, boolean, boolean, boolean, boolean,
  integer, integer, integer, integer, integer, integer, integer, integer, integer, integer, integer
) to authenticated;
