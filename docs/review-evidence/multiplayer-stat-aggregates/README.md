# Multiplayer statistics count every completed game

The previous Edge implementation read a matchup total, incremented it in memory, and queued an absolute database update. Two different games could prepare from the same value and overwrite each other's increment even though each game's move was atomic.

## Local reproduction

The isolated local Supabase database used two new test accounts and two games. Both prepared completion transactions read `games_played = 0`. Each transaction inserted its own unique game result and sent the same absolute matchup count, exactly as older Edge workers do. Both calls to the actual `commit_game_move` database RPC returned HTTP 200. Two results were saved, but the matchup reported one game and 15 points rather than two games and 30 points.

The ordinary local HTTP worker serialized the earlier requests and did not reproduce this race. The regression deliberately prepares both database transactions before committing either, so it tests the overlapping-worker condition deterministically. A temporary half-second trigger delay widened overlap; it was removed in a `finally` block. Screenshots are browser-rendered verification reports containing actual command output, not app screens.

- [Before screenshot](before.png), [before output](before.txt)
- [After screenshot](after.png), [after output](after.txt)

## Change

Completion takes a transaction-scoped lock for the unordered player pair before writing results. Both directional aggregates are then rebuilt from uniquely keyed `game_player_results` in that same transaction. Replayed requests return their stored response without inserting or counting results again. The migration repairs existing pairs from available results.

The Edge worker now queues only result rows. The database ignores legacy absolute aggregate instructions accompanying those results, allowing the migration to precede deployment of the updated Edge worker. The existing statistics tables, views, and client API remain compatible. No hosted deployment was performed.

## Validation

- Deterministic local reproduction now returns two successful commits, two results, two games, and 30 points.
- 19 Supabase integration tests passed, including simultaneous completions, both player directions, token/score averages, action counts, and replay without duplicate counting.
- 88 app tests and 11 Edge tests passed; app/Edge typechecks and lint passed.

This PR builds on the atomic-move PR. It changes multiplayer aggregation only; durable computer-result delivery is a separate review item.
