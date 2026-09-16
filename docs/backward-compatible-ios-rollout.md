# Backward-compatible iOS rollout

Keep supported app versions working while replacements are reviewed and installed. Legacy Punch retirement is a separate release decision after adoption.

## Release hold for legacy Punch retirement

Do not merge or deploy the retirement change until all of the following are recorded in its PR:

- The replacement iOS version/build is available in the App Store and includes [PR #95](https://github.com/ejsmith/sucker/pull/95): it prepares the chance and sends `chanceProtocol: 'prepared'`. Verify the same protocol in every supported web, Android, and TestFlight release.
- Record the adoption source, observation period, remaining legacy usage, and the owner's agreed minimum supported version and retirement date. Availability alone is insufficient. This cleanup does not add version telemetry or invent an adoption threshold; collect that evidence before removing support.
- In staging, verify supported-client preparation, displayed odds, one-/two-/three-token costs, retries, and both opponents continuing an existing game. Verify an old client receives the update message without losing tokens.
- Verify a completed pre-upgrade request still recovers its recorded outcome when retried by the same actor with its original `requestId`, and a pending request that never committed does not apply a legacy throw after cutover.
- Record the compatible backend revision to restore if a supported release fails its device smoke test. Deploy the verified `game-action` only after the owner approves retirement. No database migration or chance/receipt deletion is needed by this cleanup.

## Rollout order

1. Deploy the compatible backend from PR #95, preceded by its required pending migrations. That stage accepts both App Store 1.1.0's direct throw and updated prepared throws. Smoke-test the installed app before releasing updated clients.
2. Prepare a new iOS app version/runtime for the native dependency and configuration changes since build 34. Verify it in TestFlight, then release it through the App Store. Do not publish the entire current client as an over-the-air update to runtime 1.1.0: native changes require a compatible binary/runtime. See [Expo's runtime compatibility guidance](https://docs.expo.dev/eas-update/runtime-versions/).
3. Keep the compatibility stage deployed throughout review and adoption. Old clients retain their three-token UI; new clients display discounted counterpunch prices and availability.
4. Satisfy the retirement hold above, then merge and deploy the cleanup. Keep backward compatibility for supported versions as an ongoing release policy.

## Behavior after retirement

- A new `sucker_punch` request without `chanceProtocol: 'prepared'` receives HTTP 400: `Update Sucker to the latest version to use Sucker Punch.` It creates no chance and applies no game move or token charge. This is a Punch protocol requirement, not a general app-version gate.
- A marked throw requires an existing saved chance. `prepare_sucker_punch` is the only action that can create a new chance, and generates it on the server. The displayed die only checks that the caller saw the saved odds; it never sets those odds. Merely supplying the marker cannot bypass preparation.
- Already-completed requests replay their durable results before protocol enforcement when retried by the same actor with the original `requestId`. Keep the optional marker in request parsing so old persisted requests can still reconcile. An older request without that ID cannot identify its receipt: it receives the update message without another charge, and the client must refresh the game to see the committed state. Uncommitted old requests receive the update message; stale processing requests retain the existing reconciliation behavior.
- Preserve existing saved chances, including any written during the compatibility period. Their origin was not recorded, so this cleanup cannot establish that every historical die was server-generated. It prevents new client-chosen chances while honoring odds already shown to players. Never wipe or silently reroll in-flight chances during deployment.
- Participant, responder, target-turn, token, atomic-commit, and retry protections continue to share the same implementation.

## Verification limits

Automated checks cover legacy rejection with and without a saved chance, completed legacy receipt replay, strict preparation, conflicting odds, concurrent throws, retries, and counterpunch costs. Browser checks verify that the supported client sends the marker and displays the saved chance. They supplement the required installed-device smoke test; they do not execute the App Store binary or verify native notification delivery.
