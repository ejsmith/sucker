# PR #66 merge verification — September 11

Updated with main through `dc330ec` using a merge so the dependent review PRs keep
their shared ancestry.

## Lost-response notification recovery

The integration reproduction seeds the exact completed request state left by a
successful atomic move whose response was lost before notification dispatch. It
then retries that request through the real local Edge Function. On the baseline,
delivery remains pending and the regression fails. With the fix, delivery finishes
without another move/history write. Four concurrent delivery attempts call the
sender once; a failed sender releases its lease for a successful retry.

- [Before: actual regression output](notifications-before.png)
- [After: same regression passes](notifications-after.png)

These are rendered test-output screenshots, not screenshots of a device receiving
a push. The integration test uses test accounts without registered push endpoints;
the delivery concurrency/failure checks inject a sender callback while exercising
real PostgreSQL claim updates. External Expo/APNs/web push delivery is not verified.

Both runs use the disposable `sucker_review` database on port 55421, the same
additive delivery migration, and `per_worker` mode. The normal local database is
not reset or changed. The full updated integration suite passes all 26 tests.

Supabase's default local `oneshot` policy cancels background work when the response
finishes. Local configuration now uses the documented [per-worker mode for
background tasks](https://supabase.com/docs/guides/functions/background-tasks).
Restart the local Edge Function server after source edits in this mode.

## Reconnect recovery

Preparation-only recovery and realtime subscription now fetch current game state.
The refresh helper rejects stale results after a newer realtime event, a later
refresh, or navigation. Three new local regression tests cover current-state
refresh, a realtime update winning a race, and cleanup after navigation. Existing
preparation-snapshot exclusion remains intact. This is helper-level race coverage;
the previously unverified live Realtime offline scenario is not claimed as an
end-to-end reproduction.

### Review follow-up: overlapping initial loads

The next review identified a flaw in the new refresh guard: starting a redundant
subscription fetch invalidated the initial request even if the replacement
failed. The local helper regression reproduced a discarded successful result
(`undefined` instead of version 7). Refresh requests now supersede older requests
only after successfully returning; realtime events and accepted actions still
invalidate outstanding snapshots immediately. All five refresh tests pass.

- [Before: successful initial load discarded](refresh-before.png)
- [After: failed replacement preserves it](refresh-after.png)

These are actual helper-test output screenshots, not a browser network capture.

### Review follow-up: failed fetch after preparation recovery

The subsequent review found that consuming recovery before a replacement fetch
succeeded removed the retry signal. The existing consume-before-fetch order was
extracted into the helper regression to reproduce this failure. Recovery now
stays pending and keeps move controls busy until a current snapshot is fetched;
failures show a retry message and retry every 2.5 seconds while the app is active.
Navigation or backgrounding cancels outstanding retries. The eight refresh and
recovery tests cover failure retention, successful retry, and cancellation.

- [Before: recovery consumed before its fetch](recovery-retry-before.png)
- [After: recovery retained until successful retry](recovery-retry-after.png)

These are actual helper regression results, not a live Realtime reproduction.

### Review follow-up: concurrent first-matchup completions

A fresh disposable stack, `sucker_pr66_merge` on ports 56421/56422, was created
from this PR's migrations to exclude schema left by other review branches. Two
independently prepared first-matchup inserts were submitted through the real
`commit_game_move` RPC. The baseline failed with PostgreSQL `23505` on
`head_to_head_stats_pkey`. After the correction both commits succeed, both games
contribute to totals and averages, and replay does not increment them again.

The Edge Function now supplies each game's stat contributions instead of reading
and replacing aggregate totals. The transaction adds those contributions with
an atomic upsert and locks the player pair before either aggregate row, avoiding
opposite-seat lock ordering. The migration also accepts older first-insert plans.

- [Before: concurrent insert collision](stats-before.png)
- [After: both completions counted once](stats-after.png)

These screenshots show actual local RPC regression output. They do not depict
two browser users completing games. The clean stack also runs the normal
end-to-end game-completion and rematch integration cases against the new planner.

### Review follow-up: authenticated profile during competing game loads

The inverse race was reproduced in the actual web app: a successful reconnect
fetch and failed initial fetch left the screen on `Loading Game`, because profile
state was assigned only after the initial fetch succeeded. Authentication now
sets profile state independently, and the board renders as soon as a profile and
game snapshot are available. A redundant pending request no longer blocks it.

The browser regression controls HTTP failures and the Supabase WebSocket join
handshake, including automatic HTTP retries. Both success/failure orderings pass
in Chromium and iPhone WebKit at 393 x 852 (four cases). Authentication and server
responses are mocked; this verifies the real screen under controlled network
ordering, not a production reconnect or physical device.

- [Before: game remains on the loading screen](profile-before.png)
- [After: recovered snapshot opens the playable board](profile-after.png)

The separate computer-result upload retention finding is tracked by PR #75,
which adds an account-scoped retry queue and idempotent recording. It is not
included in this PR.

## Release boundary

Automatic web publishing is gated until the incompatible old/new Punch protocols
have an approved rollout. See [the rollout requirements](../../releases/authoritative-punch-rollout.md).
No hosted backend deployment, native build, or OTA update was performed.
