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
# Review follow-up: failed auth sign-out

A local browser test forces the auth logout endpoint to return 503 after the notification row is deleted. Before this follow-up, the account remained signed in but its endpoint had no database owner. The regression failed against the real local database. Provider unsubscription/token-cache removal is now deferred until auth succeeds, and a failed auth request restores ownership before reporting the error. Connectivity and foreground recovery retry registration if that restoration also fails. Five browser cases pass, including auth failure followed by a successful retry. `auth-before.png` and `auth-after.png` show the app state; the database assertions are documented by the test output because ownership is not visible in the profile UI.
# Legacy native permission follow-up

The actual cleanup module, run with a legacy installation fixture and denied permission, called sign-out without discovering or deleting the token. Cleanup now uses the existing token getter regardless of display authorization, without requesting permission. The regression verifies discovery, owner-and-token-scoped deletion, sign-out, and local identifier cleanup in that order. `legacy-before.png` and `legacy-after.png` contain the test output. Platform and database boundaries are mocked in this check; physical-device delivery remains unverified. The installed SDK 57 token getter and [versioned notification API documentation](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/) were inspected; the getter does not call the permission prompt.
