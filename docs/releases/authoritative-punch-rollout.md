# Authoritative Punch deployment gate

PR #66 changes the client/server Punch protocol. A client first requests
`prepare_sucker_punch`, displays the persisted die, then sends `sucker_punch`.
An older installed client sends only the throw with a locally generated die.
PR #95 supplies the compatibility stage for those clients. Updated clients mark
throws with `chanceProtocol: 'prepared'` and require an existing saved chance.
The retirement change rejects new unmarked throws. Hold it until the supported
iOS release is deployed and adoption meets the agreed support policy; follow the
[iOS rollout and retirement guide](../backward-compatible-ios-rollout.md).

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
3. Verify supported-client preparation, throw, retry, token accounting, and
   notification delivery against that backend. During compatibility, verify old
   and new opponents on devices. At retirement, verify old requests receive the
   update message and completed receipts still recover for the same actor and
   original `requestId` without another charge.
4. Approve the web/client release, set `SUCKER_PUNCH_PROTOCOL_READY=true`, and
   rerun the main Build workflow. Native builds and OTA updates remain manual.

The compatibility stage retains the old client's chance die. After retirement,
new chances originate only in server preparation; the marker alone cannot create
one. Historical chances retain their displayed odds, including those saved during
compatibility, and completed receipts remain replayable with the original
`requestId`. Requests without that ID cannot recover a receipt and receive the
update message without another charge; refresh the game to see its current state.

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
