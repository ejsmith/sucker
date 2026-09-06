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
