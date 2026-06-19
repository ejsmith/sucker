-- Sucker! multiplayer backend baseline.
--
-- Apply with the Supabase SQL editor or `supabase db push` after linking a project.
-- The client only uses the anon key. Server-side game mutations go through the
-- `game-action` Edge Function with the service-role key.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_length check (username is null or char_length(username) between 3 and 24),
  constraint username_format check (username is null or username ~ '^[a-zA-Z0-9_]+$')
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active' check (
    status in ('inviting', 'active', 'response_window', 'blocked_response', 'complete')
  ),
  created_by uuid not null references public.profiles(id),
  current_player_id uuid references public.profiles(id),
  winner_id uuid references public.profiles(id),
  state jsonb not null,
  last_turn_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.game_players (
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  seat_index integer not null check (seat_index in (0, 1)),
  sucker_tokens integer not null default 1 check (sucker_tokens >= 0),
  final_score integer,
  upper_bonus_awarded boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (game_id, player_id),
  unique (game_id, seat_index)
);

create table public.game_invites (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid references public.profiles(id) on delete cascade,
  invite_code text unique not null default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.turns (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  turn_index integer not null,
  dice integer[] not null check (array_length(dice, 1) = 5),
  held boolean[] not null check (array_length(held, 1) = 5),
  category text not null,
  score integer not null,
  roll_count integer not null check (roll_count >= 1),
  status text not null default 'submitted' check (status in ('submitted', 'punched', 'blocked', 'mulliganed', 'finalized')),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (game_id, turn_index)
);

create table public.turn_actions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  turn_id uuid references public.turns(id) on delete set null,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  action_type text not null check (
    action_type in (
      'create_game',
      'create_invite',
      'accept_invite',
      'roll',
      'score_category',
      'pass_response',
      'mulligan',
      'sucker_punch',
      'sucker_blocker',
      'taunt'
    )
  ),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.token_events (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  target_turn_id uuid references public.turns(id) on delete set null,
  event_type text not null check (event_type in ('earned_sucker', 'mulligan', 'sucker_punch', 'sucker_blocker')),
  token_delta integer not null,
  created_at timestamptz not null default now()
);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  device_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

create or replace view public.head_to_head_stat_rates as
select
  player_id,
  opponent_id,
  games_played,
  wins,
  losses,
  highest_score,
  average_score,
  sucker_punches_received,
  sucker_blockers_used,
  mulligans_used,
  forced_rerolls,
  case when games_played = 0 then 0 else round(upper_bonus_games::numeric / games_played * 100, 2) end as upper_bonus_pct,
  case when games_played = 0 then 0 else round(sucker_games::numeric / games_played * 100, 2) end as sucker_pct,
  case when games_played = 0 then 0 else round(three_of_a_kind_games::numeric / games_played * 100, 2) end as three_of_a_kind_pct,
  case when games_played = 0 then 0 else round(four_of_a_kind_games::numeric / games_played * 100, 2) end as four_of_a_kind_pct,
  case when games_played = 0 then 0 else round(full_house_games::numeric / games_played * 100, 2) end as full_house_pct,
  case when games_played = 0 then 0 else round(small_straight_games::numeric / games_played * 100, 2) end as small_straight_pct,
  case when games_played = 0 then 0 else round(large_straight_games::numeric / games_played * 100, 2) end as large_straight_pct
from public.head_to_head_stats;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger friendships_touch_updated_at
before update on public.friendships
for each row execute function public.touch_updated_at();

create trigger games_touch_updated_at
before update on public.games
for each row execute function public.touch_updated_at();

create trigger game_invites_touch_updated_at
before update on public.game_invites
for each row execute function public.touch_updated_at();

create trigger push_tokens_touch_updated_at
before update on public.push_tokens
for each row execute function public.touch_updated_at();

create or replace function public.is_game_participant(target_game_id uuid, target_profile_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.game_players
    where game_id = target_game_id
      and player_id = target_profile_id
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1), 'Player')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_invites enable row level security;
alter table public.turns enable row level security;
alter table public.turn_actions enable row level security;
alter table public.token_events enable row level security;
alter table public.push_tokens enable row level security;
alter table public.game_player_results enable row level security;
alter table public.head_to_head_stats enable row level security;

create policy "Profiles are readable to authenticated users"
on public.profiles for select
to authenticated
using (true);

create policy "Players can update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Friendships are visible to both users"
on public.friendships for select
to authenticated
using ((select auth.uid()) in (requester_id, addressee_id));

create policy "Users can create friend requests"
on public.friendships for insert
to authenticated
with check ((select auth.uid()) = requester_id);

create policy "Users can update their friendships"
on public.friendships for update
to authenticated
using ((select auth.uid()) in (requester_id, addressee_id))
with check ((select auth.uid()) in (requester_id, addressee_id));

create policy "Participants can read games"
on public.games for select
to authenticated
using (public.is_game_participant(id, (select auth.uid())));

create policy "Participants can read game players"
on public.game_players for select
to authenticated
using (public.is_game_participant(game_id, (select auth.uid())));

create policy "Relevant users can read invites"
on public.game_invites for select
to authenticated
using ((select auth.uid()) in (inviter_id, invitee_id) or invitee_id is null);

create policy "Participants can read turns"
on public.turns for select
to authenticated
using (public.is_game_participant(game_id, (select auth.uid())));

create policy "Participants can read turn actions"
on public.turn_actions for select
to authenticated
using (public.is_game_participant(game_id, (select auth.uid())));

create policy "Participants can read token events"
on public.token_events for select
to authenticated
using (public.is_game_participant(game_id, (select auth.uid())));

create policy "Users manage their own push tokens"
on public.push_tokens for all
to authenticated
using ((select auth.uid()) = profile_id)
with check ((select auth.uid()) = profile_id);

create policy "Users can read their own game results"
on public.game_player_results for select
to authenticated
using ((select auth.uid()) = player_id);

create policy "Users can read their own matchup stats"
on public.head_to_head_stats for select
to authenticated
using ((select auth.uid()) = player_id);
