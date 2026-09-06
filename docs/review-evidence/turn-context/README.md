# Explicit turn context

The player strip used color to indicate the active player, and the game menu offered no persistent last-turn explanation ([before](before.png)).

The existing token line now also says Your turn or Their turn for the active player; the scorecard geometry remains unchanged. A Last Turn menu entry opens an optional summary with the player, category, points, and the current turn/roll count ([after](after.png), [summary](summary-after.png)). Removed scores are identified as Punch/Mulligan removals. Missing remote details are reported as unavailable instead of showing a stale turn. Closing the dialog returns focus and preserves held dice and rolls.

Four dedicated local browser cases passed, including three phone viewports, modal focus, unchanged board bounds, and a completed computer turn followed by a held-die/roll preservation check. The existing two-player flow passed with assertions on a match opened from its notification. Three existing phone scoring/menu/overlay cases passed. Both typechecks, 88 app tests, 11 Edge tests, lint, and whitespace checks passed. Kept intentional player-strip/menu snapshots; discarded unrelated stats-overlay raster differences. Native accessibility and large-text behavior remain unverified.

Review follow-up: a real local multiplayer Punch removed a score but the open summary retained its old submitted status ([before](punch-before.png)). Refreshing the turn row when the game's response status changes fixes the unchanged-ID cache ([after](punch-after.png)). That backend-to-open-dialog regression and the four original local cases pass, as do typecheck, lint, and whitespace checks. Inspected four initial CI image comparisons and adopted their canonical captures. The phone visual scenarios now collect all snapshot differences in one run using soft assertions; every mismatch still fails the test.

Second review follow-up:

- Scratch summaries incorrectly said “played … for 0 points” ([before](scratch-before.png), [after](scratch-after.png)). Local human/computer turn metadata now preserves scratch actions, and remote details read the matching scratch action record. Local and remote regressions pass.
- Separate game/action/turn writes reproduced a stale removal summary ([before](delayed-before.png), [after](delayed-after.png)). Turn rows now have a dedicated subscription, backed by an additive Realtime publication migration and unchanged participant RLS. The existing polling and foreground-refresh paths also refresh turn details. Local verification exercised the real polling fallback; the standard CI stack also disables Realtime. No hosted migration was applied.

The delayed-write fixture explicitly updates the game, then the action, then the turn row, matching the legacy server's possible ordering. A real Punch endpoint regression, local scratch, remote scratch, three geometry/focus cases, and computer-history/held-die preservation all passed across the focused runs. Both typechecks, 88 app tests, 11 Edge tests, lint, and whitespace checks passed. Four additional intentional Linux CI captures were inspected and adopted.
