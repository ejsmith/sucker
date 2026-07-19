create or replace function public.get_profile_stat_rates(target_profile_id uuid)
returns table (
  games_played integer,
  wins integer,
  losses integer,
  highest_score integer,
  average_score numeric,
  blowout_wins integer,
  blowout_losses integer,
  comeback_wins integer,
  extra_rolls_used integer,
  sucker_hunts integer,
  sucker_hunt_misses integer,
  sucker_punches_received integer,
  sucker_punches_used integer,
  sucker_blockers_used integer,
  mulligans_used integer,
  forced_rerolls integer,
  average_sucker_tokens_spent numeric,
  average_sucker_tokens_leftover numeric,
  upper_bonus_pct numeric,
  sucker_pct numeric,
  three_of_a_kind_pct numeric,
  four_of_a_kind_pct numeric,
  full_house_pct numeric,
  small_straight_pct numeric,
  large_straight_pct numeric,
  buzzer_beater_wins integer,
  sucker_punch_landed_pct numeric
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to view stats.' using errcode = '42501';
  end if;

  return query
  with totals as (
    select
      coalesce(sum(stats.games_played), 0)::integer as games_played,
      coalesce(sum(stats.wins), 0)::integer as wins,
      coalesce(sum(stats.losses), 0)::integer as losses,
      coalesce(max(stats.highest_score), 0)::integer as highest_score,
      coalesce(sum(stats.total_score), 0)::numeric as total_score,
      coalesce(sum(stats.blowout_wins), 0)::integer as blowout_wins,
      coalesce(sum(stats.blowout_losses), 0)::integer as blowout_losses,
      coalesce(sum(stats.comeback_wins), 0)::integer as comeback_wins,
      coalesce(sum(stats.extra_rolls_used), 0)::integer as extra_rolls_used,
      coalesce(sum(stats.sucker_hunts), 0)::integer as sucker_hunts,
      coalesce(sum(stats.sucker_hunt_misses), 0)::integer as sucker_hunt_misses,
      coalesce(sum(stats.sucker_punches_received), 0)::integer as sucker_punches_received,
      coalesce(sum(stats.sucker_punches_used), 0)::integer as sucker_punches_used,
      coalesce(sum(stats.sucker_punches_landed), 0)::integer as sucker_punches_landed,
      coalesce(sum(stats.sucker_blockers_used), 0)::integer as sucker_blockers_used,
      coalesce(sum(stats.mulligans_used), 0)::integer as mulligans_used,
      coalesce(sum(stats.forced_rerolls), 0)::integer as forced_rerolls,
      coalesce(sum(stats.sucker_tokens_spent), 0)::numeric as sucker_tokens_spent,
      coalesce(sum(stats.sucker_tokens_leftover), 0)::numeric as sucker_tokens_leftover,
      coalesce(sum(stats.upper_bonus_games), 0)::numeric as upper_bonus_games,
      coalesce(sum(stats.sucker_games), 0)::numeric as sucker_games,
      coalesce(sum(stats.three_of_a_kind_games), 0)::numeric as three_of_a_kind_games,
      coalesce(sum(stats.four_of_a_kind_games), 0)::numeric as four_of_a_kind_games,
      coalesce(sum(stats.full_house_games), 0)::numeric as full_house_games,
      coalesce(sum(stats.small_straight_games), 0)::numeric as small_straight_games,
      coalesce(sum(stats.large_straight_games), 0)::numeric as large_straight_games,
      coalesce(sum(stats.buzzer_beater_wins), 0)::integer as buzzer_beater_wins
    from public.head_to_head_stats stats
    where stats.player_id = target_profile_id
  )
  select
    totals.games_played,
    totals.wins,
    totals.losses,
    totals.highest_score,
    round(totals.total_score / totals.games_played, 2),
    totals.blowout_wins,
    totals.blowout_losses,
    totals.comeback_wins,
    totals.extra_rolls_used,
    totals.sucker_hunts,
    totals.sucker_hunt_misses,
    totals.sucker_punches_received,
    totals.sucker_punches_used,
    totals.sucker_blockers_used,
    totals.mulligans_used,
    totals.forced_rerolls,
    round(totals.sucker_tokens_spent / totals.games_played, 2),
    round(totals.sucker_tokens_leftover / totals.games_played, 2),
    round(totals.upper_bonus_games / totals.games_played * 100, 2),
    round(totals.sucker_games / totals.games_played * 100, 2),
    round(totals.three_of_a_kind_games / totals.games_played * 100, 2),
    round(totals.four_of_a_kind_games / totals.games_played * 100, 2),
    round(totals.full_house_games / totals.games_played * 100, 2),
    round(totals.small_straight_games / totals.games_played * 100, 2),
    round(totals.large_straight_games / totals.games_played * 100, 2),
    totals.buzzer_beater_wins,
    case
      when totals.sucker_punches_used = 0 then 0
      else round(totals.sucker_punches_landed::numeric / totals.sucker_punches_used * 100, 2)
    end
  from totals
  where totals.games_played > 0;
end;
$$;

revoke all on function public.get_profile_stat_rates(uuid) from public;
grant execute on function public.get_profile_stat_rates(uuid) to authenticated;

create or replace function public.get_profile_recent_games(target_profile_id uuid, game_limit integer default 25)
returns table (
  game_id uuid,
  completed_at timestamptz,
  player_id uuid,
  player_name text,
  player_avatar_url text,
  player_score integer,
  player_scorecard jsonb,
  player_sucker_tokens integer,
  player_sucker_tokens_spent integer,
  opponent_id uuid,
  opponent_name text,
  opponent_avatar_url text,
  opponent_score integer,
  opponent_scorecard jsonb,
  opponent_sucker_tokens integer,
  opponent_sucker_tokens_spent integer
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to view completed games.' using errcode = '42501';
  end if;

  return query
  select
    game.id,
    coalesce(game.completed_at, game.updated_at),
    selected_player.player_id,
    selected_profile.display_name,
    selected_profile.avatar_url,
    selected_result.final_score,
    coalesce(selected_state.value -> 'scorecard', '{}'::jsonb),
    selected_result.sucker_tokens_leftover,
    selected_result.sucker_tokens_spent,
    opponent_player.player_id,
    opponent_profile.display_name,
    opponent_profile.avatar_url,
    opponent_result.final_score,
    coalesce(opponent_state.value -> 'scorecard', '{}'::jsonb),
    opponent_result.sucker_tokens_leftover,
    opponent_result.sucker_tokens_spent
  from public.games game
  join public.game_players selected_player
    on selected_player.game_id = game.id
    and selected_player.player_id = target_profile_id
    and selected_player.hidden_at is null
  join public.game_players opponent_player
    on opponent_player.game_id = game.id
    and opponent_player.player_id <> target_profile_id
  join public.game_player_results selected_result
    on selected_result.game_id = game.id
    and selected_result.player_id = selected_player.player_id
  join public.game_player_results opponent_result
    on opponent_result.game_id = game.id
    and opponent_result.player_id = opponent_player.player_id
  join public.profiles selected_profile on selected_profile.id = selected_player.player_id
  join public.profiles opponent_profile on opponent_profile.id = opponent_player.player_id
  cross join lateral (
    select player.value
    from jsonb_array_elements(game.state -> 'players') player(value)
    where player.value ->> 'id' = selected_player.player_id::text
    limit 1
  ) selected_state
  cross join lateral (
    select player.value
    from jsonb_array_elements(game.state -> 'players') player(value)
    where player.value ->> 'id' = opponent_player.player_id::text
    limit 1
  ) opponent_state
  where game.status = 'complete'
  order by coalesce(game.completed_at, game.updated_at) desc
  limit least(greatest(coalesce(game_limit, 25), 1), 25);
end;
$$;

revoke all on function public.get_profile_recent_games(uuid, integer) from public;
grant execute on function public.get_profile_recent_games(uuid, integer) to authenticated;
