# End-Game Recap And Parting Shots

When a multiplayer game ends, the Game Over panel shows both players what
happened and gives each of them a canned last word. Computer games and
forfeits keep the plain Game Over panel.

## Screens

- **Game Over panel.** The title says the result and margin ("You won by 4!",
  "You lost by 4."). Each score card shows the rating change, and the winner's
  card is gold. The recap parts wait until the server has finished the game, so
  the final move's own feats and rating are in it. Then:
  - Highlights: up to three feats or defeats as a badge, the feat name, and
    the owner with the description. Feats that tell the story of the result
    (Blowout, Buzzer Beater, Comeback Kid…) lead and quick trivia (Blitz)
    trails; otherwise yours come before theirs and feats before defeats. The
    opponent gets a slot whenever they earned anything. "+N more in the recap"
    opens the recap page. A failed load can be retried by tapping it.
  - Last words: both players' lines as speech bubbles, in the order said. A
    button to say yours ("Fire back" once they have spoken) until you have;
    once you have, a note that you'll hear if they answer.
  - Rematch and Recap. Rage-quit, timed-out, and computer games keep Rematch
    and Stats.
- **Trash-talk sheet.** A bottom sheet with the other player's line on top, if
  they have spoken, and your four dealt lines as radio options. Send stays
  disabled until a line is picked, since there is no undo. Cancel, the
  backdrop, Android back, or Escape on the web closes it, and a failed send
  says so in the sheet.
- **Recap page ("Tale of the Tape").** A full page over the panel that may
  scroll. Rows where neither player did anything are left out. It shows scores
  and rating changes, mirrored bars for Punches, Moments, and Tokens, every feat
  and defeat by owner, the game's trash talk, and a Head-to-head stats button.
  While more is below, a fade and a "More ↓" button sit at the bottom (phones
  hide the scroll bar until you scroll); native also flashes the scroll bar.
- **Last words after a rematch.** Players often rematch before the other side
  has spoken. In a rematch, the other player's last word on the game before
  appears as a card under the player strip ("Bob's last word · last game") with
  Fire back, which opens the same sheet over the rematch, and a close button.
  It shows once per device: seeing the line on that game's Game Over panel, or
  closing or answering the card, marks it seen, and also marks that game's
  result seen so it doesn't return to the games list.
- **Games list.** A finished game brought back by a last word shows the line
  on its row (`Bob: "I demand a recount."`), as Rage Quit replies do.
- **Completed Games.** Opened from there, a game you can still speak on adds
  "Say your last word" (or "Fire back"), which opens the game screen.
