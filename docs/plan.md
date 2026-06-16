# Sucker! Product Plan

## Stack

- Expo SDK 54 with React Native and TypeScript for iOS and Android.
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
- Each player starts with 1 Sucker Token.
- Scoring a Sucker earns 1 Sucker Token.

## Token Abilities

- Mulligan costs 1 token and replays the current player's just-completed turn before submission.
- Sucker Punch costs 2 tokens and targets the opponent's most recently submitted turn before the current player takes their next turn.
- Sucker Blocker costs 1 token and cancels an incoming Sucker Punch.

## Async Flow

1. Player rolls up to 4 times.
2. Player selects a category.
3. Player may Mulligan.
4. Turn is submitted.
5. Opponent gets a response window for Sucker Punch.
6. Target gets a response window for Sucker Blocker if punched.
7. Turn finalizes and the next player is notified.

## Milestones

1. Local prototype
   - Two players, four rolls, Sucker scoring, token display, dice holding, and scorecard locking.

2. Token actions
   - Add local Mulligan flow.
   - Add pending Sucker Punch and Blocker states.

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
- Times Sucker Blocked.
- Mulligans/re-rolls used.
- Forced re-rolls received.
- Percent of games with upper section bonus.
- Percent of games with each major category scored: Sucker, Three of a Kind, Four of a Kind, Full House, Small Straight, Large Straight.

Stats should be written from finalized game results, not client-side estimates. Keep both `game_player_results` for auditability and `head_to_head_stats` for fast profile/matchup screens.

## Server Rule

The client should never directly finalize a score, token spend, or stat row. Edge Functions should verify turn ownership, dice history, category availability, token balance, response-window timing, final game completion, and head-to-head stat updates.
