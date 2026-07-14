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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_id, request_id)
);

create index game_action_requests_actor_created_idx
on public.game_action_requests (actor_id, created_at desc);

create trigger game_action_requests_touch_updated_at
before update on public.game_action_requests
for each row execute function public.touch_updated_at();

alter table public.game_action_requests enable row level security;

-- Requests are internal Edge Function state. Authenticated clients must go
-- through game-action; the service role bypasses RLS for claims/completions.
grant all on table public.game_action_requests to service_role;
revoke all on table public.game_action_requests from anon, authenticated;

-- web_push_subscriptions was added after the baseline grants, so explicitly
-- grant its RLS-protected client access and service-role notification access.
grant select, insert, update, delete on table public.web_push_subscriptions to authenticated;
grant all on table public.web_push_subscriptions to service_role;
