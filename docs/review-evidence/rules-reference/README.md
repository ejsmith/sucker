# Optional rules reference

The game menu keeps its red and gold buttons, with separate borders, 8-point spacing, and at least 44-point tap targets. The popup is wider so labels have room. [Before](menu-before.png) is the reported cramped menu; [after](menu.png) shows the updated menu.

Rules is available only from the game menu. It opens a reference with Basics, Scoring, and Tokens sections. It explains controls and factual rules, including Revenge Punch discounts, without recommending scoring or token strategies. There is no onboarding prompt or step-by-step walkthrough. Closing it preserves the current turn and restores focus to the menu button.

A slim gold scroll indicator stays visible whenever a section overflows. It shows the current position, resets when switching sections, and disappears when all content fits. The header and section controls stay fixed while the content scrolls.

Screenshots captured in the integrated browser at a 393 × 852 CSS viewport:

- [Basics](basics.png)
- [Scoring](scoring.png)
- [Tokens](tokens.png)
- [Revenge Punch, Counterpunch, and hit odds](punch-odds.png)

Validation: typecheck, lint, and four Rules browser cases pass locally. They verify menu spacing, held dice and rolls, keyboard focus containment/restoration, visible close controls, and scroll-indicator visibility, movement, and section resets at 375 × 667, 393 × 852, and 430 × 932. Only the three header-menu screenshot baselines change relative to main. CI runs both typechecks, app and Edge tests, and the full Chromium/mobile WebKit suites, including New Game cancellation and restoring prepared Revenge Punches at both discounted prices. Local WebKit is unavailable because this host lacks its required shared libraries.
