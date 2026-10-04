# Optional rules reference

The game menu keeps its red and gold buttons, with separate borders, 8-point spacing, and at least 44-point tap targets. The popup is wider so labels have room. [Before](menu-before.png) is the reported cramped menu; [after](menu.png) shows the updated menu.

Rules is available only from the game menu. It opens a reference with Basics, Scoring, and Tokens sections. It explains controls and factual rules without recommending scoring or token strategies. There is no onboarding prompt or step-by-step walkthrough. Closing it preserves the current turn and restores focus to the menu button.

Screenshots captured in the integrated browser at a 393 × 852 CSS viewport:

- [Basics](basics.png)
- [Scoring](scoring.png)
- [Tokens](tokens.png)
- [Tokens, scrolled to the hit odds](punch-odds.png)

Validation: both typechecks, lint, 128 app tests, and 20 Edge tests pass. Chromium checks cover optional entry, held dice and rolls, keyboard focus containment/restoration, separated menu buttons, scrollable content, and visible close controls at 375 × 667, 393 × 852, and 430 × 932. The three phone screenshot suites and token-menu focus checks pass. Only the three header-menu screenshot baselines change. The rules cases also run in mobile WebKit in CI; local WebKit is unavailable because this host lacks its required shared libraries.
