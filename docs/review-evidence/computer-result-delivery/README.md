# Computer results survive failed delivery

A signed-in local player finished a 15–0 game while the result endpoint returned a controlled 503. After restoring the endpoint and reloading, no result was recorded and the stats screen still said “No saved stats yet.” The old effect marked the game recorded before the request succeeded and had no durable retry queue. [Completed game](completed-before.png), [missing result after recovery](before.png).

Results now enter an account-specific AsyncStorage queue before upload. Startup, authentication, reconnection, foregrounding, and a foreground retry interval flush that queue. Items leave only after a successful acknowledgement. A completed saved game is queued before the route replaces it with a fresh board, covering interruption between completion and delivery.

The new authenticated database RPC uses a unique `(profile_id, game_id)` receipt in the same transaction as the statistics increment. Concurrent retries and a lost acknowledgement count once. The RPC verifies the queued owner against the authenticated user, preventing account-switch misattribution. Existing clients can continue using the old RPC; only the updated client gains durable/idempotent delivery. Already-lost results from the old implementation cannot reliably be reconstructed or distinguished from previously delivered ones.

[After recovery](after.png): one recorded game, one win, and 15 average/high score. The current-game 0–0 at the top belongs to the newly opened game.

Validation against isolated local Supabase on port 55421:

- Two browser cases passed: a rejected upload and an upload whose server acknowledgement was lost. Both retry after reload, clear their queue after acknowledgement, and retain exactly one counted game.
- 17 integration tests passed, including concurrent/repeated RPC delivery, altered retry payload, cross-account rejection, receipt privacy, and direct receipt-write denial.
- 92 app tests, 11 Edge tests, both typechecks, and lint passed.

No hosted deployment or native build was performed. This PR builds on the computer-game resume PR.
