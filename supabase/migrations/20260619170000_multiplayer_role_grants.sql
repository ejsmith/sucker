grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to service_role;
grant all on all routines in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant all on all tables in schema public to authenticated;
grant all on all routines in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
