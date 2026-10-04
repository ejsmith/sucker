# Optional rules reference

The game menu keeps its red and gold buttons, with separate borders, 8-point spacing, and at least 44-point tap targets. The popup is wider so labels have room. [Before](menu-before.png) is the reported cramped menu; [after](menu.png) shows the updated menu.

Rules is available only from the game menu. It opens a reference with Basics, Scoring, and Tokens sections. It explains controls and factual rules, including Revenge Punch discounts, without recommending scoring or token strategies. There is no onboarding prompt or step-by-step walkthrough. Closing it preserves the current turn and restores focus to the menu button.

Screenshots captured in the integrated browser at a 393 × 852 CSS viewport:

- [Basics](basics.png)
- [Scoring](scoring.png)
- [Tokens](tokens.png)
- [Revenge Punch, Counterpunch, and hit odds](punch-odds.png)

Validation after merging Revenge Punch: both typechecks, lint, 141 app tests, and 20 Edge tests pass. Seven focused Chromium cases cover the rules, menu spacing at three phone sizes, New Game cancellation, and restoring prepared Revenge Punches at both discounted prices. Rules checks include held dice and rolls, keyboard focus containment/restoration, scrollable content, and visible close controls at 375 × 667, 393 × 852, and 430 × 932. Only the three header-menu screenshot baselines change relative to main. CI also covers mobile WebKit; local WebKit is unavailable because this host lacks its required shared libraries.
