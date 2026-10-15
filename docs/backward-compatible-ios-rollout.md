# Backward-compatible iOS rollout

Keep App Store 1.1.0 working while the replacement iOS version is reviewed and installed.

## Punch protocols

- App Store 1.1.0 sends `sucker_punch` with its locally displayed `chanceDie` and no preparation request. Accept and save that chance before resolving the outcome. Retain the historical server-generated fallback when an older request omits the optional die.
- Updated clients first call `prepare_sucker_punch`, then throw with `chanceProtocol: 'prepared'`. Reject a marked throw without a saved chance. Both protocols use the first saved chance; reject a conflicting displayed die before charging tokens.
- Validate participation, current responder, target turn, die range, and token balance for either protocol. Commit the game, token charge, history, and retry receipt together.
- Supporting legacy requests temporarily retains the existing production trust in the old client's chance die. The protocol marker selects behavior; it is not proof that a client is trusted or a security boundary.

Old and updated players can share a game. The old app still displays a fixed three-token Punch price and cannot expose discounted counterpunches when the player has fewer than three tokens. The server applies the current cost to an accepted action. Updated clients display the discounted price and availability. Other client-side improvements, including selecting a Sucker Deal before rolling, require the updated app too.

## Release order

1. Merge the compatibility fix and pass app, Edge, database, and browser checks, including legacy requests, prepared requests, mixed-version games, and retries.
2. Apply the pending database migrations and compatible Edge Functions in a staging backend. Test App Store 1.1.0's client and the release candidate against that backend, covering sign-in, invites, turns, Punch, Mulligan, scoring, notifications, and reconnect/retry behavior. Then deploy the verified migrations followed by the compatible Edge Functions to production and smoke-test the installed App Store app.
3. Prepare a new iOS app version/runtime for the native dependency and configuration changes since build 34. Build and verify it in TestFlight, then submit it for App Store review. Do not publish the entire current client as an over-the-air update to runtime 1.1.0: native changes require their own compatible binary/runtime. See [Expo's runtime compatibility guidance](https://docs.expo.dev/eas-update/runtime-versions/).
4. Keep legacy backend support throughout review and adoption. App Store approval or availability does not mean existing installations have updated. Retire legacy support only under a separately agreed minimum-version policy with usage evidence.

No production deployment, native build, or app update accompanies this compatibility change.

## Verification limits

Automated mixed-version tests replay the request shapes used by App Store build 34 and the current client against one isolated backend. They cover both successful and missed legacy Punches, one-time token charges after retry, server preparation, conflicting odds, concurrent requests, and continuing a turn after the other version lands a Punch. The current browser regression verifies that the new client sends the prepared-protocol marker and displays the returned chance.

These tests supplement the installed-device check; they do not execute the App Store binary or verify native notification delivery.
