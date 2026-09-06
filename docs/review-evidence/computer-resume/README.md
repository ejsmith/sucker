# Computer-game resume

CI follow-up: save hydration delayed the board mount and exposed a lost development viewport query during navigation. The asymmetric fixture reproduced 0 px left inset instead of 12 (`geometry-before.png`). The lobby route now carries the existing development viewport/preset parameters explicitly. Chromium and mobile WebKit geometry checks pass, and the same fixture measures x=12, y=59, width=377, height=759 (`geometry-after.png`).

The deterministic screenshot RNG now resets at the Roll click to retain the existing 5/1/2/3/4 dice fixture regardless of startup calls. The iPhone 16 dice snapshot passes. The local Mac still differs slightly from some stored pixel baselines; the iPhone Mini difference also reproduces on the branch without computer resume. Those snapshots were not regenerated to conceal the environment difference; CI validates the canonical rendering environment.

The local app was inspected at 393 × 852 with guest computer play.

Before: scored 16 in Chance (`progress-before.png`), returned to the lobby,
and reopened Play Computer. The board reset to zero (`before.png`).

After: played to 13–30 (`progress-after.png`), returned to the lobby, chose
Resume Computer Game, then refreshed the page. Both scores remain (`after.png`).
New-game replacement is available explicitly from the game menu with confirmation.

Versioned saves retain dice, holds, purchased rolls, tokens, both scorecards,
pending response opportunities, statistics event history, and recorded-result IDs.
Guest and authenticated accounts use separate storage keys. Save writes are
serialized, and the lobby exit waits for the latest write. Incompatible/corrupt
saves require retry or explicit replacement instead of silent reset.

Validation: four save-format unit regressions and three browser regressions
cover corruption, tokens/dice/holds/rolls, navigation, refresh, scorecards,
and cancel/confirm New Game. Native process termination has not been tested;
the implementation uses the existing cross-platform AsyncStorage dependency.
# Review follow-up: completed games

Reviewer feedback identified that the lobby said Play Computer while the route reopened a completed save. The new browser regression failed on the original PR with a disabled Roll button and the previous game-over overlay (`completed-before.png`). The route now treats completed sessions as absent; the same entry starts a fresh board (`completed-after.png`). All four save/resume browser scenarios pass, including reload of the new game.
