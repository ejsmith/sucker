# Optional faster computer turns

The computer game had one pace and no player setting ([before](before.png)). A seeded baseline measured 6,871 ms from submitting the player's score until their next roll became available ([timing](timing-before.png)). This is an observed pacing baseline, not a claim of incorrect gameplay.

The local game menu now offers Normal / Fast pace and remembers the preference on this installation ([after](after.png)). Fast shortens the ordinary thinking pause from 2,400 to 300 ms and the computer score-reading pause from 2,000 to 250 ms. Dice odds, strategy, animation curves, and the existing Punch score-wipe delay are unchanged. Pace changes are disabled during a turn animation; an already-started timer captures its original pace instead of being cancelled by a preference update. Failed storage keeps the active pace and shows a retry message.

The final seeded comparison measured Normal at 6,876 ms and Fast at 3,342 ms, with identical scores and both players' token balances ([report](timing-after.png)). Four browser cases passed, covering timing/results, reload persistence, failed preference storage, and 375 × 667 / 430 × 932 menus. Three existing phone scoring/menu/overlay cases also passed. Both typechecks, 92 app tests, 11 Edge tests, lint, and whitespace checks passed. Kept only the three intentional menu baselines from visual verification.

Built on #68 so reopening preserves the game as well as the preference. The preference is local to the installation. This is browser timing verification; native frame rate, thermal behavior, and release-device animation feel remain unverified. No native/EAS build was run.
# Replay follow-up

Review found the forced replay after a landed Sucker Punch still used a fixed thinking delay. [Before](replay-before.png), Normal and Fast revealed the replay in 2855 and 2857 ms. [After](replay-after.png), they took 2855 and 842 ms. The replay now uses the selected pace too; all four pace tests pass, including the full Punch/replay path, token charge, persistence, failure handling, and viewport bounds.
