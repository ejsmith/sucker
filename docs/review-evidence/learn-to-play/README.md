# First-turn guide and scoring reference

The existing game menu had only Stats and no way to learn the controls or category meanings ([before](before.png)).

Added an optional five-step How to Play dialog covering rolls, held dice, score previews, committing a category, and tokens. A scoring reference explains every category and the section/extra-Sucker bonuses. It is available beside computer play before sign-in, in the signed-in lobby, and from the game menu. Closing help returns to the same game and restores focus. The guide reuses the existing lobby artwork ([after](after.png)).

The guide does not alter gameplay or force an introduction before playing. Detailed punch eligibility remains a separate pending rules decision; the copy refers to an eligible turn without resolving that conflict.

Four guide browser cases pass, covering all steps, reference access, keyboard focus, held-dice/roll preservation, and 375 × 667 / 430 × 932 controls. The existing two-player UI flow and all three phone menu/layout cases also pass. Inspected and updated only five intentional help-entry snapshots; discarded unrelated platform-rendering differences generated during that run. Both typechecks, 88 app tests, 11 Edge tests, and lint pass. Native VoiceOver and physical-device text settings remain unverified.

## CI follow-up

The first asset choice introduced an otherwise unused large image. Reproduced the failed web-export budget locally: 6.76 MB against 6.50 MB ([before](export-before.png)). Reusing the already shipped lobby artwork reduces the export to 6.02 MB, with 2.03 MB JavaScript ([after](export-after.png)). Inspected the final phone appearance. Also inspected and replaced three intentional menu/lobby baselines with their canonical Linux CI captures; their local macOS font/raster rendering differed. No budget increase or test tolerance change was used.

Review found two misleading explanations. The token step advertised Mulligan without its current computer-only UI limitation ([before](tokens-before.png), [after](tokens-after.png)). The bonus reference said “another five-of-a-kind,” implying an earlier successful Sucker even though the rule accepts a zero or scratched Sucker box ([before](bonus-before.png), [after](bonus-after.png)). Corrected both explanations without changing gameplay. All four guide browser cases, typecheck, lint, and whitespace checks pass after the copy corrections, including the smaller phone layout.
# Current multiplayer integration

After integrating the current app, the token step still described Mulligan as computer-only. `integration-before.png` reproduces that stale instruction; `integration-after.png` shows the corrected current-turn explanation for both game modes. All four guide browser cases and both typechecks pass after integration.
