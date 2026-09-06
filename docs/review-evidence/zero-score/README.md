# Explain zero scores before committing

At 393 × 852, selecting Full House with a nonmatching roll displayed a zero preview and an enabled Play button, with no explanation of the token difference. See [before](before.png).

Pressing Play on a zero-point category now opens an explicit choice: Sucker Deal for zero plus one token, a normal zero with no token, or Keep Playing. Both scoring choices use the selected score box. Positive scores retain their existing direct submission. See [after](after.png).

Three browser regressions pass: normal zero, scratch zero, and positive scoring. They verify cancellation preserves the token count, Escape restores focus, and the two zero choices award exactly zero or one token. Both typechecks, 88 app tests, 11 Edge tests, and lint pass. The existing multiplayer test now explicitly confirms its zero-point Twos submission; its broader local run stopped earlier at an unrelated notification prompt because this preview lacks the test VAPID configuration. CI exercises that full flow with its configured environment.

A stale Metro bundle initially referenced an adjacent review worktree. It was cleared; the accepted phone screenshot and passing tests use this worktree's `App.tsx` and new dialog. No gameplay rule, scorecard layout, native build, or hosted deployment changed.
