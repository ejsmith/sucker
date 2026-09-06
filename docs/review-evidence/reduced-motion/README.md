# Respect reduced motion during gameplay

With the browser's reduced-motion preference enabled, the original roll still created five flying dice. The failing regression captures the actual DOM overlay count. The [before screen](before.png) catches the emptied tray during that roll; the [after screen](after.png) shows the completed roll in its fixed slots.

Gameplay now uses the existing direct result paths for reduced-motion rolls and scoring. Computer scores remain readable in a static reveal. Punch chance rolls skip scrambling and transforms, and removed scores skip the wipe. Game actions, token spending, and result resolution still run normally.

Two dedicated browser regressions pass: zero flying dice with three rolls remaining, and a seeded human/computer score plus a complete Punch with no score-flight overlay or nonidentity die transform. Both existing ordinary-motion regressions pass, covering die landing size and black vacated scoring slots. Both typechecks, 92 app tests, 11 Edge tests, lint, and whitespace checks pass.

This verifies the browser preference and shared rendering logic. Native Reduce Motion, release frame rate, thermal behavior, and physical-device accessibility remain unverified. No native or EAS build was run. This PR is based on the separate computer-pace PR because it shares the opponent-reveal wait path.
# Preference changes during a notice

Enabling Reduce Motion while the Punch notice was visible still allowed its delayed impact animation to reach full opacity. The delayed callbacks now consult the latest preference, including immediately before starting the animation. The same browser regression observes zero impact opacity; all three reduced-motion cases pass. `toggle-before.png` and `toggle-after.png` show the captured regression output.

The same stale preference also affected the pause before an opponent's score flight. A second reproduction observed a new flight overlay after enabling Reduce Motion during that pause. All asynchronous animation entry points now read the latest preference. The regression observes zero new flight overlays, preserves the score, and all four reduced-motion cases pass. See `reveal-before.png` and `reveal-after.png`.
