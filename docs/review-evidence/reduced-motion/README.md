# Respect reduced motion during gameplay

With the browser's reduced-motion preference enabled, the original roll still created five flying dice. The failing regression captures the actual DOM overlay count. The [before screen](before.png) catches the emptied tray during that roll; the [after screen](after.png) shows the completed roll in its fixed slots.

Gameplay now uses the existing direct result paths for reduced-motion rolls and scoring. Computer scores remain readable in a static reveal. Punch chance rolls skip scrambling and transforms, and removed scores skip the wipe. Game actions, token spending, and result resolution still run normally.

Two dedicated browser regressions pass: zero flying dice with three rolls remaining, and a seeded human/computer score plus a complete Punch with no score-flight overlay or nonidentity die transform. Both existing ordinary-motion regressions pass, covering die landing size and black vacated scoring slots. Both typechecks, 92 app tests, 11 Edge tests, lint, and whitespace checks pass.

This verifies the browser preference and shared rendering logic. Native Reduce Motion, release frame rate, thermal behavior, and physical-device accessibility remain unverified. No native or EAS build was run. This PR is based on the separate computer-pace PR because it shares the opponent-reveal wait path.
