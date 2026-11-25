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
  - Rematch and Recap. Rage-quit and computer games keep Rematch and Stats.
- **Trash-talk sheet.** A bottom sheet with the other player's line on top, if
  they have spoken, and your four dealt lines as radio options. Send stays
  disabled until a line is picked, since there is no undo. Cancel, the
  backdrop, Android back, or Escape on the web closes it, and a failed send
  says so in the sheet.
- **Recap page ("Tale of the Tape").** A full page over the panel that may
  scroll. Rows where neither player did anything are left out. It shows scores and rating changes, mirrored bars for Punches,
  Moments, and Tokens, every feat and defeat by owner, all parting shots, and
  a Head-to-head stats button.

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
  the single Rage Quit reply stays as is. Rage-quit games show no recap.
- **Timeouts get nothing.** A game forfeited by inactivity has no final
  scores or game feats, so it shows no recap and takes no parting shots.
- **No time limit.** Shots stay available while the game is in a player's list.
- Each line clears the recipient's `result_seen_at`, so the game returns to
  their list, and sends them a push.

## Recap

| Section | Content                                                                          | Source                                 |
| ------- | -------------------------------------------------------------------------------- | -------------------------------------- |
| Rating  | Each player's rating before and after                                            | `get_game_recap`                       |
| Feats   | Feats and defeats each player earned this game, including milestones it unlocked | `get_game_recap` (from `player_feats`) |
| Punches | Thrown, landed, counterpunches landed, biggest score deleted                     | `turn_actions`, `turns`                |
| Moments | Best turn, Suckers rolled, Sucker Deals, lead changes, biggest lead              | `turns`, `turn_actions`                |
| Tokens  | Spent on Extra Rolls, Mulligans, and Punches; points bought; left over; splurges | `turn_actions`, `turns`, final state   |

`get_game_recap(target_game_id)` is participant-only; `player_feats` and other
players' `game_player_results` stay closed to direct reads. Punches, Moments,
and Tokens are built in the app by `shared/gameRecap.ts` from turns and actions
a participant can already read. The Game Over panel itself never scrolls; the
numbers live on the recap page.

## Turn Spend

Every turn records what it cost: `turns.extra_rolls` and `turns.mulligans`
(null on turns from before this). `state.turnSpend` counts purchases during the
turn and clears when it is scored. Mulliganing a scored turn carries its spend
into the replay, so the mulliganed row is skipped; a punched turn's spend
bought nothing.

- **Turn reveal.** Under "<name> played <score> on <box>", a second line when
  the turn cost tokens. It states facts, never what the player was going for:
  "Burned 5 tokens for nothing." (scored 0), "Spent 5 tokens and rolled a
  Sucker!", or "Spent 5 tokens on 2 Extra Rolls + a Mulligan."
- **Tale of the Tape.** Tokens adds **Points bought** (points from turns that
  cost tokens, with what they cost) and one line per player on their priciest
  turn, e.g. "Test Player 2 burned 5 tokens for a 0 on Sucker."

## Implementation

- Migration `20261124120000_add_end_game_recap.sql`: the `parting_shot` action
  type, `get_game_recap`, and the turn spend columns.
- `src/game/turnSpend.ts` writes the spend lines for the turn reveal and recap.
- `game-action` `parting_shot { gameId, lineId }` appends to
  `state.partingShots` through `commit_game_move`, whose version check keeps
  one line per player race-safe across devices, as with Rage Quit replies.
- `shared/partingShots.ts` is mirrored into `supabase/functions/_shared`;
  `tests/partingShots.test.cjs` keeps the copies in step.
- `src/ui/GameRecap.tsx` renders the recap; `src/multiplayer/gameRecap.ts`
  loads it once per finished game. Parting shots arrive with the game itself.

## Possible Follow-Ups

- A "Feat unlocked" toast on the move that earns an instant feat.
- A parting-shot preview on the games-list row.
