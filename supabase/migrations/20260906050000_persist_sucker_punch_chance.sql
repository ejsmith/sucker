-- One server-generated chance die per player/target turn, retained across retries.
create table public.sucker_punch_attempts (
  game_id uuid not null references public.games(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  turn_id uuid not null references public.turns(id) on delete cascade,
  chance_die integer not null check (chance_die between 1 and 6),
  created_at timestamptz not null default now(),
  primary key (game_id, actor_id, turn_id)
);

alter table public.sucker_punch_attempts enable row level security;
-- Only the service role may create or read attempts through game-action.
revoke all on public.sucker_punch_attempts from anon, authenticated;
grant all on public.sucker_punch_attempts to service_role;
