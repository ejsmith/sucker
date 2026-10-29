# Community: Leaderboards, Feats, And Finding Opponents

Status: Phase 1 in progress (branch `community-leaderboards`).

## Goals

1. Give players a reason to care about results beyond one opponent: a global
   rating, record boards, and collectible feats.
2. Turn every leaderboard row, feat, and record into a way to meet a new
   opponent: tap a name, see their player card, challenge them.
3. Stay honest: only server-authoritative results count, farming one friend
   should not top a board, and players can opt out of public boards.

Non-goals for now: chat, free-text comments, friend lists, and tournaments.

## Ground Rules

- **Only multiplayer games count.** Ratings, boards, and feats come from
  `game_player_results`, which only the `game-action` Edge Function writes when
  a server-authoritative game completes. Computer games are reported by the
  client (`computer_game_results`) and are excluded.
- **Results are written atomically.** Per-game feats are added to the same
  `commit_game_move` write plan that already stores `game_player_results` and
  `head_to_head_stats`. Ratings, streaks, and milestone feats are updated by a
  database trigger when a game's status moves to `complete`, in that same
  transaction.
- **Forfeits count toward the record only.** A Rage Quit is a loss for the
  quitter and a win for the opponent in ratings, streaks, and milestone feats.
  Its partial scores and plays never reach high-score boards, Punch %, or
  result-based feats, matching how Rage Quit already treats stats. Instant
  feats earned before the quit stand. The exception is a winner who finishes
  their card after the quit: `game-action` sets `played_out_at` on their result,
  their final score reaches the weekly (by `played_out_at`) and all-time boards
  and their matchup high, and they earn instant and card feats
  (`buildPlayOutFeats`), never ones about the forfeit.
- **Boards respect privacy.** `profiles.show_on_leaderboards` (default `true`)
  removes a player from every public board. Player cards stay viewable, matching
  how `get_profile_stat_rates` already works for any signed-in player.
- **No moderation surface.** Nothing in Phase 1 lets players post text. Names
  and avatars already exist and are already searchable.

## Phase 1 (This Branch)

### Player Standings

Table `player_standings`, one row per player who has completed a multiplayer
game:

| Column                                   | Meaning                                                   |
| ---------------------------------------- | --------------------------------------------------------- |
| `rating`                                 | Glicko rating estimate, starts at 1200                    |
| `rating_deviation`                       | Uncertainty in `rating` as of `rated_at`, starts at 150   |
| `rated_at`                               | When the last rated game finished                         |
| `rated_games`                            | Completed games that changed the rating                   |
| `peak_rating`                            | Highest shown rating reached                              |
| `current_win_streak` / `best_win_streak` | Consecutive wins; a loss or tie resets the current streak |

Players see one number, the **shown rating**: `rating - 2 × deviation`, the
cautious end of their likely range (`conservative_rating`). It starts at 900,
climbs as games build confidence, and sinks while a player sits out. Boards,
ranks, and profiles all use it, computed as of now. `game_player_results`
gains `rating_before` and `rating_after`, the shown rating either side of the
game, so a completed game can show "+14".

**Rating math (Glicko-1, one game at a time):**

Dice luck keeps skill gaps small, so ratings start with a deviation of 150
rather than Glicko's usual 350. A wider start overreacts to early luck and can
raise a player's shown rating after a loss.

- `q = ln(10) / 400`, `g(d) = 1 / sqrt(1 + 3q²d² / π²)`.
- Before each game, each player's deviation grows with the days since their
  last rated game: `d = min(150, sqrt(d² + 100 × days))`.
- Expected score `E = 1 / (1 + 10^(-g(d_opponent) × (player - opponent) / 400))`.
- Actual score `S`: win 1, tie 0.5, loss 0.
- With game weight `w`: `d' = 1 / sqrt(1/d² + w × q² × g(d_opponent)² × E(1 - E))`
  and `rating' = rating + q × d'² × w × g(d_opponent) × (S - E)`.
- **Repeat-opponent damping:** the first 3 games between the same pair in a
  trailing 7-day window count fully (`w = 1`). Later games in that window count
  a quarter (`w = 0.25`).
