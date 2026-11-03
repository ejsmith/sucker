# End-Game Recap And Parting Shots

When a multiplayer game ends, the Game Over panel shows both players what
happened and gives each of them a canned last word. Computer games keep the
plain Game Over panel.

## Screens

- **Game Over panel.** The title says the result and margin ("You lost by 4.").
  Each score card shows the rating change, and the winner's card is gold. Then:
  - Highlights: up to three feats or defeats as a badge, the feat name, and
    the owner with the description. The order is your feats, their feats, your
    defeats, then theirs. "+N more in the recap" opens the recap page.
  - The latest parting shot as a speech bubble, and one button to answer it
    ("Fire back" or "Get the last word").
  - Rematch and Recap. Rage-quit and computer games keep Rematch and Stats.
- **Trash-talk sheet.** A bottom sheet with the line being answered on top and
  the four lines as radio options. Send stays disabled until a line is picked,
  since there is no undo. Cancel or the backdrop closes it.
- **Recap page ("Tale of the Tape").** A full page over the panel that may
  scroll. It shows scores and rating changes, mirrored bars for Punches,
  Moments, and Tokens, every feat and defeat by owner, all parting shots, and
  a Head-to-head stats button.

## Rules

- **Canned lines only.** Same approach as taunts and Rage Quit replies, so there
  is still no moderation surface (see `community-leaderboards.md`). Lines live in
  `shared/partingShots.ts`: winner, loser, and tie shots, plus comebacks.
- **One shot and one comeback each.** A player picks a shot from the lines for
  their result. Once the other player's shot lands, they may send one comeback.
  A waiting comeback is offered before their own shot. A game holds at most
  four lines, in the order sent.
- **Rage Quit keeps its own rule.** The quitter never gets the last word, and
  the single Rage Quit reply stays as is. Rage-quit games show no recap.
- **No time limit.** Shots stay available while the game is in a player's list.
- Each line clears the recipient's `result_seen_at`, so the game returns to
  their list, and sends them a push.

## Recap

| Section | Content                                                                           | Source                                 |
| ------- | --------------------------------------------------------------------------------- | -------------------------------------- |
| Rating  | Each player's rating before and after                                             | `get_game_recap`                       |
| Feats   | Feats and defeats each player earned this game, including milestones it unlocked  | `get_game_recap` (from `player_feats`) |
| Punches | Thrown, landed, counterpunches landed, biggest score deleted                      | `turn_actions`, `turns`                |
| Moments | Best turn, Suckers rolled, Sucker Deals, lead changes, biggest lead               | `turns`, `turn_actions`                |
| Tokens  | Spent on Extra Rolls, Mulligans, and Punches; earned from Sucker Deals; left over | `turn_actions`, final state            |

`get_game_recap(target_game_id)` is participant-only; `player_feats` and other
players' `game_player_results` stay closed to direct reads. Punches, Moments,
and Tokens are built in the app by `shared/gameRecap.ts` from turns and actions
a participant can already read. The Game Over panel itself never scrolls; the
numbers live on the recap page.

## Implementation

- Migration `20261102120000_add_end_game_recap.sql`: the `parting_shot` action
  type and `get_game_recap`.
- `game-action` `parting_shot { gameId, lineId }` appends to
  `state.partingShots` through `commit_game_move`, whose version check keeps the
  cap race-safe across devices, as with Rage Quit replies.
- `shared/partingShots.ts` is mirrored into `supabase/functions/_shared`;
  `tests/partingShots.test.cjs` keeps the copies in step.
- `src/ui/GameRecap.tsx` renders the recap; `src/multiplayer/gameRecap.ts`
  loads it once per finished game. Parting shots arrive with the game itself.

## Possible Follow-Ups

- A "Feat unlocked" toast on the move that earns an instant feat.
- A parting-shot preview on the games-list row.
