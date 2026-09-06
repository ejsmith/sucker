# Token availability and Punch explanation

At the start of a local game, Punch was disabled while its description only said what the action does ([before](before.png)). After the computer scored, the chance dialog did not identify the targeted category/score, cost timing, or odds mapping ([before](punch-before.png)).

The token menu now explains Punch timing, insufficient balances, and the current computer-only Mulligan UI ([after](after.png)). The Punch dialog captures the opponent/category/points when opened, states the three-token throw cost, and lists all six odds from the shared game constants ([after](punch-after.png)). The after screenshot uses a deterministic Sucker-for-50 fixture; the original live baseline happened to score Large straight for 40. Neither screenshot represents a change to scoring or eligibility.

Seven local token/focus browser cases passed, including 393 × 852, 375 × 667, and 430 × 932 dialog bounds. Four explanation cases were rerun after arranging the odds in two rows. The existing two-player invite/turn flow passed with added multiplayer Mulligan disclosure assertions. Both typechecks, 88 app tests, 11 Edge tests, lint, and whitespace checks passed. Updated only the intentional token-menu visual baseline; unrelated macOS raster differences from snapshot generation were discarded.

This PR builds on the token-menu focus fix (#76). It does not enable remote Mulligan or resolve the pending Punch-eligibility rules decision. Native device appearance remains unverified.