- **Lopsided-pair guard:** once either player has won 19 of the pair's last 20
  games, their games stop counting until that record drops below 19. As of
  October 2026, real pairings peak at 17 of 20, so this only stops games thrown
  to a second account. It cannot stop someone who throws only some games.
- Players stay off the rating board until they have 5 rated games.

Idle decay: a player who stops playing loses roughly 30-45 shown points in a
month and 75-105 in three months, depending on how settled their rating is.
Their rating itself does not change, and their first games back count for
more, so they climb back quickly.

`rate_completed_game` holds the rating math; `apply_completed_game_standings`
calls it, then updates streaks and milestone feats. The Glicko migration resets
every rating and replays all completed games in completion order, so current
players start with a real Glicko rating. Streaks and feats are not replayed.

### Leaderboards

`get_leaderboard(board, max_rows)` returns the top rows plus the caller's own
row when they are outside the top, each with a `rank`. Ties share a rank.

| Board                 | Value                                         | Eligibility                  |
| --------------------- | --------------------------------------------- | ---------------------------- |
| `rating`              | Shown rating, as of now                       | 5+ rated games               |
| `weekly_high_score`   | Best single-game score since Monday 00:00 UTC | Any completed game this week |
| `all_time_high_score` | Best single-game score                        | Any completed game           |
| `sharpshooter`        | Sucker Punch landing rate                     | 10+ punches thrown           |
| `win_streak`          | Best win streak                               | 3+ wins in a row             |

Boards are computed at query time from indexed tables. That is fine for the
current player count. If boards get slow, add a materialized view refreshed
on completion or on a schedule.

### Feats and Defeats

Feats celebrate great play; defeats are their losing-side mirror (a choke, a
missed Sucker chase, a losing streak). Both share one catalog, with a `tone` of
`feat` or `defeat`, one table, and one rarity calculation, and profiles show
them as separate Feats and Defeats cards. There are no Hall of Shame boards
yet.

Feats are stored as occurrences in `player_feats (game_id, player_id,
feat_key, earned_at)`. A player can earn a per-game feat many times; the card
shows the count. The feat catalog (name, description, kind) lives in
`shared/feats.ts` so the app and Edge Functions share it. Adding a feat does not
need a migration.

**Per-game feats** are computed in TypeScript (`buildCompletedPlayerFeats`) from
the same actions, turns, and scorecards that already feed stats:

