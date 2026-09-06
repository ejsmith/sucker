# Atomic multiplayer moves

Before: a temporary trigger on the isolated local database rejected the `score_category` action-history insert for one fixture game. The API returned an error, but Chance changed from empty to 5, a turn row remained, and play advanced to the opponent. `before.log` and `before.png` show the actual failure. The trigger was removed after the probe.

After: the identical fault leaves Chance empty, the same player active, and both histories unchanged (`after.log`, `after.png`). Move preparation now queues child writes. A service-only database function locks the game, checks its original update timestamp, and commits the game, turn, token ledger, player totals, completion records, and replayable request response together. Stale prepared moves return a conflict. Transport failures retain the existing request-recovery path.

Coverage: Roll, Extra Roll, scoring, Sucker Deal, Pass, Mulligan, and the resolved Sucker Punch use this boundary. Chance preparation retains its separate idempotent saved die. Invitations, game creation, list management, nudges, and taunts keep their existing endpoints. Cross-game head-to-head aggregation concurrency remains a separate review item; this change makes each individual move's writes atomic.

Validation: the fault-injection probe, 18 Supabase integration cases, 88 app tests, 11 Edge tests, typechecks, and lint. The new transaction test rejects authenticated direct RPC access, rolls back a valid earlier child insert when a later child violates a constraint, accepts only one of two simultaneous preparations from the same version, and replays the winning response without another ledger entry. JSON object assertions compare keys independently of serialization order.

Apply the migration before deploying the Edge Function. No hosted deployment was performed. This PR builds on the authoritative punch-chance PR.
