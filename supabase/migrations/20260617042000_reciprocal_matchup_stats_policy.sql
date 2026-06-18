create policy "Users can read reciprocal matchup stats"
on public.head_to_head_stats for select
to authenticated
using ((select auth.uid()) = opponent_id);
