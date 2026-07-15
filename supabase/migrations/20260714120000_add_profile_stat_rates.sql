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
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null then
    raise exception 'You must be signed in to view stats.' using errcode = '42501';
  end if;

  if target_profile_id <> viewer_id and not exists (
    select 1
    from public.game_players viewer
    join public.game_players target on target.game_id = viewer.game_id
    where viewer.player_id = viewer_id
      and target.player_id = target_profile_id
  ) then
    raise exception 'You can only view stats for players you have played.' using errcode = '42501';
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
