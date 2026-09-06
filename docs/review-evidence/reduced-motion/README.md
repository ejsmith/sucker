# Respect reduced motion during gameplay

With the browser's reduced-motion preference enabled, the original roll still created five flying dice. The failing regression captures the actual DOM overlay count. The [before screen](before.png) catches the emptied tray during that roll; the [after screen](after.png) shows the completed roll in its fixed slots.

Gameplay now uses the existing direct result paths for reduced-motion rolls and scoring. Computer scores remain readable in a static reveal. Punch chance rolls skip scrambling and transforms, and removed scores skip the wipe. Game actions, token spending, and result resolution still run normally.

Two dedicated browser regressions pass: zero flying dice with three rolls remaining, and a seeded human/computer score plus a complete Punch with no score-flight overlay or nonidentity die transform. Both existing ordinary-motion regressions pass, covering die landing size and black vacated scoring slots. Both typechecks, 92 app tests, 11 Edge tests, lint, and whitespace checks pass.

This verifies the browser preference and shared rendering logic. Native Reduce Motion, release frame rate, thermal behavior, and physical-device accessibility remain unverified. No native or EAS build was run. This PR is based on the separate computer-pace PR because it shares the opponent-reveal wait path.
# Preference changes during a notice

Enabling Reduce Motion while the Punch notice was visible still allowed its delayed impact animation to reach full opacity. The delayed callbacks now consult the latest preference, including immediately before starting the animation. The same browser regression observes zero impact opacity; all three reduced-motion cases pass. `toggle-before.png` and `toggle-after.png` show the captured regression output.

The same stale preference also affected the pause before an opponent's score flight. A second reproduction observed a new flight overlay after enabling Reduce Motion during that pause. All asynchronous animation entry points now read the latest preference. The regression observes zero new flight overlays, preserves the score, and all four reduced-motion cases pass. See `reveal-before.png` and `reveal-after.png`.

## Preference changes during a stalled request

A remote Punch preparation request was held open locally. Enabling Reduce Motion still allowed nine die-face mutations in the following one-second observation window. Both roll scramble timers now check the latest preference and clear themselves before changing another face. The same Punch test observes zero mutations, then releases the request and verifies that Throw Punch becomes available. All five reduced-motion browser regressions, app typechecking, and lint pass. `stall-before.png` and `stall-after.png` show the actual regression output; `stall-screen-before.png` and `stall-screen-after.png` capture the app at the stalled request. A static app screenshot alone cannot establish that the animation stopped.

## Cancel motion already in progress

The next review reproduced five ordinary-roll flying overlays remaining after Reduce Motion was enabled while its server response was held open. The gameplay animation runner now tracks cancellation callbacks and stops active animations when the preference changes. Ordinary rolls also retain a cleanup callback while awaiting their result, immediately return the dice to fixed slots, and complete the same request without enabling a second roll early. Punch/reveal/bonus progress settles to its final value; score and wipe continuations still commit their results and remove overlays.

The stalled-roll reproduction now observes zero flying overlays after 200 ms and correctly displays three rolls remaining once the held response is released. An additional test cancels an active score flight and verifies the score is committed. Seven reduced-motion cases and both existing ordinary-motion regressions pass, as do app typechecking and lint. See `flight-before.png`, `flight-after.png`, and the corresponding `flight-screen-*.png` app captures. Physical-device behavior remains unverified.
