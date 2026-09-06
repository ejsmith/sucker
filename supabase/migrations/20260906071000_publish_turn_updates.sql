-- Participants already have read access through RLS; publish updates so clients
-- can observe removals even when they follow the associated game update.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'turns'
  ) then
    alter publication supabase_realtime add table public.turns;
  end if;
end $$;