| Key                       | Name                    | Trigger                                                            |
| ------------------------- | ----------------------- | ------------------------------------------------------------------ |
| `one_inch_punch`          | One-Inch Punch          | Land a Sucker Punch on a 1 (10% chance)                            |
| `iron_chin`               | Iron Chin               | Win after taking 2+ landed punches                                 |
| `revenge_is_sweet`        | Revenge Is Sweet        | Land a punch at the revenge discount                               |
| `counter_culture`         | Counter Culture         | Land a counterpunch that cost only 1 token                         |
| `flurry`                  | Flurry                  | Land 3+ Sucker Punches in one game                                 |
| `rope_a_dope`             | Rope-a-Dope             | Win after your opponent missed 3+ punches at you                   |
| `thanks_i_needed_that`    | Thanks, I Needed That   | Get punched, then outscore the erased turn on the replay           |
| `penny_pincher`           | Penny Pincher           | Win without spending a token                                       |
| `high_roller`             | High Roller             | Spend 10+ tokens and win                                           |
| `deal_with_the_devil`     | Deal With the Devil     | Win with a zero in the Sucker box                                  |
| `natural`                 | Natural                 | Roll five of a kind on the first roll of a turn                    |
| `bought_it`               | Bought It               | Roll five of a kind on a purchased Extra Roll                      |
| `sucker_supreme`          | Sucker Supreme          | Score 2+ extra Sucker bonuses in one game                          |
| `seeing_double`           | Seeing Double           | Roll 2+ Suckers in one game                                        |
| `hat_trick`               | Hat Trick               | Roll 3+ Suckers in one game                                        |
| `four_score`              | Four Score              | Roll 4+ Suckers in one game                                        |
| `high_five`               | High Five               | Roll 5+ Suckers in one game                                        |
| `six_pack`                | Six Pack                | Roll 6+ Suckers in one game                                        |
| `lucky_seven`             | Lucky Seven             | Roll 7+ Suckers in one game                                        |
| `crazy_eights`            | Crazy Eights            | Roll 8+ Suckers in one game                                        |
| `back_to_back`            | Back-to-Back            | Roll a Sucker on two of your turns in a row                        |
| `anything_you_can_do`     | Anything You Can Do     | Roll a Sucker on the turn right after your opponent did            |
| `lightning_strikes_twice` | Lightning Strikes Twice | Have a scored Sucker punched away, then roll another on the replay |
| `straight_out_the_gate`   | Straight Out the Gate   | Roll a large straight on the first roll of a turn                  |
| `four_on_the_floor`       | Four on the Floor       | Roll exactly four of a kind on the first roll of a turn            |
| `daylight_robbery`        | Daylight Robbery        | Land a punch on a turn that scored a Sucker                        |
| `upper_crust`             | Upper Crust             | Score at least three of every number in the upper section          |
| `comeback_kid`            | Comeback Kid            | Win after trailing by 100+ (more than one Sucker)                  |
| `wire_to_wire`            | Wire to Wire            | Lead after every turn from your first one, and win                 |
| `buzzer_beater`           | Buzzer Beater           | Take the lead on your final turn and win                           |
| `walk_off`                | Walk-Off                | Trail going into the game's last turn, then take it and win        |
| `last_gasp`               | Last Gasp               | A Walk-Off scored on the last roll you had                         |
| `photo_finish`            | Photo Finish            | Win by 5 or less                                                   |
| `worth_every_penny`       | Worth Every Penny       | Buy 3+ Extra Rolls chasing a Sucker in one turn, and land it       |
| `do_over`                 | Do-Over                 | Mulligan a submitted turn and score 20+ more on the redo           |
| `blowout`                 | Blowout                 | Win by 75+                                                         |
| `dead_heat`               | Dead Heat               | Finish a game tied                                                 |
| `club_400` / `club_500`   | 400 Club / 500 Club     | Score 400+ / 500+ in one game                                      |
| `spotless`                | Spotless                | Finish with no zeros or scratches                                  |

**Per-game defeats** use the same inputs:

| Key                        | Name                     | Trigger                                                               |
| -------------------------- | ------------------------ | --------------------------------------------------------------------- |
| `glass_jaw`                | Glass Jaw                | Lose after taking 2+ landed punches                                   |
| `choke_artist`             | Choke Artist             | Lose after leading by 100+                                            |
| `walked_off`               | Walked Off               | Lead going into your opponent's last turn, then lose on it            |
| `heartbreaker`             | Heartbreaker             | Lose by 5 or less                                                     |
| `blown_out`                | Blown Out                | Lose by 75+                                                           |
| `double_digits`            | Double Digits            | Finish a game with under 100 points                                   |
| `whiff_city`               | Whiff City               | Miss 3+ Sucker Punches in one game                                    |
| `cant_miss_missed`         | Can't Miss, Missed       | Miss a punch at 75% odds                                              |
| `boomerang`                | Boomerang                | Miss a punch, then get hit by the counterpunch it handed them         |
| `sucker_punched`           | Sucker Punched           | Have a Sucker you scored punched away                                 |
| `backfire`                 | Backfire                 | Land a punch, then watch the replay outscore the turn you erased      |
| `died_rich`                | Died Rich                | Lose with 10+ tokens unspent                                          |
| `money_pit`                | Money Pit                | Spend 10+ tokens and still lose                                       |
| `sucker_born_every_minute` | Sucker Born Every Minute | Buy 3+ Extra Rolls chasing a Sucker in one turn, and miss             |
| `all_in_all_gone`          | All In, All Gone         | Spend every token chasing a Sucker in one turn, and miss              |
| `bought_a_goose_egg`       | Bought a Goose Egg       | Spend 3+ tokens in one turn and still walk away with a zero           |
| `buyers_remorse`           | Buyer's Remorse          | Sucker Deal your Sucker box, then roll five of a kind later that game |
| `shouldve_kept_it`         | Should've Kept It        | Mulligan a submitted turn and score less on the redo                  |
| `so_close`                 | So Close                 | Finish the upper section 1 to 3 points short of the bonus             |
| `scratch_fever`            | Scratch Fever            | Scratch 6+ categories in one game                                     |

