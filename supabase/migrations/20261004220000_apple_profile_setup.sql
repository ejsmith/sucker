-- Existing players, including accounts that later link Apple, keep their profiles.
alter table public.profiles
  add column needs_profile_setup boolean not null default false;

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
