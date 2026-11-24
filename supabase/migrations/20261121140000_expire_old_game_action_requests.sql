-- game_action_requests keeps each action's full response so a retried request
-- returns the same result. Clients give up on a pending action after five
-- minutes, so week-old rows are never read again; they made up nearly all of
-- the table's 147 MB. Delete them in batches every hour.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.delete_old_game_action_requests(max_rows integer default 20000)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted integer;
begin
  delete from public.game_action_requests
  where ctid in (
    select ctid
    from public.game_action_requests
    where created_at < now() - interval '7 days'
      and status = 'completed'
    limit max_rows
  );
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke all on function public.delete_old_game_action_requests(integer) from public, anon, authenticated;
grant execute on function public.delete_old_game_action_requests(integer) to service_role;

select cron.schedule(
  'delete-old-game-action-requests',
  '17 * * * *',
  $$select public.delete_old_game_action_requests()$$
);