A Sucker chase is an Extra Roll bought with four of a kind showing and the
Sucker box open (the existing Sucker hunt). The token balance for All In, All
Gone is replayed from the game's actions. The comeback margin is shared with
the Comeback wins stat, so both use 100. Rage Quit forfeits award no further
per-game feats or defeats.

A Sucker rolled counts once per run of rolls. A run starts over at each
submission and Mulligan, so rolling again with all five held, or buying another
roll on a Sucker, does not count twice. A Sucker on a punched turn's replay
counts again. The count tiers are separate feats, so a 6-Sucker game earns
Seeing Double through Six Pack. A landed punch, or a Mulligan of a submitted
turn, erases that turn: Back-to-Back and Anything You Can Do compare against
the turn before it, and
a "scored Sucker" is a turn scored (not scratched) with five of a kind showing.
Migration `20261028140000_backfill_sucker_count_feats.sql` credited games that
finished before the count tiers existed.

A replay is judged against the score of the turn it erased, a scratch counting
as 0. When a landed punch erased the turn, a higher replay score is Backfire
for the puncher and Thanks, I Needed That for the player punched. When the
player Mulliganed their own submitted turn, a redo 20+ points higher is a
Do-Over and a lower one is Should've Kept It. Mulliganing a turn in progress
has no score to compare. Score clubs start at 400 because the computer player
averages about 290 and reaches 300 in about 40% of games.

**Instant feats** (`instantFeatKeys`) cannot depend on how the game ends, so
`game-action` awards them in the same move that earns them: One-Inch Punch,
Revenge Is Sweet, Counter Culture, Flurry, Thanks I Needed That, Backfire,
Do-Over, Should've Kept It, Natural, Bought It, Worth Every Penny, Whiff
City, Can't Miss Missed, Boomerang, Sucker Punched, the Sucker count tiers,
Back-to-Back, Anything You Can Do, Lightning Strikes Twice, Straight Out the
Gate, Four on the Floor, Daylight Robbery, Sucker Born Every Minute, All In All
Gone, Bought a Goose Egg, Buyer's Remorse, and Scratch Fever. Only a punch, a
submission, a Mulligan, five of a kind, or a large straight or four of a kind
on a turn's first roll replays the game's actions to check.
Turn-level feats such as a Sucker chase settle when the turn is submitted or
Mulliganed. Completion still computes every feat and skips the ones already
stored for that game.

"First roll of a turn" means the roll count since the player's last score,
scratch, Mulligan, or punch received is 1. "Purchased roll" means a roll beyond
the 4 standard rolls.

**Per-game feats from the completion trigger** need ratings or the game's
timing, which `game-action` does not see. They can be earned many times, and a
Rage Quit awards none of them:

| Key             | Name          | Tone   | Trigger                                        |
| --------------- | ------------- | ------ | ---------------------------------------------- |
| `giant_killer`  | Giant Killer  | feat   | Beat someone rated 200+ above you              |
| `banana_peel`   | Banana Peel   | defeat | Lose to someone rated 200+ below you           |
| `blitz`         | Blitz         | feat   | Finish a game within an hour of its first roll |
| `the_long_game` | The Long Game | feat   | Finish a game 30+ days after its first roll    |

Rating gaps compare both players' shown ratings before the game, and only once
both have 5+ earlier completed games, so a new player's settling rating never
counts. A game's pace runs from its first roll to completion, so an invite
that waits to be accepted does not count against it.

**Milestone feats** are awarded once by the completion trigger, which can see a
player's full history:

| Key                                | Name                 | Trigger                                                                                    |
| ---------------------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| `globetrotter_10` / `_25` / `_100` | Globetrotter         | Beat 10 / 25 / 100 different opponents                                                     |
| `welcome_wagon`                    | Welcome Wagon        | Finish a game with someone in their first completed game, when you have 5+ completed games |
| `nemesis`                          | Nemesis              | Complete 10 games against the same opponent                                                |
| `got_your_number`                  | Got Your Number      | Beat the same opponent 5 in a row                                                          |
| `centurion`                        | Centurion            | Complete 100 games                                                                         |
| `hot_streak` / `on_fire`           | Hot Streak / On Fire | Win 5 / 10 in a row                                                                        |
| `sucker_collector`                 | Sucker Collector     | Roll a Sucker of every number, 1 through 6, across finished games                          |

