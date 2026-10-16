-- The view ran with its owner's rights, bypassing head_to_head_stats row-level
-- security: any user could read every pair's record, and because a simple view
-- is auto-updatable, rewrite it. Apply the caller's policies and allow reads only.
alter view public.head_to_head_stat_rates set (security_invoker = true);
revoke all on public.head_to_head_stat_rates from anon, authenticated;
grant select on public.head_to_head_stat_rates to authenticated;
