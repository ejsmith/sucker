create table public.computer_stats (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  games_played integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  highest_score integer not null default 0,
  total_score integer not null default 0,
  average_score numeric(8, 2) not null default 0,
  upper_bonus_games integer not null default 0,
  sucker_games integer not null default 0,
  three_of_a_kind_games integer not null default 0,
  four_of_a_kind_games integer not null default 0,
  full_house_games integer not null default 0,
  small_straight_games integer not null default 0,
  large_straight_games integer not null default 0,
  updated_at timestamptz not null default now()
);

create trigger computer_stats_touch_updated_at
before update on public.computer_stats
for each row execute function public.touch_updated_at();

create or replace function public.record_computer_game_result(
  player_score integer,
  computer_score integer,
  upper_bonus_awarded boolean,
  scored_sucker boolean,
  scored_three_of_a_kind boolean,
  scored_four_of_a_kind boolean,
  scored_full_house boolean,
  scored_small_straight boolean,
  scored_large_straight boolean
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
    profile_id,
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
    large_straight_games
  )
  values (
    current_profile_id,
    1,
    case when player_score > computer_score then 1 else 0 end,
    case when player_score < computer_score then 1 else 0 end,
    greatest(player_score, 0),
    greatest(player_score, 0),
    greatest(player_score, 0),
    case when upper_bonus_awarded then 1 else 0 end,
    case when scored_sucker then 1 else 0 end,
    case when scored_three_of_a_kind then 1 else 0 end,
    case when scored_four_of_a_kind then 1 else 0 end,
    case when scored_full_house then 1 else 0 end,
    case when scored_small_straight then 1 else 0 end,
    case when scored_large_straight then 1 else 0 end
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
    large_straight_games = public.computer_stats.large_straight_games + excluded.large_straight_games
  returning * into result;

  return result;
end;
$$;

alter table public.computer_stats enable row level security;

create policy "Users can manage their own computer stats"
on public.computer_stats for all
to authenticated
using ((select auth.uid()) = profile_id)
with check ((select auth.uid()) = profile_id);

grant execute on function public.record_computer_game_result(
  integer,
  integer,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean
) to authenticated;
