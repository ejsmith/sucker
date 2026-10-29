-- A device's push destination belongs to whoever is signed in on it now. When a
-- previous account never signed out (expired session, cleared site data), its
-- row still owns the token or endpoint, and an upsert from the new account is
-- an UPDATE of someone else's row that RLS rejects. Let the caller claim it.
create function public.claim_push_token(
  push_token text,
  push_platform text,
  push_device_name text default null
)
returns public.push_tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  claimed public.push_tokens;
begin
  if caller_id is null then
    raise exception 'You must be signed in to register notifications.' using errcode = '42501';
  end if;

  insert into public.push_tokens (profile_id, expo_push_token, platform, device_name)
  values (caller_id, push_token, push_platform, push_device_name)
  on conflict (expo_push_token) do update
  set profile_id = excluded.profile_id,
    platform = excluded.platform,
    device_name = excluded.device_name
  returning * into claimed;

  return claimed;
end;
$$;

revoke all on function public.claim_push_token(text, text, text) from public, anon;
grant execute on function public.claim_push_token(text, text, text) to authenticated;

create function public.claim_web_push_subscription(
  push_endpoint text,
  push_p256dh_key text,
  push_auth_key text,
  push_expiration_time timestamptz default null,
  push_user_agent text default null
)
returns public.web_push_subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  claimed public.web_push_subscriptions;
begin
  if caller_id is null then
    raise exception 'You must be signed in to register notifications.' using errcode = '42501';
  end if;

  insert into public.web_push_subscriptions (profile_id, endpoint, p256dh_key, auth_key, expiration_time, user_agent)
  values (caller_id, push_endpoint, push_p256dh_key, push_auth_key, push_expiration_time, push_user_agent)
  on conflict (endpoint) do update
  set profile_id = excluded.profile_id,
    p256dh_key = excluded.p256dh_key,
    auth_key = excluded.auth_key,
    expiration_time = excluded.expiration_time,
    user_agent = excluded.user_agent
  returning * into claimed;

  return claimed;
end;
$$;

revoke all on function public.claim_web_push_subscription(text, text, text, timestamptz, text) from public, anon;
grant execute on function public.claim_web_push_subscription(text, text, text, timestamptz, text) to authenticated;
