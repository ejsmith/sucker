# Authoritative Punch deployment gate

PR #66 changes the client/server Punch protocol. A client first requests
`prepare_sucker_punch`, displays the persisted die, then sends `sucker_punch`.
An older installed client sends only the throw with a locally generated die.
The compatibility path accepts the older client's displayed die and saves it
before resolving the throw. Updated clients mark throws with
`chanceProtocol: 'prepared'` and require an existing saved chance. The old server
cannot handle the new preparation request, so deploy the compatible backend
before releasing updated clients. See the [iOS rollout guide](../backward-compatible-ios-rollout.md).

Merging this code is not release clearance. Automatic GitHub Pages builds and
deployments are gated by the repository variable `SUCKER_PUNCH_PROTOCOL_READY`.
Leave it unset or false until a separately approved rollout meets these gates:

1. Preserve both direct legacy throws and prepared throws during the iOS rollout.
   Merely making a new app version available does not update every installation.
   Keep legacy support until its retirement is supported by an agreed
   minimum-version policy and usage evidence.
2. Apply the invitation privacy, persisted chance, atomic move, notification
   delivery, and atomic matchup-stat migrations before deploying their
   corresponding backend code.
3. Verify new-client preparation, throw, retry, token accounting, and notification
   delivery against that backend. Verify the supported older-client behavior on
   a device, including playing with an updated opponent and recovering a retry.
4. Approve the web/client release, set `SUCKER_PUNCH_PROTOCOL_READY=true`, and
   rerun the main Build workflow. Native builds and OTA updates remain manual.

Legacy support deliberately retains production's existing trust in the old
client's chance die during migration. The protocol marker is not a security
boundary. Never substitute different odds after a player sees the chance; an
existing saved chance wins over either client's conflicting request.

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
