-- Run against an empty, disposable PostgreSQL database. The migration under test
-- is included below; auth.users contains only the fields read by its trigger.
begin;
create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb
);
create table public.profiles (
  id uuid primary key references auth.users(id),
  display_name text not null,
  username text unique,
  constraint username_length check (username is null or char_length(username) between 3 and 24),
  constraint username_format check (username is null or username ~ '^[a-zA-Z0-9_]+$')
);
insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-4000-8000-000000000001', 'existing@example.test', '{"provider":"email"}'),
  ('00000000-0000-4000-8000-000000000002', 'old@privaterelay.appleid.com', '{"provider":"apple"}');
insert into public.profiles (id, display_name, username) values
  ('00000000-0000-4000-8000-000000000001', 'Existing Email Player', 'taken_name'),
  ('00000000-0000-4000-8000-000000000002', 'Existing Apple Player', null);

\ir ../migrations/20261004220000_apple_profile_setup.sql

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000003', 'randomrelay@privaterelay.appleid.com', '{"provider":"apple"}', '{}'),
  ('00000000-0000-4000-8000-000000000004', 'real.name@example.test', '{"provider":"apple"}', '{"display_name":"Apple metadata"}'),
  ('00000000-0000-4000-8000-000000000005', 'email.player@example.test', '{"provider":"email"}', '{}'),
  ('00000000-0000-4000-8000-000000000006', 'email.name@example.test', '{"provider":"email"}', '{"display_name":"Chosen Name"}');

do $$
begin
  assert (select count(*) = 2 from public.profiles where needs_profile_setup), 'Only new Apple signups need setup';
  assert (select bool_and(display_name = 'Player' and username is null) from public.profiles where needs_profile_setup),
    'New Apple players must not publish email prefixes or receive usernames';
  assert (select display_name = 'Existing Apple Player' and not needs_profile_setup from public.profiles where id = '00000000-0000-4000-8000-000000000002'),
    'Migration must preserve existing Apple profiles';
  assert (select display_name = 'email.player' and not needs_profile_setup from public.profiles where id = '00000000-0000-4000-8000-000000000005'),
    'Email signup behavior must be preserved';
  assert (select display_name = 'Chosen Name' and not needs_profile_setup from public.profiles where id = '00000000-0000-4000-8000-000000000006'),
    'Existing supplied names must be preserved for email signup';
end;
$$;

-- Adding an Apple identity updates the auth user rather than inserting a new one.
update auth.users set raw_app_meta_data = '{"provider":"email","providers":["email","apple"]}'
where id = '00000000-0000-4000-8000-000000000001';
do $$
begin
  assert (select display_name = 'Existing Email Player' and username = 'taken_name' and not needs_profile_setup
    from public.profiles where id = '00000000-0000-4000-8000-000000000001'), 'Linking must preserve the existing profile';
  begin
    update public.profiles set display_name = 'Alex', username = 'taken_name', needs_profile_setup = false
    where id = '00000000-0000-4000-8000-000000000003';
    raise exception 'Expected a username conflict';
  exception when unique_violation then
    null;
  end;
  assert (select needs_profile_setup and display_name = 'Player' from public.profiles where id = '00000000-0000-4000-8000-000000000003'),
    'A failed save must not complete setup';
end;
$$;
update public.profiles set display_name = 'Lucky Roller', username = null, needs_profile_setup = false
where id = '00000000-0000-4000-8000-000000000003';
update public.profiles set display_name = 'Alex', username = 'alex_rolls', needs_profile_setup = false
where id = '00000000-0000-4000-8000-000000000004';
do $$
begin
  assert not exists (select 1 from public.profiles where needs_profile_setup), 'Both completed setups must remain complete';
  assert (select display_name = 'Lucky Roller' and username is null from public.profiles where id = '00000000-0000-4000-8000-000000000003'),
    'Username must remain optional';
end;
$$;
rollback;
