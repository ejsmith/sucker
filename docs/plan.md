# Sucker! Product Plan

## Stack

- Expo SDK 57 with Expo Router, React Compiler, React Native, and TypeScript for iOS, Android, and web.
- Supabase for auth, Postgres, realtime game updates, Edge Functions, and push-trigger state.
- Expo Notifications for async turn and response-window reminders.
- Shared TypeScript rules in `src/game` for both app play and future server validation.

## Core Rules

- Exactly 2 players per game.
- 5 six-sided dice.
- Up to 4 rolls per turn.
- Players may hold/release dice after the first roll.
- Score categories are Yahtzee-style: Ones through Sixes, Three/Four of a Kind, Full House, Small/Large Straight, Chance, and Sucker.
- Sucker means five of a kind and scores 50.
- Each player starts with 10 Sucker Tokens.
- Scoring a Sucker does not earn a Sucker Token.

## Token Abilities

- Mulligan costs 3 tokens and replays the current player's just-completed turn before submission.
- Sucker Punch costs 3 tokens and targets the opponent's most recently submitted turn before the current player takes their next turn.
- A Sucker Punch rolls one die for hit chance: 1 = 20%, 2 = 35%, 3 = 50%, 4 = 65%, 5 = 75%, 6 = 90%.
- A landed punch makes the target replay; a blocked punch keeps the target score and lets the attacker take their normal turn.

## Async Flow

1. Player rolls up to 4 times.
2. Player selects a category.
3. Player may Mulligan.
4. Turn is submitted.
5. Opponent gets a response window for Sucker Punch after the submitted turn.
6. Landed punches send the target into replay; blocked punches return play to the attacker.
7. Turn finalizes and the next player is notified.

## Milestones

1. Local prototype
   - Two players, four rolls, Sucker scoring, token display, dice holding, and scorecard locking.

2. Token actions
   - Add local Mulligan flow.
   - Add pending Sucker Punch and blocked-punch states.

3. Async backend
   - Store games, players, turns, token events, and response windows in Supabase.
   - Use Edge Functions as the only authority for score submission and token spending.

4. Social layer
   - Friend invites, canned taunts, push notifications, rematches.

## Head-to-Head Stats

Each matchup should show:

- Win/loss record.
- Total games played.
- Highest score.
- Average score.
- Times Sucker Punched.
- Mulligans/re-rolls used.
- Forced re-rolls received.
- Percent of games with upper section bonus.
- Percent of games with each major category scored: Sucker, Three of a Kind, Four of a Kind, Full House, Small Straight, Large Straight.

Stats should be written from finalized game results, not client-side estimates. Keep both `game_player_results` for auditability and `head_to_head_stats` for fast profile/matchup screens.

## Server Rule

The client should never directly finalize a score, token spend, or stat row. Edge Functions should verify turn ownership, dice history, category availability, token balance, response-window timing, final game completion, and head-to-head stat updates.
