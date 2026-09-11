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

## Release boundary

Automatic web publishing is gated until the incompatible old/new Punch protocols
have an approved rollout. See [the rollout requirements](../../releases/authoritative-punch-rollout.md).
No hosted backend deployment, native build, or OTA update was performed.
