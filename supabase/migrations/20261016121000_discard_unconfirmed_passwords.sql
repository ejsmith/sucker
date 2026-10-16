-- Players only add a password after signing in. A password present when an
-- email is confirmed by a later request was chosen before anyone proved they
-- own the address, such as by an attacker calling signUp with someone else's
-- email. Discard it so the owner's email-code sign-in cannot inherit an
-- attacker's credentials. Admin creation and auto-confirmed sign-up confirm in
-- the inserting transaction, so their passwords are kept.
create function public.discard_unconfirmed_password()
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

revoke all on function public.discard_unconfirmed_password() from public, anon, authenticated;

create trigger on_auth_user_inserted_track_confirmation
before insert on auth.users
for each row execute function public.discard_unconfirmed_password();

create trigger on_auth_user_email_confirmed
before update of email_confirmed_at on auth.users
for each row execute function public.discard_unconfirmed_password();