- **Game Recap page.** Any finished multiplayer game, opened from Completed
  Games, a This Week or All Time leaderboard score ("See game ›"), or a
  player's Recent games. One page in all three places:
  - A matchup card: both players with avatar, final score (the winner's in
    gold), and rating change, then the result ("You won by 142!", "Bob won by
    9.", "Bob rage quit.") and date. Tapping a player opens their profile; back
    returns to the game on the same tab. Tapping the player whose profile you
    came from goes back to that profile instead of stacking a copy.
  - Tabs. **Scorecard**: the game screen's own category tiles with both
    players' boxes, the better score in each row in gold, a +50 badge on
    Sucker bonuses, the upper bonus (or progress toward 63), and the totals.
    The column heads are the players' avatars and names, in the matchup's
    order. **Recap**: a legend naming each side in its bar color, then the
    Tale of the Tape numbers and feats. **Trash Talk**: below.
  - Opened from Completed Games, your own games add Head-to-head and Rematch.
  - A game seen earlier in the session shows at once while a fresh copy
    loads; a failed load offers Try again.
  - Your side is on the left when you played. Otherwise the subject's side is:
    the leaderboard player, or the profile you came from.
- **Trash Talk.** Everything said, oldest first, as speech bubbles (the left
  side's on the right, like messages): each taunt with its round and what it
  answered ("Round 7 · after 25 on Full house", "after landing a Sucker
  Punch"), then a Rage Quit and its reply or a timeout, then both last words.
  A round is a player's nth box, so a punched or mulliganed turn and its replay
  share one.

## Rules

- **Canned lines only.** Same approach as taunts and Rage Quit replies, so there
  is still no moderation surface (see `community-leaderboards.md`). Lines live in
  `shared/partingShots.ts`: separate winner, loser, and tie lists.
- **One last word each.** A player sends one line, and that's it. A game holds at
  most two lines, in the order sent.
- **A random hand.** Each player is offered four lines drawn from the list for
  their result. The draw is seeded by game and player, so it differs from game
  to game but can't be redrawn by reopening the sheet or switching devices. The
  server accepts any line for the player's result, so growing the lists can't
  break an older app whose draw comes out differently. Never remove a line id:
  older games still show it, and older apps may still send it.
- **Rage Quit keeps its own rule.** The quitter never gets the last word, and
  the single Rage Quit reply stays as is. Rage-quit games show no recap on the
  Game Over panel.
- **Timeouts get nothing.** A game forfeited by inactivity has no final
  scores or game feats, so its Game Over panel shows no recap and it takes no
  parting shots. Both kinds of forfeit still open as a Game Recap page later.
- **No time limit.** Shots stay available while the game is in a player's list.
  A shot puts the game back in the recipient's list only within the 7 days
  after it ended, like any unseen result; after that it arrives as a push.
- Each line clears the recipient's `result_seen_at`, so the game returns to
  their list, and sends them a push.

## Recap

| Section | Content                                                                             | Source                                 |
| ------- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| Rating  | Each player's rating before and after                                               | `get_game_recap`                       |
| Feats   | Feats and defeats each player earned this game, including milestones it unlocked    | `get_game_recap` (from `player_feats`) |
| Punches | Thrown, landed, counterpunches landed, biggest score deleted                        | `turn_actions`, `turns`                |
| Moments | Best turn, Suckers rolled, Sucker Deals, lead changes, biggest lead                 | `turns`, `turn_actions`                |
| Tokens  | Spent on Extra Rolls, Mulligans, and Punches; paid-turn points; left over; splurges | `turn_actions`, `turns`, final state   |

`get_game_recap(target_game_id)` returns a finished game whole, as JSON: the
final state, both players with profile, rating change, and feats, every turn,
and the stat and taunt actions. Finished games are open to any signed-in
player, like the scores on the boards and in profile histories; unfinished
games are not open to anyone, players included. Tables stay closed to direct
reads by others. Punches, Moments, and Tokens are built in the app by
`shared/gameRecap.ts`, and the trash talk by `src/game/trashTalk.ts`. The Game
Over panel itself never scrolls; the numbers live on the recap page.

`get_leaderboard` returns a `game_id` on the score boards: the first game in
which the player reached their best score, under the same rules as the board
(no forfeits; this week only on This Week).

## Turn Spend

Every turn records what it cost: `turns.extra_rolls` and `turns.mulligans`
(null on turns from before this). `state.turnSpend` counts purchases during the
turn and clears when it is scored. Mulliganing a scored turn carries its spend
into the replay, so the mulliganed row is skipped; a punched turn's spend
bought nothing.

- **Turn reveal.** Under "<name> played <score> on <box>", a second line when
  the turn cost tokens. It states facts, never what the player was going for:
  "Burned 5 tokens for nothing." (scored 0), "Spent 3 tokens, then took a
  Sucker Deal." (which earns a token, so it isn't nothing), "Spent 5 tokens and
  rolled a Sucker!", or "Spent 5 tokens on 2 Extra Rolls and a Mulligan."
- **Tale of the Tape.** Token rows count tokens, with what they paid for under
  them ("2 used", "3 thrown"). **Paid-turn points** are points from turns that
  cost tokens, with what those turns cost; a punched turn's tokens count but
  its points don't. One line per player tells their priciest turn, e.g. "Test
  Player 2 burned 5 tokens for a 0 on Sucker." or "...for 25 on Full house,
  then got punched." A tie goes to the turn whose score stood.
- **Lead changes and biggest lead** are measured at the end of each round, when
  both players have filled the same number of boxes.

## Implementation

- Migration `20261124120000_add_end_game_recap.sql`: the `parting_shot` action
  type, `get_game_recap`, the turn spend columns, and `get_leaderboard`'s
  `game_id`. **Deploy it before the `game-action` function**: the function
  writes the new turn columns on every scored turn, so the other order stalls
  every multiplayer game. The old function ignores the new columns, so
  migration-first is safe.
- `src/ui/PastGame.tsx` is the Game Recap page; `src/ui/CategoryTile.tsx`
  holds the category tiles it shares with the game screen.
- `src/game/turnSpend.ts` writes the spend lines for the turn reveal and recap.
- `game-action` `parting_shot { gameId, lineId }` appends to
  `state.partingShots` through `commit_game_move`, whose version check keeps
  one line per player race-safe across devices, as with Rage Quit replies.
- `shared/partingShots.ts` is mirrored into `supabase/functions/_shared`;
  `tests/partingShots.test.cjs` keeps the copies in step.
- `src/ui/GameRecap.tsx` renders the recap; `src/multiplayer/gameRecap.ts`
  loads it once per finished game. During the game's own Game Over, parting
  shots come from the live game, so new ones appear without a reload.

## Possible Follow-Ups

- A "Feat unlocked" toast on the move that earns an instant feat.
- A parting-shot preview on the games-list row.
