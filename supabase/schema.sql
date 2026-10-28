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
  needs_profile_setup boolean not null default false,
  avatar_url text,
  show_on_leaderboards boolean not null default true,
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
  rematch_of_game_id uuid unique references public.games(id) on delete set null,
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
  sucker_tokens integer not null default 10 check (sucker_tokens >= 0),
  final_score integer,
  upper_bonus_awarded boolean not null default false,
  hidden_at timestamptz,
  -- Null until the player has seen the final result. Finished games stay in
  -- their game list until then.
  result_seen_at timestamptz,
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
  roll_count integer not null check (roll_count >= 0 and (roll_count > 0 or score = 0)),
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
      'rematch_game',
      'nudge_turn',
      'extra_roll',
      'roll',
      'score_category',
      'scratch_category',
      'pass_response',
      'mulligan',
      'sucker_punch',
      'sucker_blocker',
      'taunt',
      'rage_quit',
      'rage_quit_reply'
    )
  ),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index turn_actions_one_taunt_per_turn
on public.turn_actions (
  game_id,
  actor_id,
  coalesce(turn_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
where action_type = 'taunt';

create or replace function public.insert_taunt_if_open(
  target_game_id uuid,
  target_actor_id uuid,
  target_turn_id uuid,
  target_payload jsonb,
  target_source text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_game public.games%rowtype;
begin
  select game.*
  into locked_game
  from public.games game
  where game.id = target_game_id
  for update;

  if not found
    or locked_game.status in ('inviting', 'complete')
    or locked_game.last_turn_id is distinct from target_turn_id
    or target_source not in ('turn', 'punch')
    or (target_source = 'turn' and locked_game.current_player_id is not distinct from target_actor_id)
    or (target_source = 'punch' and locked_game.status <> 'active')
    or coalesce((locked_game.state ->> 'rollNumber')::integer, 0) <> 0
  then
    return false;
  end if;

  insert into public.turn_actions (action_type, actor_id, game_id, payload, turn_id)
  values ('taunt', target_actor_id, target_game_id, target_payload, target_turn_id);

  return true;
end;
$$;

revoke all on function public.insert_taunt_if_open(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.insert_taunt_if_open(uuid, uuid, uuid, jsonb, text) to service_role;

create table public.sucker_punch_attempts (
  game_id uuid not null references public.games(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  turn_id uuid not null references public.turns(id) on delete cascade,
  chance_die integer not null check (chance_die between 1 and 6),
  created_at timestamptz not null default now(),
  primary key (game_id, actor_id, turn_id)
);

alter table public.sucker_punch_attempts enable row level security;
grant all on public.sucker_punch_attempts to service_role;

create table public.game_action_requests (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  action_type text not null,
  -- Keep the original game id after destructive actions delete the game so a
  -- retried request can still return its stored result.
  game_id uuid,
  status text not null default 'processing' check (status in ('processing', 'completed')),
  http_status integer check (http_status between 200 and 599),
  response jsonb,
  notification_claimed_at timestamptz,
  notification_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_id, request_id)
);

create index game_action_requests_actor_created_idx
on public.game_action_requests (actor_id, created_at desc);

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

create table public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh_key text not null,
  auth_key text not null,
  expiration_time timestamptz,
  platform text not null default 'web' check (platform = 'web'),
  user_agent text,
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
  blowout_win integer not null default 0,
  blowout_loss integer not null default 0,
  buzzer_beater_win integer not null default 0,
  comeback_win integer not null default 0,
  extra_rolls_used integer not null default 0,
  mulligans_used integer not null default 0,
  sucker_hunts integer not null default 0,
  sucker_hunt_misses integer not null default 0,
  sucker_punches_landed integer not null default 0,
  sucker_punches_used integer not null default 0,
  sucker_punches_received integer not null default 0,
  sucker_blockers_used integer not null default 0,
  forced_rerolls integer not null default 0,
  sucker_tokens_spent integer not null default 0,
  sucker_tokens_leftover integer not null default 0,
  completed_at timestamptz not null default now(),
  rating_before numeric(7, 2),
  rating_after numeric(7, 2),
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
  blowout_wins integer not null default 0,
  blowout_losses integer not null default 0,
  buzzer_beater_wins integer not null default 0,
  comeback_wins integer not null default 0,
  extra_rolls_used integer not null default 0,
  mulligans_used integer not null default 0,
  sucker_hunts integer not null default 0,
  sucker_hunt_misses integer not null default 0,
  sucker_punches_landed integer not null default 0,
  sucker_punches_used integer not null default 0,
  sucker_punches_received integer not null default 0,
  sucker_blockers_used integer not null default 0,
  forced_rerolls integer not null default 0,
  sucker_tokens_spent integer not null default 0,
  average_sucker_tokens_spent numeric(8, 2) not null default 0,
  sucker_tokens_leftover integer not null default 0,
  average_sucker_tokens_leftover numeric(8, 2) not null default 0,
  -- This player's quits against the opponent, and every forfeited game in the
  -- matchup. Rates and averages divide by games_played - rage_quit_games.
  rage_quits integer not null default 0,
  rage_quit_games integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (player_id, opponent_id),
  check (player_id <> opponent_id)
);

-- Public, server-written shame. Any signed-in player can see who quit and when.
create table public.rage_quits (
  game_id uuid primary key references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index rage_quits_player_created_idx
on public.rage_quits (player_id, created_at desc);

create table public.computer_stats (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  games_played integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  highest_score integer not null default 0,
  total_score integer not null default 0,
  average_score numeric(8, 2) not null default 0,
  computer_highest_score integer not null default 0,
  computer_total_score integer not null default 0,
  computer_average_score numeric(8, 2) not null default 0,
  computer_upper_bonus_games integer not null default 0,
  computer_sucker_games integer not null default 0,
  computer_three_of_a_kind_games integer not null default 0,
  computer_four_of_a_kind_games integer not null default 0,
  computer_full_house_games integer not null default 0,
  computer_small_straight_games integer not null default 0,
  computer_large_straight_games integer not null default 0,
  upper_bonus_games integer not null default 0,
  sucker_games integer not null default 0,
  three_of_a_kind_games integer not null default 0,
  four_of_a_kind_games integer not null default 0,
  full_house_games integer not null default 0,
  small_straight_games integer not null default 0,
  large_straight_games integer not null default 0,
  blowout_wins integer not null default 0,
  blowout_losses integer not null default 0,
  buzzer_beater_wins integer not null default 0,
  comeback_wins integer not null default 0,
  extra_rolls_used integer not null default 0,
  mulligans_used integer not null default 0,
  sucker_hunts integer not null default 0,
  sucker_hunt_misses integer not null default 0,
  sucker_punches_landed integer not null default 0,
  sucker_punches_used integer not null default 0,
  sucker_blockers_used integer not null default 0,
  sucker_tokens_spent integer not null default 0,
  average_sucker_tokens_spent numeric(8, 2) not null default 0,
  sucker_tokens_leftover integer not null default 0,
  average_sucker_tokens_leftover numeric(8, 2) not null default 0,
  updated_at timestamptz not null default now()
);

create or replace view public.head_to_head_stat_rates
with (security_invoker = true) as
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
  case when games_played - rage_quit_games <= 0 then 0 else round(upper_bonus_games::numeric / (games_played - rage_quit_games) * 100, 2) end as upper_bonus_pct,
  case when games_played - rage_quit_games <= 0 then 0 else round(sucker_games::numeric / (games_played - rage_quit_games) * 100, 2) end as sucker_pct,
  case when games_played - rage_quit_games <= 0 then 0 else round(three_of_a_kind_games::numeric / (games_played - rage_quit_games) * 100, 2) end as three_of_a_kind_pct,
  case when games_played - rage_quit_games <= 0 then 0 else round(four_of_a_kind_games::numeric / (games_played - rage_quit_games) * 100, 2) end as four_of_a_kind_pct,
  case when games_played - rage_quit_games <= 0 then 0 else round(full_house_games::numeric / (games_played - rage_quit_games) * 100, 2) end as full_house_pct,
  case when games_played - rage_quit_games <= 0 then 0 else round(small_straight_games::numeric / (games_played - rage_quit_games) * 100, 2) end as small_straight_pct,
  case when games_played - rage_quit_games <= 0 then 0 else round(large_straight_games::numeric / (games_played - rage_quit_games) * 100, 2) end as large_straight_pct,
  buzzer_beater_wins,
  case when sucker_punches_used = 0 then 0 else round(sucker_punches_landed::numeric / sucker_punches_used * 100, 2) end as sucker_punch_landed_pct,
  rage_quits,
  rage_quit_games
from public.head_to_head_stats;

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
  sucker_punch_landed_pct numeric,
  rage_quits integer
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
      coalesce(sum(stats.games_played - stats.rage_quit_games), 0)::numeric as scored_games,
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
      coalesce(sum(stats.buzzer_beater_wins), 0)::integer as buzzer_beater_wins,
      coalesce(sum(stats.rage_quits), 0)::integer as rage_quits
    from public.head_to_head_stats stats
    where stats.player_id = target_profile_id
  )
  select
    totals.games_played,
    totals.wins,
    totals.losses,
    totals.highest_score,
    coalesce(round(totals.total_score / nullif(totals.scored_games, 0), 2), 0),
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
    coalesce(round(totals.sucker_tokens_spent / nullif(totals.scored_games, 0), 2), 0),
    coalesce(round(totals.sucker_tokens_leftover / nullif(totals.scored_games, 0), 2), 0),
    coalesce(round(totals.upper_bonus_games / nullif(totals.scored_games, 0) * 100, 2), 0),
    coalesce(round(totals.sucker_games / nullif(totals.scored_games, 0) * 100, 2), 0),
    coalesce(round(totals.three_of_a_kind_games / nullif(totals.scored_games, 0) * 100, 2), 0),
    coalesce(round(totals.four_of_a_kind_games / nullif(totals.scored_games, 0) * 100, 2), 0),
    coalesce(round(totals.full_house_games / nullif(totals.scored_games, 0) * 100, 2), 0),
    coalesce(round(totals.small_straight_games / nullif(totals.scored_games, 0) * 100, 2), 0),
    coalesce(round(totals.large_straight_games / nullif(totals.scored_games, 0) * 100, 2), 0),
    totals.buzzer_beater_wins,
    case
      when totals.sucker_punches_used = 0 then 0
      else round(totals.sucker_punches_landed::numeric / totals.sucker_punches_used * 100, 2)
    end,
    totals.rage_quits
  from totals
  where totals.games_played > 0;
end;
$$;

revoke all on function public.get_profile_stat_rates(uuid) from public;
grant execute on function public.get_profile_stat_rates(uuid) to authenticated;

-- Older app versions never mark results seen, so only recent ones resurface.
-- Anything older shows under Completed Games as it always did.
create or replace function public.get_unseen_game_results()
returns table (game_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select player.game_id
  from public.game_players player
  join public.games game on game.id = player.game_id
  where player.player_id = (select auth.uid())
    and player.hidden_at is null
    and player.result_seen_at is null
    and game.status = 'complete'
    and game.completed_at > now() - interval '7 days';
$$;

revoke all on function public.get_unseen_game_results() from public, anon;
grant execute on function public.get_unseen_game_results() to authenticated;

-- Marks only the version the player was shown. A newer update, like an insult
-- that landed after the screen loaded, stays unseen.
create or replace function public.mark_game_result_seen(target_game_id uuid, seen_updated_at timestamptz)
returns void
language sql
security definer
set search_path = public
as $$
  update public.game_players player
  set result_seen_at = now()
  from public.games game
  where player.game_id = target_game_id
    and player.player_id = (select auth.uid())
    and game.id = player.game_id
    and game.status = 'complete'
    and game.updated_at <= seen_updated_at;
$$;

revoke all on function public.mark_game_result_seen(uuid, timestamptz) from public, anon;
grant execute on function public.mark_game_result_seen(uuid, timestamptz) to authenticated;

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
  opponent_sucker_tokens_spent integer,
  winner_id uuid,
  rage_quitter_id uuid
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
    opponent_result.sucker_tokens_spent,
    game.winner_id,
    rage_quit.player_id
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
  left join public.rage_quits rage_quit on rage_quit.game_id = game.id
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

create trigger game_action_requests_touch_updated_at
before update on public.game_action_requests
for each row execute function public.touch_updated_at();

create trigger push_tokens_touch_updated_at
before update on public.push_tokens
for each row execute function public.touch_updated_at();

create trigger web_push_subscriptions_touch_updated_at
before update on public.web_push_subscriptions
for each row execute function public.touch_updated_at();

create trigger computer_stats_touch_updated_at
before update on public.computer_stats
for each row execute function public.touch_updated_at();

create index if not exists game_players_visible_player_idx
on public.game_players(player_id, game_id)
where hidden_at is null;

create or replace function public.record_computer_game_result(
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
    large_straight_games,
    blowout_wins,
    blowout_losses,
    buzzer_beater_wins,
    comeback_wins,
    extra_rolls_used,
    mulligans_used,
    sucker_hunts,
    sucker_hunt_misses,
    sucker_punches_landed,
    sucker_punches_used,
    sucker_blockers_used,
    sucker_tokens_spent,
    average_sucker_tokens_spent,
    sucker_tokens_leftover,
    average_sucker_tokens_leftover,
    computer_highest_score,
    computer_total_score,
    computer_average_score,
    computer_upper_bonus_games,
    computer_sucker_games,
    computer_three_of_a_kind_games,
    computer_four_of_a_kind_games,
    computer_full_house_games,
    computer_small_straight_games,
    computer_large_straight_games
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
    case when scored_large_straight then 1 else 0 end,
    case when player_score - computer_score >= 75 then 1 else 0 end,
    case when computer_score - player_score >= 75 then 1 else 0 end,
    greatest(buzzer_beater_wins, 0),
    greatest(comeback_wins, 0),
    greatest(extra_rolls_used, 0),
    greatest(mulligans_used, 0),
    greatest(sucker_hunts, 0),
    greatest(sucker_hunt_misses, 0),
    greatest(sucker_punches_landed, 0),
    greatest(sucker_punches_used, 0),
    greatest(sucker_blockers_used, 0),
    greatest(sucker_tokens_spent, 0),
    greatest(sucker_tokens_spent, 0),
    greatest(sucker_tokens_leftover, 0),
    greatest(sucker_tokens_leftover, 0),
    greatest(computer_score, 0),
    greatest(computer_score, 0),
    greatest(computer_score, 0),
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
      and hidden_at is null
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_apple_signup boolean := coalesce(new.raw_app_meta_data->>'provider' = 'apple', false);
begin
  insert into public.profiles (id, display_name, needs_profile_setup)
  values (
    new.id,
    case when is_apple_signup then 'Player'
      else coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1), 'Player')
    end,
    is_apple_signup
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Players only add a password after signing in. A password present when an
-- email is confirmed by a later request was chosen before anyone proved they
-- own the address. Admin creation and auto-confirmed sign-up confirm in the
-- inserting transaction, so their passwords are kept.
create or replace function public.discard_unconfirmed_password()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform set_config('sucker.inserted_auth_user_id', new.id::text, true);
  elsif old.email_confirmed_at is null
    and new.email_confirmed_at is not null
    and current_setting('sucker.inserted_auth_user_id', true) is distinct from old.id::text then
    new.encrypted_password := '';
  end if;
  return new;
end;
$$;

create trigger on_auth_user_inserted_track_confirmation
before insert on auth.users
for each row execute function public.discard_unconfirmed_password();

create trigger on_auth_user_email_confirmed
before update of email_confirmed_at on auth.users
for each row execute function public.discard_unconfirmed_password();

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_invites enable row level security;
alter table public.turns enable row level security;
alter table public.turn_actions enable row level security;
alter table public.game_action_requests enable row level security;
alter table public.token_events enable row level security;
alter table public.push_tokens enable row level security;
alter table public.web_push_subscriptions enable row level security;
alter table public.game_player_results enable row level security;
alter table public.head_to_head_stats enable row level security;
alter table public.computer_stats enable row level security;
alter table public.rage_quits enable row level security;

alter table public.games replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'turn_actions'
  ) then
    alter publication supabase_realtime add table public.turn_actions;
  end if;
end $$;

create policy "Profiles are readable to authenticated users"
on public.profiles for select
to authenticated
using (true);

create policy "Players can update their own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Players can inspect their own avatars"
on storage.objects for select
to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Players can upload their own avatars"
on storage.objects for insert
to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Players can update their own avatars"
on storage.objects for update
to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Players can delete their own avatars"
on storage.objects for delete
to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

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
using ((select auth.uid()) in (inviter_id, invitee_id));

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

create policy "Users manage their own web push subscriptions"
on public.web_push_subscriptions for all
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

create policy "Users can read reciprocal matchup stats"
on public.head_to_head_stats for select
to authenticated
using ((select auth.uid()) = opponent_id);

-- Only the last day matters for the badge. Counts live in stats, and game
-- history reads this table through a security-definer function.
create policy "Recent rage quits are public to signed-in players"
on public.rage_quits for select
to authenticated
using (created_at > now() - interval '24 hours');

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
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer,
  integer
) to authenticated;

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to service_role;
grant all on all routines in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant all on all tables in schema public to authenticated;
revoke all on table public.game_action_requests from anon, authenticated;
revoke all on public.sucker_punch_attempts from anon, authenticated;
revoke all on public.head_to_head_stat_rates from anon, authenticated;
grant select on public.head_to_head_stat_rates to authenticated;
revoke all on public.rage_quits from anon, authenticated;
grant select on public.rage_quits to authenticated;
grant all on all routines in schema public to authenticated;
revoke all on function public.discard_unconfirmed_password() from public, anon, authenticated;
grant all on all sequences in schema public to authenticated;

-- A move is prepared by the trusted Edge Function and committed with its replay
-- response in one transaction. A stale preparation cannot overwrite a newer move.
create or replace function public.commit_game_move(
  p_actor_id uuid,
  p_request_id uuid,
  p_game_id uuid,
  p_expected_updated_at timestamptz,
  p_game_patch jsonb,
  p_writes jsonb,
  p_result jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_game public.games;
  next_game public.games;
  action_request public.game_action_requests;
  change jsonb;
  table_name text;
  operation text;
  fields text;
  assignments text;
  predicates text;
  conflict_fields text;
  move_response jsonb;
  affected_rows integer;
begin
  select * into strict action_request from public.game_action_requests
    where actor_id = p_actor_id and request_id = p_request_id for update;
  if action_request.status = 'completed' then return action_request.response; end if;
  if action_request.status <> 'processing' then raise exception 'Action is not processing'; end if;
  if action_request.game_id is distinct from p_game_id then raise exception 'Action belongs to a different game'; end if;

  select * into strict current_game from public.games where id = p_game_id for update;
  if not exists(select 1 from public.game_players where game_id=p_game_id and player_id=p_actor_id) then
    raise exception 'Player is not in this game';
  end if;
  if current_game.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode='PT409', message='The game changed on another device. Refresh and try again.';
  end if;
  if exists(select 1 from jsonb_object_keys(p_game_patch) key where key not in
    ('state','status','current_player_id','last_turn_id','completed_at','winner_id')) then
    raise exception 'Invalid game move fields';
  end if;

  -- Finalizing separate games can touch the same two matchup rows in opposite
  -- seat order. Serialize that pair before taking either aggregate row lock.
  if exists(select 1 from jsonb_array_elements(p_writes) item where item->>'table'='head_to_head_stats') then
    perform pg_advisory_xact_lock(hashtextextended(
      (select string_agg(player_id::text,',' order by player_id) from public.game_players where game_id=p_game_id),
      6601
    ));
  end if;

  for change in select value from jsonb_array_elements(p_writes) loop
    table_name := change->>'table';
    operation := change->>'operation';
    if table_name not in ('turns','turn_actions','token_events','game_players','game_player_results','head_to_head_stats','rage_quits','player_feats')
      or operation not in ('insert','update','upsert','increment') then raise exception 'Invalid game move write'; end if;
    if table_name <> 'head_to_head_stats' and
      coalesce(change->'data'->>'game_id',change->'match'->>'game_id','') <> p_game_id::text then
      raise exception 'Move write must belong to the locked game';
    end if;
    if table_name = 'head_to_head_stats' and (
      not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'player_id')::uuid)
      or not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'opponent_id')::uuid)
    ) then raise exception 'Stats write must belong to this game'; end if;
    if table_name = 'player_feats' and (
      operation <> 'insert'
      or not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'player_id')::uuid)
    ) then raise exception 'Feat write must belong to a player in this game'; end if;
    if table_name = 'rage_quits' and (
      operation <> 'insert'
      or not exists(select 1 from public.game_players where game_id=p_game_id and player_id=(change->'data'->>'player_id')::uuid)
    ) then raise exception 'Rage quit must belong to a player in this game'; end if;
    select string_agg(format('%I',key),',') into fields from jsonb_object_keys(change->'data') key;
    if fields is null then raise exception 'Empty game move write'; end if;

    if operation='increment' or (table_name='head_to_head_stats' and operation='insert') then
      if table_name <> 'head_to_head_stats' then raise exception 'Invalid move increment'; end if;
      -- Per-game deltas, never pre-read aggregate totals. Supporting insert here
      -- also makes two older first-matchup plans safe during the rollout.
      select string_agg(case
        when key in ('player_id','opponent_id') then null
        when key='highest_score' then 'highest_score = greatest(target.highest_score,excluded.highest_score)'
        when key='average_score' then 'average_score = coalesce(round((target.total_score + excluded.total_score)::numeric / nullif(target.games_played - target.rage_quit_games + excluded.games_played - excluded.rage_quit_games,0),2),0)'
        when key='average_sucker_tokens_spent' then 'average_sucker_tokens_spent = coalesce(round((target.sucker_tokens_spent + excluded.sucker_tokens_spent)::numeric / nullif(target.games_played - target.rage_quit_games + excluded.games_played - excluded.rage_quit_games,0),2),0)'
        when key='average_sucker_tokens_leftover' then 'average_sucker_tokens_leftover = coalesce(round((target.sucker_tokens_leftover + excluded.sucker_tokens_leftover)::numeric / nullif(target.games_played - target.rage_quit_games + excluded.games_played - excluded.rage_quit_games,0),2),0)'
        else format('%1$I = target.%1$I + excluded.%1$I',key)
      end,',') into assignments from jsonb_object_keys(change->'data') key;
      execute format('insert into public.head_to_head_stats as target (%1$s)
        select %1$s from jsonb_populate_record(null::public.head_to_head_stats,$1)
        on conflict (player_id,opponent_id) do update set %2$s',fields,assignments) using change->'data';
    elsif operation='update' then
      if table_name not in ('turns','game_players','head_to_head_stats') then raise exception 'Invalid move update'; end if;
      select string_agg(format('%I = source.%I',key,key),',') into assignments from jsonb_object_keys(change->'data') key;
      select string_agg(format('target.%I is not distinct from filter.%I',key,key),' and ')
        into predicates from jsonb_object_keys(change->'match') key;
      if predicates is null then raise exception 'Move update requires a match'; end if;
      execute format('update public.%1$I target set %2$s from jsonb_populate_record(null::public.%1$I,$1) source,
        jsonb_populate_record(null::public.%1$I,$2) filter where %3$s',table_name,assignments,predicates)
        using change->'data',change->'match';
      get diagnostics affected_rows = row_count;
      if affected_rows <> 1 then raise exception 'Move update target is missing or ambiguous'; end if;
    elsif operation='insert' then
      execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1)',table_name,fields)
        using change->'data';
    else
      if table_name='game_player_results' then conflict_fields := 'game_id,player_id';
      elsif table_name='head_to_head_stats' then conflict_fields := 'player_id,opponent_id';
      else raise exception 'Invalid move upsert'; end if;
      select string_agg(format('%I = excluded.%I',key,key),',') into assignments from jsonb_object_keys(change->'data') key;
      execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1)
        on conflict (%3$s) do update set %4$s',table_name,fields,conflict_fields,assignments) using change->'data';
    end if;
  end loop;

  next_game := jsonb_populate_record(current_game,p_game_patch);
  update public.games set state=next_game.state,status=next_game.status,current_player_id=next_game.current_player_id,
    last_turn_id=next_game.last_turn_id,completed_at=next_game.completed_at,winner_id=next_game.winner_id
    where id=p_game_id returning * into next_game;
  move_response := jsonb_set(p_result,'{game}',to_jsonb(next_game));
  update public.game_action_requests set status='completed',http_status=200,response=move_response
    where actor_id=p_actor_id and request_id=p_request_id;
  return move_response;
