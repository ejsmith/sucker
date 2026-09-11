# Authoritative Punch deployment gate

PR #66 changes the client/server Punch protocol. A client first requests
`prepare_sucker_punch`, displays the persisted die, then sends `sucker_punch`.
An older installed client sends only the throw with a locally generated die.
The new server rejects that legacy throw without spending tokens. Conversely,
the old server cannot handle the new preparation request. The migration alone
does not provide compatibility in either direction.

Merging this code is not release clearance. Automatic GitHub Pages builds and
deployments are gated by the repository variable `SUCKER_PUNCH_PROTOCOL_READY`.
Leave it unset or false until a separately approved rollout meets these gates:

1. Resolve installed-client compatibility through a versioned backend route or
   an enforced minimum client version. Merely making a new app version available
   does not update every installed client. Do not replace the live game-action
   endpoint while incompatible clients can still reach it.
2. Apply the invitation privacy, persisted chance, atomic move, and notification
   delivery migrations before deploying their corresponding backend code.
3. Verify new-client preparation, throw, retry, token accounting, and notification
   delivery against that backend. Verify the supported older-client behavior on
   a device, including any required upgrade flow.
4. Approve the web/client release, set `SUCKER_PUNCH_PROTOCOL_READY=true`, and
   rerun the main Build workflow. Native builds and OTA updates remain manual.

Do not silently accept a client-selected chance or substitute a different die
after the user sees the odds. Either would undo the fairness/correctness fix.

## Notification recovery limits

The completed action response is the durable delivery payload. Normal completion
and retries of a completed request use the same delivery lease, so a lost commit
response can recover notifications without replaying the move. Successful delivery
is recorded; concurrent retries skip a live lease. Failed sends release it, and a
crashed worker's lease expires after five minutes for a later retry.

This is retry-driven recovery, not an autonomous notification outbox worker.
There is no guarantee of a retry after a client disappears. Push providers also
cannot guarantee exactly-once delivery: if a provider accepts a message but its
response is lost, or some recipients succeed before another fails, a retry may
produce duplicate notifications. Move/token/history writes remain idempotent.
