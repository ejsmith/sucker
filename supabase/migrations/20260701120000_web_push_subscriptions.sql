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

create trigger web_push_subscriptions_touch_updated_at
before update on public.web_push_subscriptions
for each row execute function public.touch_updated_at();

alter table public.web_push_subscriptions enable row level security;

create policy "Users manage their own web push subscriptions"
on public.web_push_subscriptions for all
to authenticated
using ((select auth.uid()) = profile_id)
with check ((select auth.uid()) = profile_id);
