create unique index turn_actions_one_taunt_per_turn
on public.turn_actions (
  game_id,
  actor_id,
  coalesce(turn_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
where action_type = 'taunt';

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'turn_actions'
  ) then
    alter publication supabase_realtime add table public.turn_actions;
  end if;
end $$;
