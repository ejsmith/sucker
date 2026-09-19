# Token menu keyboard focus

Inspected the local app at 393 × 852. Before opening the menu left focus on `token-menu-button`, exposed no dialog role, and left the underlying game board in the accessibility tree. See [before](before.png).

The existing menu now uses the app's React Native Modal pattern. It has the name “Sucker Tokens,” moves focus to its close button, traps keyboard navigation, hides the background board, and restores focus on dismissal. Escape, the close button, and the existing backdrop dismiss it. Selecting a token action continues to work. See [after](after.png).

The modal stage fits the visible viewport, including when the small-screen board has scrolled. Three browser regressions passed: keyboard containment/dismissal/action focus, 375 × 667 containment, and 430 × 932 containment. The phone layout was visually inspected. Both typechecks, 88 app tests, 11 Edge tests, and lint passed. Native VoiceOver behavior has not been verified on a physical device.
