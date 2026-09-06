# Notification ownership on sign-out

Baseline: `715c7ec`. The Playwright regression uses the actual Expo web app,
real local Supabase authentication and subscription rows, and a simulated browser
push provider. It does not send notifications.

Before: sign-out succeeds while the endpoint still belongs to Alice. The screenshot
shows the failing assertion against the retained database row.

After: sign-out removes only this browser's endpoint, retains Alice's other device,
and Bob can register the released endpoint under normal RLS. A second test injects
a cleanup failure, verifies that Alice stays signed in with an error, then retries.

The app serializes registration and sign-out cleanup to avoid an in-flight
registration recreating the old endpoint. Native cleanup saves the current Expo
push identifier and removes that device's row while still authenticated. Older
installs with granted permission can discover their identifier without prompting.
Sign-out is local to this installation so other devices retain their sessions.

Screenshots are reports of actual browser test output. Native push delivery and
account switching on a physical phone have not been verified; no native build was run.

## Review follow-up

The reviewer identified that a false/rejected browser unsubscribe response could
block sign-out after server ownership was already removed. The new regression
reproduced the stuck session (`unsubscribe-before.png`). Browser provider cleanup
is now best-effort after the database deletion succeeds; all four browser cases
pass (`unsubscribe-after.png`), including false/rejected unsubscribe and retry
after a database deletion failure.
