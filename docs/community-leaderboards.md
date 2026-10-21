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
  per-game feats, matching how Rage Quit already treats stats.
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
| `rating`                                 | Elo rating, starts at 1200                                |
| `rated_games`                            | Completed games that changed the rating                   |
| `peak_rating`                            | Highest rating reached                                    |
| `current_win_streak` / `best_win_streak` | Consecutive wins; a loss or tie resets the current streak |

`game_player_results` gains `rating_before` and `rating_after` so a completed
game can show "+14".

**Rating math (Elo):**

- Expected score `E = 1 / (1 + 10^((opponent - player) / 400))`.
- Actual score: win 1, tie 0.5, loss 0.
- K factor: 40 for a player's first 10 rated games (provisional), 24 after.
- **Repeat-opponent damping:** the first 3 games between the same pair in a
  trailing 7-day window count fully. Later games in that window use a quarter of
  the K factor, so two accounts farming each other move slowly.
- Players stay off the rating board until they have 5 rated games.

Existing completed games are replayed once, in completion order, by the
migration so current players start with a real rating.

### Leaderboards

`get_leaderboard(board, max_rows)` returns the top rows plus the caller's own
row when they are outside the top, each with a `rank`. Ties share a rank.

| Board                 | Value                                         | Eligibility                  |
| --------------------- | --------------------------------------------- | ---------------------------- |
| `rating`              | Current rating                                | 5+ rated games               |
| `weekly_high_score`   | Best single-game score since Monday 00:00 UTC | Any completed game this week |
| `all_time_high_score` | Best single-game score                        | Any completed game           |
| `sharpshooter`        | Sucker Punch landing rate                     | 10+ punches thrown           |
| `win_streak`          | Best win streak                               | 3+ wins in a row             |

Boards are computed at query time from indexed tables. That is fine for the
current player count. If boards get slow, add a materialized view refreshed
on completion or on a schedule.

### Feats

Feats are stored as occurrences in `player_feats (game_id, player_id,
feat_key, earned_at)`. A player can earn a per-game feat many times; the card
shows the count. The feat catalog (name, description, kind) lives in
`shared/feats.ts` so the app and Edge Functions share it. Adding a feat does not
need a migration.

**Per-game feats** are computed in TypeScript (`buildCompletedPlayerFeats`) from
the same actions, turns, and scorecards that already feed stats:

| Key                   | Name                | Trigger                                                   |
| --------------------- | ------------------- | --------------------------------------------------------- |
| `one_inch_punch`      | One-Inch Punch      | Land a Sucker Punch on a 1 (10% chance)                   |
| `iron_chin`           | Iron Chin           | Win after taking 2+ landed punches                        |
| `revenge_is_sweet`    | Revenge Is Sweet    | Land a punch at the revenge discount                      |
| `counter_culture`     | Counter Culture     | Land a counterpunch that cost only 1 token                |
| `penny_pincher`       | Penny Pincher       | Win without spending a token                              |
| `high_roller`         | High Roller         | Spend 10+ tokens and win                                  |
| `deal_with_the_devil` | Deal With the Devil | Win with a zero in the Sucker box                         |
| `natural`             | Natural             | Roll five of a kind on the first roll of a turn           |
| `bought_it`           | Bought It           | Roll five of a kind on a purchased Extra Roll             |
| `sucker_supreme`      | Sucker Supreme      | Score 2+ extra Sucker bonuses in one game                 |
| `upper_crust`         | Upper Crust         | Score at least three of every number in the upper section |
| `comeback_kid`        | Comeback Kid        | Win after trailing by 50+                                 |
| `buzzer_beater`       | Buzzer Beater       | Take the lead on your final turn and win                  |
| `blowout`             | Blowout             | Win by 75+                                                |

"First roll of a turn" means the roll count since the player's last score,
scratch, Mulligan, or punch received is 1. "Purchased roll" means a roll beyond
the 4 standard rolls.

**Milestone feats** are awarded once by the completion trigger, which can see a
player's full history:

| Key                                | Name          | Trigger                                                                                    |
| ---------------------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| `globetrotter_10` / `_25` / `_100` | Globetrotter  | Beat 10 / 25 / 100 different opponents                                                     |
| `welcome_wagon`                    | Welcome Wagon | Finish a game with someone in their first completed game, when you have 5+ completed games |
| `nemesis`                          | Nemesis       | Complete 10 games against the same opponent                                                |
| `centurion`                        | Centurion     | Complete 100 games                                                                         |

`get_player_feats(target)` returns each feat a player has, with its count,
first and last earned dates, and **rarity**: the percentage of players with
1+ completed games who have earned it. Per-game feats are not backfilled for
games completed before launch; milestone feats catch up on a player's next
completed game.

### Player Card

`get_player_card(target)` returns a player's name, username, avatar, rating,
rating rank (if visible), record, best score, streaks, and feat count. The app
shows it from any leaderboard row with:

- a **Challenge** button that uses the existing `create_game` action, and
- their feats with rarity.

Players reach their own card from their row on any board.

### App

- New lobby entry **Hall of Suckers** (below Completed Games) opens the
  Community page with board tabs.
- Tapping a row opens the player card.
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
