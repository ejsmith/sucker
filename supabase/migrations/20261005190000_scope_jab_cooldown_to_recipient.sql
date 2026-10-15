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