end;
$$;
revoke all on function public.commit_game_move(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_game_move(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb) to service_role;
-- Every active-turn action uses the same version check and transaction.
create or replace function public.commit_game_mutation(
  target_game_id uuid,
  expected_updated_at timestamptz,
  next_game jsonb,
  player_updates jsonb,
  submitted_turn jsonb default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  current_game public.games;
begin
  select * into current_game from public.games where id = target_game_id for update;
  if not found or current_game.updated_at is distinct from expected_updated_at then
    return null;
  end if;

  if submitted_turn is not null then
    insert into public.turns (id, game_id, player_id, turn_index, category, dice, held, roll_count, score, status)
    values (
      (submitted_turn->>'id')::uuid, target_game_id, (submitted_turn->>'player_id')::uuid,
      (submitted_turn->>'turn_index')::integer, submitted_turn->>'category',
      array(select jsonb_array_elements_text(submitted_turn->'dice')::integer),
      array(select jsonb_array_elements_text(submitted_turn->'held')::boolean),
      (submitted_turn->>'roll_count')::integer, (submitted_turn->>'score')::integer,
      submitted_turn->>'status'
    );
  end if;

  update public.games set
    state = next_game->'state',
    status = next_game->>'status',
    current_player_id = (next_game->>'current_player_id')::uuid,
    last_turn_id = (next_game->>'last_turn_id')::uuid,
    winner_id = (next_game->>'winner_id')::uuid,
    completed_at = (next_game->>'completed_at')::timestamptz
  where id = target_game_id
  returning * into current_game;

  update public.game_players as player set
    final_score = synced.final_score,
    sucker_tokens = synced.sucker_tokens,
    upper_bonus_awarded = synced.upper_bonus_awarded
  from jsonb_to_recordset(player_updates) as synced(
    player_id uuid, final_score integer, sucker_tokens integer, upper_bonus_awarded boolean
  )
  where player.game_id = target_game_id and player.player_id = synced.player_id;

  return to_jsonb(current_game);
end;
$$;

revoke all on function public.commit_game_mutation(uuid, timestamptz, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_game_mutation(uuid, timestamptz, jsonb, jsonb, jsonb) to service_role;
create table public.computer_game_results (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  game_id text not null check (length(game_id) between 1 and 200),
  result jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key (profile_id,game_id)
);
alter table public.computer_game_results enable row level security;
create policy "Players can read their computer results" on public.computer_game_results
  for select to authenticated using (profile_id=auth.uid());
revoke all on public.computer_game_results from anon,authenticated;
grant select on public.computer_game_results to authenticated;
grant all on public.computer_game_results to service_role;

create or replace function public.record_computer_game_result_once(p_owner_id uuid,p_game_id text,p_result jsonb)
returns public.computer_stats language plpgsql security definer set search_path=public,pg_temp as $$
declare
  inserted_game text;
  stats public.computer_stats;
begin
  if auth.uid() is null or auth.uid() is distinct from p_owner_id then
    raise exception using errcode='42501',message='Computer result belongs to a different account';
  end if;
  insert into public.computer_game_results(profile_id,game_id,result)
    values(p_owner_id,p_game_id,p_result) on conflict (profile_id,game_id) do nothing
    returning game_id into inserted_game;
  if inserted_game is null then
    select * into stats from public.computer_stats where profile_id=p_owner_id;
    return stats;
  end if;
  select * into stats from public.record_computer_game_result(
    player_score => (p_result->>'player_score')::integer,
    computer_score => (p_result->>'computer_score')::integer,
    upper_bonus_awarded => (p_result->>'upper_bonus_awarded')::boolean,
    scored_sucker => (p_result->>'scored_sucker')::boolean,
    scored_three_of_a_kind => (p_result->>'scored_three_of_a_kind')::boolean,
    scored_four_of_a_kind => (p_result->>'scored_four_of_a_kind')::boolean,
    scored_full_house => (p_result->>'scored_full_house')::boolean,
    scored_small_straight => (p_result->>'scored_small_straight')::boolean,
    scored_large_straight => (p_result->>'scored_large_straight')::boolean,
    computer_upper_bonus_awarded => (p_result->>'computer_upper_bonus_awarded')::boolean,
    computer_scored_sucker => (p_result->>'computer_scored_sucker')::boolean,
    computer_scored_three_of_a_kind => (p_result->>'computer_scored_three_of_a_kind')::boolean,
    computer_scored_four_of_a_kind => (p_result->>'computer_scored_four_of_a_kind')::boolean,
    computer_scored_full_house => (p_result->>'computer_scored_full_house')::boolean,
    computer_scored_small_straight => (p_result->>'computer_scored_small_straight')::boolean,
    computer_scored_large_straight => (p_result->>'computer_scored_large_straight')::boolean,
    buzzer_beater_wins => (p_result->>'buzzer_beater_wins')::integer,
    comeback_wins => (p_result->>'comeback_wins')::integer,
    extra_rolls_used => (p_result->>'extra_rolls_used')::integer,
    mulligans_used => (p_result->>'mulligans_used')::integer,
    sucker_hunts => (p_result->>'sucker_hunts')::integer,
    sucker_hunt_misses => (p_result->>'sucker_hunt_misses')::integer,
    sucker_punches_landed => (p_result->>'sucker_punches_landed')::integer,
    sucker_punches_used => (p_result->>'sucker_punches_used')::integer,
    sucker_blockers_used => (p_result->>'sucker_blockers_used')::integer,
    sucker_tokens_spent => (p_result->>'sucker_tokens_spent')::integer,
    sucker_tokens_leftover => (p_result->>'sucker_tokens_leftover')::integer
  );
  return stats;
end;
$$;
revoke all on function public.record_computer_game_result_once(uuid,text,jsonb) from public,anon;
grant execute on function public.record_computer_game_result_once(uuid,text,jsonb) to authenticated,service_role;

-- Reminder history is shared across every game with the same recipient.
create index turn_actions_jab_recipient_created_idx
on public.turn_actions (actor_id, (payload ->> 'targetPlayerId'), created_at desc)
where action_type = 'nudge_turn';

-- Hiding the game that originated a Jab must not hide its cooldown.
create policy "Players can read their sent jabs"
on public.turn_actions for select
to authenticated
using (actor_id = (select auth.uid()) and action_type = 'nudge_turn');

create function public.enforce_jab_cooldown()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  recipient_id text := new.payload ->> 'targetPlayerId';
begin
  if recipient_id is null then
    raise exception 'A Jab must have a recipient.';
  end if;

  -- Serialize inserts for this sender/recipient, including different games
  -- and requests from multiple devices. The history check and insert share
  -- the same transaction, so only one request can claim the cooldown.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.actor_id::text || ':' || recipient_id, 0)
  );

  if exists (
    select 1 from public.turn_actions action
    where action.action_type = 'nudge_turn'
      and action.actor_id = new.actor_id
      and action.payload ->> 'targetPlayerId' = recipient_id
      and action.created_at > pg_catalog.clock_timestamp() - interval '8 hours'
  ) then
    raise exception 'You can jab this player again 8 hours after your last jab.';
  end if;

  new.created_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

revoke all on function public.enforce_jab_cooldown() from public, anon, authenticated;
grant execute on function public.enforce_jab_cooldown() to service_role;

create trigger enforce_jab_cooldown
before insert on public.turn_actions
for each row when (new.action_type = 'nudge_turn')
execute function public.enforce_jab_cooldown();

-- Community leaderboards and feats. See docs/community-leaderboards.md.
create index game_player_results_completed_at_idx
on public.game_player_results (completed_at desc);

create index game_player_results_pair_completed_idx
on public.game_player_results (player_id, opponent_id, completed_at desc);

create table public.player_standings (
  player_id uuid primary key references public.profiles(id) on delete cascade,
  rating numeric(7, 2) not null default 1200,
  rating_deviation numeric(6, 2) not null default 150,
  rated_at timestamptz,
  rated_games integer not null default 0,
  peak_rating numeric(7, 2) not null default 900,
  current_win_streak integer not null default 0,
  best_win_streak integer not null default 0,
  current_loss_streak integer not null default 0,
  updated_at timestamptz not null default now()
);


alter table public.player_standings enable row level security;
grant all on public.player_standings to service_role;

-- One row per feat occurrence. Feat keys are cataloged in shared/feats.ts.
create table public.player_feats (
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  feat_key text not null check (feat_key ~ '^[a-z0-9_]{1,40}$'),
  earned_at timestamptz not null default now(),
  primary key (game_id, player_id, feat_key)
);

create index player_feats_player_idx on public.player_feats (player_id, feat_key);
create index player_feats_key_idx on public.player_feats (feat_key, player_id);

alter table public.player_feats enable row level security;
grant all on public.player_feats to service_role;

-- Milestones are awarded once, as of the completing game, so a replay of
-- history awards them on the same game they were first reached.
create function public.award_milestone_feat(
  target_player_id uuid,
  target_feat_key text,
  target_game_id uuid,
  earned timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.player_feats (game_id, player_id, feat_key, earned_at)
  select target_game_id, target_player_id, target_feat_key, earned
  where not exists (
    select 1 from public.player_feats feat
    where feat.player_id = target_player_id and feat.feat_key = target_feat_key
  );
$$;

revoke all on function public.award_milestone_feat(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.award_milestone_feat(uuid, text, uuid, timestamptz) to service_role;

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
create function public.apply_completed_game_standings(target_game_id uuid)
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

revoke all on function public.apply_completed_game_standings(uuid) from public, anon, authenticated;
grant execute on function public.apply_completed_game_standings(uuid) to service_role;

-- commit_game_move writes game_player_results before it marks the game
-- complete, so the results are visible here in the same transaction.
create function public.apply_standings_on_game_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.apply_completed_game_standings(new.id);
  return new;
end;
$$;

revoke all on function public.apply_standings_on_game_complete() from public, anon, authenticated;

create trigger games_apply_standings_on_complete
after update of status on public.games
for each row
when (new.status = 'complete' and old.status is distinct from 'complete')
execute function public.apply_standings_on_game_complete();

-- get_leaderboard and get_player_rankings share one ranking so a profile never
-- disagrees with a board.
create function public.ranked_leaderboard(board text)
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

revoke all on function public.ranked_leaderboard(text) from public, anon, authenticated;
grant execute on function public.ranked_leaderboard(text) to service_role;

create function public.get_leaderboard(board text, max_rows integer default 25)
returns table (
  rank integer,
  player_id uuid,
  display_name text,
  username text,
  avatar_url text,
  value numeric,
  sample_size integer,
  is_me boolean
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
declare
  viewer uuid := auth.uid();
  row_limit integer := least(greatest(coalesce(max_rows, 25), 1), 100);
begin
  if viewer is null then
    raise exception 'You must be signed in to view leaderboards.' using errcode = '42501';
  end if;

  return query
  with positioned as (
    select ranked.*, row_number() over (order by ranked.rank, ranked.display_name, ranked.player_id) as position
    from public.ranked_leaderboard(board) ranked
  )
  select
    positioned.rank,
    positioned.player_id,
    positioned.display_name,
    positioned.username,
    positioned.avatar_url,
    positioned.value,
    positioned.sample_size,
    positioned.player_id = viewer
  from positioned
  where positioned.position <= row_limit or positioned.player_id = viewer
  order by positioned.position;
end;
$$;

revoke all on function public.get_leaderboard(text, integer) from public;
grant execute on function public.get_leaderboard(text, integer) to authenticated;

-- Hidden players appear on no board, so they have no rankings.
create function public.get_player_rankings(target_profile_id uuid)
returns table (
  board text,
  rank integer,
  value numeric,
  sample_size integer,
  ranked_players integer
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to view rankings.' using errcode = '42501';
  end if;

  return query
  select boards.board, ranked.rank, ranked.value, ranked.sample_size, ranked.ranked_players
  from unnest(array['rating', 'weekly_high_score', 'all_time_high_score', 'sharpshooter', 'win_streak'])
    with ordinality as boards(board, sort_order)
  cross join lateral (
    select entry.rank, entry.value, entry.sample_size, (count(*) over ())::integer as ranked_players, entry.player_id
    from public.ranked_leaderboard(boards.board) entry
  ) ranked
  where ranked.player_id = target_profile_id
  order by boards.sort_order;
end;
$$;

revoke all on function public.get_player_rankings(uuid) from public;
grant execute on function public.get_player_rankings(uuid) to authenticated;

create function public.get_player_card(target_profile_id uuid)
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

revoke all on function public.get_player_card(uuid) from public;
grant execute on function public.get_player_card(uuid) to authenticated;

-- Every feat anyone has earned, with how rare it is and the target's own count.
create function public.get_player_feats(target_profile_id uuid)
returns table (
  feat_key text,
  times_earned integer,
  first_earned_at timestamptz,
  last_earned_at timestamptz,
  earned_pct numeric
)
language plpgsql
security definer
set search_path = ''
stable
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to view feats.' using errcode = '42501';
  end if;

  return query
  with population as (
    select count(distinct r.player_id)::numeric as players from public.game_player_results r
  ),
  holders as (
    select feat.feat_key, count(distinct feat.player_id)::numeric as players
    from public.player_feats feat
    group by feat.feat_key
  ),
  mine as (
    select feat.feat_key, count(*)::integer as times, min(feat.earned_at) as first_at, max(feat.earned_at) as last_at
    from public.player_feats feat
    where feat.player_id = target_profile_id
    group by feat.feat_key
  )
  select
    holders.feat_key,
    coalesce(mine.times, 0),
    mine.first_at,
    mine.last_at,
    round(100 * holders.players / nullif(population.players, 0), 1)
  from holders
  cross join population
  left join mine on mine.feat_key = holders.feat_key
  order by holders.feat_key;
end;
$$;

revoke all on function public.get_player_feats(uuid) from public;
grant execute on function public.get_player_feats(uuid) to authenticated;
