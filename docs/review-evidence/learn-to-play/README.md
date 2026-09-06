# First-turn guide and scoring reference

The existing game menu had only Stats and no way to learn the controls or category meanings ([before](before.png)).

Added an optional five-step How to Play dialog covering rolls, held dice, score previews, committing a category, and tokens. A scoring reference explains every category and the section/extra-Sucker bonuses. It is available beside computer play before sign-in, in the signed-in lobby, and from the game menu. Closing help returns to the same game and restores focus. The guide uses the existing high-resolution wordmark ([after](after.png)).

The guide does not alter gameplay or force an introduction before playing. Detailed punch eligibility remains a separate pending rules decision; the copy refers to an eligible turn without resolving that conflict.

Four guide browser cases pass, covering all steps, reference access, keyboard focus, held-dice/roll preservation, and 375 × 667 / 430 × 932 controls. The existing two-player UI flow and all three phone menu/layout cases also pass. Inspected and updated only five intentional help-entry snapshots; discarded unrelated platform-rendering differences generated during that run. Both typechecks, 88 app tests, 11 Edge tests, and lint pass. Native VoiceOver and physical-device text settings remain unverified.
