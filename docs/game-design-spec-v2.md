Sucker! - Game Design Specification v2

Vision

Sucker! is a head-to-head asynchronous mobile dice game inspired by classic five-dice scorecard games.

The game introduces a second resource system called Sucker Tokens, forcing players to balance:

- Scoring points
- Managing tokens
- Attacking opponents
- Defending themselves
- Sacrificing categories for tactical advantages

The goal is to create a game that feels familiar while adding meaningful player interaction and strategic decision-making.

⸻

Game Format

Players

- Exactly 2 players
- Asynchronous play
- One active turn at a time
- Push notifications for turn events

Dice

- 5 six-sided dice
- Up to 4 rolls per turn
- Players may hold and release dice between rolls

Objective

Finish with the highest score after all scorecard categories have been filled or scratched.

⸻

Scorecard

The scorecard follows traditional Yahtzee-style categories.

Upper Section

- Ones
- Twos
- Threes
- Fours
- Fives
- Sixes

Lower Section

- Three of a Kind
- Four of a Kind
- Full House
- Small Straight
- Large Straight
- Chance
- Sucker

⸻

Sucker

Definition

A Sucker occurs when all five dice show the same value.

Examples:

- 1-1-1-1-1
- 6-6-6-6-6

Rewards

When a player rolls a Sucker:

- Scores the Sucker category normally
- Triggers Sucker animation
- Triggers optional taunt message

Suckers do NOT award tokens.

⸻

Sucker Tokens

Starting Balance

Each player begins every game with:

10 Sucker Tokens

Tokens do not carry between games.

Visibility

Token balances are always visible to both players.

Example:

Eric: 6 Tokens

Mom: 3 Tokens

Purpose

Tokens are a limited strategic resource.

Players must decide whether to spend tokens:

- Improving their own rolls
- Attacking opponents

⸻

Token Economy

Extra Roll

Cost: 1 Token

Description

Purchase one additional roll after all standard rolls have been used.

Example

Normal Turn:

Roll 1

Roll 2

Roll 3

Roll 4

Player spends 1 token

Roll 5

Additional rolls may be chained as long as the player has tokens available.

⸻

Mulligan

Cost: 3 Tokens

Description

Discard the entire turn and replay it from the beginning.

Rules

- Original turn is completely removed
- All previous rolls are discarded
- Player starts a fresh turn
- Receives 4 standard rolls again

⸻

Sucker Punch

Cost: 3 Tokens

Description

Attempt to force the opponent to replay their most recently completed turn.

Rules

- Can only target the opponent’s immediately previous turn
- The target turn may have scored or scratched any category
- Cannot target older turns
- The chance die is rolled in a dedicated dialog over the game board, not in the normal dice tray or slots
- The attacking player rolls one die to set the hit chance:
  - 1 = 20%
  - 2 = 35%
  - 3 = 50%
  - 4 = 65%
  - 5 = 75%
  - 6 = 90%
- If the punch lands:
  - Original score is removed
  - Opponent must replay the turn
- If the punch is blocked:
  - Original score remains intact
  - Attacking player keeps the turn and plays normally
  - Opponent later sees a blocked-punch notice

Timing

Must be used before the attacking player starts their next turn.

Unused opportunities expire.

⸻

Scratching Categories

Definition

Instead of scoring a category, a player may permanently scratch it.

The category becomes unavailable for the remainder of the game.

Reward

Scratching a category awards:

+1 Sucker Token

Example

Player has no realistic chance of achieving Large Straight.

Instead of continuing to pursue it:

- Scratch Large Straight
- Gain 1 Sucker Token

Design Intent

Scratching becomes a strategic decision instead of a pure penalty.

Players may sacrifice future scoring opportunities to gain tactical flexibility.

⸻

Turn Flow

Standard Turn

1. Begin turn
2. Roll dice
3. Hold/release dice as desired
4. Continue rolling up to 4 times
5. Optionally purchase extra rolls
6. Select score category OR scratch category
7. Optionally use Mulligan
8. Submit turn

⸻

Opponent Response Flow

After a turn is submitted:

1. Opponent receives notification
2. Opponent may:
   - Accept result
   - Use Sucker Punch against the submitted turn
3. If Sucker Punch lands:
   - Submitted score is removed
   - Target replays the turn
4. If Sucker Punch is blocked:
   - Submitted score remains
   - Attacker starts their normal turn
5. Turn becomes finalized

⸻

Notifications

Examples:

Turn Events

- Your turn.
- Opponent completed their turn.
- Opponent rolled a SUCKER!
- Opponent tried to Sucker Punch you, but you blocked it.

Attack Events

- You were Sucker Punched!
- Sucker Punch successful.
- Sucker Punch blocked.

Game Events

- Opponent scratched Large Straight.
- Opponent purchased an extra roll.
- Game complete.

⸻

Strategy Goals

The game intentionally supports multiple viable playstyles.

Score Maximizer

- Conserves tokens
- Focuses on scorecard efficiency
- Rarely scratches categories

Tactical Player

- Scratches categories
- Uses frequent extra rolls
- Builds toward Sucker Punch opportunities

Defensive Player

- Maintains token reserves
- Chooses carefully when to accept or risk a Sucker Punch attempt
- Minimizes risk

⸻

Core Design Principles

1. Easy to learn in under one minute.
2. Familiar to players of classic dice scorecard games.
3. Every token spent should feel meaningful.
4. Every scratch should feel like a strategic choice.
5. Sucker Punches should be memorable moments, not constant occurrences.
6. Points win games.
7. Tokens create opportunities.
8. Players should frequently face tradeoffs between scoring and tactical flexibility.

One thing I’d specifically playtest is whether Scratch = 1 token or Scratch = 2 tokens. My gut says start with 1 token. It’s easier to increase later than to discover everyone is scratching categories constantly because 2 tokens is too generous.
