# Explicit turn context

The player strip used color to indicate the active player, and the game menu offered no persistent last-turn explanation ([before](before.png)).

The existing token line now also says Your turn or Their turn for the active player; the scorecard geometry remains unchanged. A Last Turn menu entry opens an optional summary with the player, category, points, and the current turn/roll count ([after](after.png), [summary](summary-after.png)). Removed scores are identified as Punch/Mulligan removals. Missing remote details are reported as unavailable instead of showing a stale turn. Closing the dialog returns focus and preserves held dice and rolls.

Four dedicated local browser cases passed, including three phone viewports, modal focus, unchanged board bounds, and a completed computer turn followed by a held-die/roll preservation check. The existing two-player flow passed with assertions on a match opened from its notification. Three existing phone scoring/menu/overlay cases passed. Both typechecks, 88 app tests, 11 Edge tests, lint, and whitespace checks passed. Kept intentional player-strip/menu snapshots; discarded unrelated stats-overlay raster differences. Native accessibility and large-text behavior remain unverified.
