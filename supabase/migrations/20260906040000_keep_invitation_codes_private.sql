-- Open invitations are redeemed through game-action, which validates the
-- supplied code. An unassigned recipient must not make that code enumerable.
drop policy "Relevant users can read invites" on public.game_invites;

create policy "Relevant users can read invites"
on public.game_invites for select
to authenticated
using ((select auth.uid()) in (inviter_id, invitee_id));
