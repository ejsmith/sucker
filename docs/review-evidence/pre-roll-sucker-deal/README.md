# Pre-roll Sucker Deal

Baseline: `715c7ec`. Local Expo app at an iPhone viewport of 393 × 852,
with an isolated Supabase instance and disposable Test Player 1/2 accounts.

1. Open a new multiplayer game without rolling.
2. Open Sucker Tokens and choose Sucker Deal.
3. Before the fix, all category buttons remain disabled (`before.png`).
   An integration request also fails with `turns_roll_count_check`.
4. After the fix, choose Ones: it saves zero points, awards one token,
   and passes the turn. Refresh confirms persistence (`after.png`).

The fix enables category selection in Sucker Deal mode and permits zero-roll,
zero-score turns in the database. Ordinary scoring still requires a roll.

Regression coverage checks the browser flow, persisted roll count, token award,
request replay, and database rejection of negative rolls or positive zero-roll scores.

## Review follow-up

The reviewer identified that placeholder dice could trigger a false Sucker
notification and appear in the opponent reveal. `notification-before.png`
shows the extracted existing notification logic failing the new regression;
`notification-after.png` shows the corrected behavior. Actual Sucker rolls
still produce their existing notification. The browser regression also verifies
that a zero-roll turn reveals the score without displaying unrolled dice.

This follow-up includes an Edge Function change that must accompany the migration
and client update when released. It has not been deployed to production.
