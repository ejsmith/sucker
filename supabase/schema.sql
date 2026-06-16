create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id)
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('inviting', 'active', 'response_window', 'blocked_response', 'complete')),
  current_player_id uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  winner_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.game_players (
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  seat_index integer not null,
  sucker_tokens integer not null default 1,
  scorecard jsonb not null default '{}'::jsonb,
  final_score integer,
  upper_bonus_awarded boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (game_id, player_id),
  unique (game_id, seat_index)
);

create table public.turns (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  turn_index integer not null,
  dice integer[] not null,
  category text not null,
  score integer not null,
  roll_count integer not null,
  status text not null default 'submitted' check (status in ('submitted', 'punched', 'blocked', 'finalized')),
  created_at timestamptz not null default now(),
  unique (game_id, turn_index)
);

create table public.token_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  target_turn_id uuid references public.turns(id) on delete cascade,
  event_type text not null check (event_type in ('earned_sucker', 'mulligan', 'sucker_punch', 'sucker_blocker')),
  token_delta integer not null,
  created_at timestamptz not null default now()
);

create table public.game_player_results (
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  opponent_id uuid not null references public.profiles(id) on delete cascade,
  won boolean not null,
  final_score integer not null,
  upper_bonus_awarded boolean not null,
  sucker_count integer not null default 0,
  three_of_a_kind_count integer not null default 0,
  four_of_a_kind_count integer not null default 0,
  full_house_count integer not null default 0,
  small_straight_count integer not null default 0,
  large_straight_count integer not null default 0,
  mulligans_used integer not null default 0,
  sucker_punches_used integer not null default 0,
  sucker_punches_received integer not null default 0,
  sucker_blockers_used integer not null default 0,
  forced_rerolls integer not null default 0,
  completed_at timestamptz not null default now(),
  primary key (game_id, player_id)
);

create table public.head_to_head_stats (
  player_id uuid not null references public.profiles(id) on delete cascade,
  opponent_id uuid not null references public.profiles(id) on delete cascade,
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
  mulligans_used integer not null default 0,
  sucker_punches_used integer not null default 0,
  sucker_punches_received integer not null default 0,
  sucker_blockers_used integer not null default 0,
  forced_rerolls integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (player_id, opponent_id),
  check (player_id <> opponent_id)
);

create view public.head_to_head_stat_rates as
select
  player_id,
  opponent_id,
  games_played,
  wins,
  losses,
  highest_score,
  average_score,
  case when games_played = 0 then 0 else round(upper_bonus_games::numeric / games_played * 100, 2) end as upper_bonus_pct,
  case when games_played = 0 then 0 else round(sucker_games::numeric / games_played * 100, 2) end as sucker_pct,
  case when games_played = 0 then 0 else round(three_of_a_kind_games::numeric / games_played * 100, 2) end as three_of_a_kind_pct,
  case when games_played = 0 then 0 else round(four_of_a_kind_games::numeric / games_played * 100, 2) end as four_of_a_kind_pct,
  case when games_played = 0 then 0 else round(full_house_games::numeric / games_played * 100, 2) end as full_house_pct,
  case when games_played = 0 then 0 else round(small_straight_games::numeric / games_played * 100, 2) end as small_straight_pct,
  case when games_played = 0 then 0 else round(large_straight_games::numeric / games_played * 100, 2) end as large_straight_pct,
  mulligans_used,
  sucker_punches_used,
  sucker_punches_received,
  sucker_blockers_used,
  forced_rerolls
from public.head_to_head_stats;

create table public.game_invites (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid references public.profiles(id) on delete cascade,
  invite_code text unique not null,
  status text not null check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now()
);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text unique not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now()
);