**Milestone defeats** use the same trigger. A loss means the opponent won;
ties are neither:

| Key                        | Name                   | Trigger                                                        |
| -------------------------- | ---------------------- | -------------------------------------------------------------- |
| `ice_cold` / `deep_freeze` | Ice Cold / Deep Freeze | Lose 5 / 10 in a row                                           |
| `pigeon`                   | Pigeon                 | Lose 5 in a row to the same opponent                           |
| `welcome_mat`              | Welcome Mat            | Lose to someone in their first game, with 5+ games of your own |
| `table_flipper`            | Table Flipper          | Rage quit 5 games                                              |
| `glutton_for_punishment`   | Glutton for Punishment | Lose 100 games                                                 |

Win streaks count Rage Quit wins, as the Streak board does.
`player_standings.sucker_faces` keeps the Sucker faces each player has rolled
in finished games as bits 1 to 6, so Sucker Collector never rescans history.
Migration `20261029120000_add_streak_rating_and_pace_feats.sql` backfills those
bits and the new milestones on the game that earned each one. Its per-game
feats start with games finished after it.

The defeats migration backfills milestone defeats from history, on the game
that earned each one, and recomputes past comebacks at the 100-point margin:
comebacks that never trailed by 100 lose their Comeback wins count and their
Comeback Kid feat.

`get_player_feats(target)` returns each feat a player has, with its count,
first and last earned dates, and **rarity**: the percentage of players with
1+ completed games who have earned it. Per-game feats are not backfilled for
games completed before launch; milestone feats catch up on a player's next
completed game.

### Player Profile

There is one player profile, and it looks the same however you reach it: a
leaderboard row, a player avatar in a game, or a player on a recent game card.
`get_player_card(target)` adds a player's rating, world rank (if visible), and
best streak to the existing profile, and `get_player_feats(target)` adds their
feats with rarity. `get_player_rankings(target)` lists every board the player
is ranked on, from the same ranking `get_leaderboard` uses, so a profile never
disagrees with a board. Each ranking opens that leaderboard; from inside a game
the profile returns to the lobby on that board (`/?leaderboard=<board>`).

Every profile page starts with the same header, so moving around it never
shifts the layout: the player's identity and rank, then **Challenge** (starts a
game with the existing `create_game` action) beside a **Stats / Recent** switch.
Recent lists their latest games, and tapping a player there opens their profile.

Stats adds a Record / Win % / Rating / High strip, then **Overall**, **Vs You**
(the head-to-head against the viewer), **Ranks**, **Feats**, and **Defeats**
tabs. Feats and defeats list what the player has earned, with locked ones
behind a toggle.

Players reach their own profile from their row on any board; it has no Vs You
tab or Challenge button.

### App

- New lobby entry **Hall of Suckers** (below Completed Games) opens the
  Community page with board tabs.
- Tapping a row opens that player's profile.
- Profile page gains a **Show me on leaderboards** toggle.

### Rollout Order

1. Apply the migration. The new `commit_game_move` accepts `player_feats`
   writes; the old Edge Function keeps working because it never sends them.
2. Deploy `game-action` so new completions write per-game feats.
3. Ship the app update.

## Phase 2: Finding Opponents

- **Open Challenges:** post "looking for a game" with an optional rating range;
  anyone can accept. Uses a new `open_challenges` table and a
  `game-action` accept action that creates the game.
- **Quick Match:** pair with an open challenge near your rating, else post one.
- **Strangers setting:** `profiles.accept_challenges` to block direct challenges
  from non-opponents, plus block and report. Apple requires report/block once
  strangers can contact each other.
- **New player badge** for a player's first 10 completed games.

## Phase 3: Community Moments

- **The Sucker Wire:** a feed of rare moments (rare feats, new records) with
  emoji-only reactions. Each item links to the player card and a read-only replay
  built from stored turns.
- **Feat of the Week** board.
- **Seasons:** periodic soft rating resets with season badges.
- **Daily Dice:** a solo seeded run with the same dice for everyone. Needs a
  server-validated seed and replay because computer games are client-reported.
