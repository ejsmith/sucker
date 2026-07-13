# Sucker! Project Guide

Keep this file concise. Put durable project rules here; put detailed gameplay/design requirements in docs.

## Source Of Truth

- Use `docs/game-design-spec-v2.md` as the gameplay source of truth.
- Follow existing code patterns in `App.tsx`, `src/game`, `src/multiplayer`, and `supabase`.
- Keep platform-neutral game/database types in `shared/` when they must be used by both Expo and Supabase Edge Functions.
- Do not invent new gameplay rules from Yahtzee memory when the Sucker spec says otherwise.

## Current Gameplay Constants

- Exactly 2 players, asynchronous, one active turn at a time.
- 5 dice, up to 4 standard rolls per turn.
- Each player starts with 10 Sucker Tokens.
- Suckers do not award tokens.
- Extra Roll costs 1 token and can be chained while tokens remain.
- Mulligan costs 3 tokens.
- Sucker Punch costs 3 tokens and can target only the opponent's latest Sucker-scoring turn.
- Sucker Punch rolls one die for hit chance: 1 = 20%, 2 = 35%, 3 = 50%, 4 = 65%, 5 = 75%, 6 = 90%.
- Sucker Blocker is retired; do not add new blocker gameplay.
- Scratching a category awards 1 token.

## App And Stack

- Expo React Native app, mobile-first, with React Native Web for local browser iteration.
- `package.json` currently uses Expo `~54.0.0`; use the matching Expo version docs only when the task depends on Expo-specific APIs, configuration, build behavior, or compatibility.
- Do not check Expo docs for ordinary app code, styling, animation, or game-logic changes.
- Only run Expo/EAS builds when the user specifically asks for a build; the project is on a limited/free Expo plan.
- Multiplayer uses Supabase client code in `src/multiplayer`, SQL migrations in `supabase/migrations`, and Edge Functions in `supabase/functions`.
- Do not introduce a separate Deno app runtime. Supabase Edge Functions may use their normal Supabase runtime.

## Development Loop

- Prefer hot reload. Do not restart the dev server unless it died, dependencies/config changed, or Metro is stale.
- Local web command: `npm run web`. It uses Expo standard port `8081` in the primary checkout and `scripts/start-web.cjs` chooses a deterministic open port for linked worktrees, so multiple worktrees can run at the same time.
- When starting the web app for browser QA, run `npm run web`, then read `.build/dev-server.json` and open its `url` in the integrated browser. Do not assume `8081` in a linked worktree.
- The primary iteration workflow runs the app on this remote Linux machine over SSH and views it from the user's PC through Tailscale. After starting `npm run web`, leave that process running, read the assigned `port` from `.build/dev-server.json`, and get this machine's tailnet IPv4 address with `tailscale ip -4`.
- Give the user both `http://localhost:<port>` and `http://<tailscale-ip>:<port>`. Verify the tailnet URL with `curl --head` before reporting it ready. Expo must listen on more than loopback; `ss -ltnp` should show `*:<port>` (the existing start script normally does this).
- Direct Tailscale port access is sufficient and does not require Tailscale Serve. If the daemon socket is inaccessible in the sandbox, rerun only the required Tailscale inspection command with escalation. Do not enable or replace a Tailscale Serve configuration unless the user explicitly requests an HTTPS/MagicDNS Serve URL.
- Use an iPhone-sized browser viewport for UI checks: `393 x 852`.
- For code validation run:
  - `npm run typecheck`
  - `npm run typecheck:edge`
  - `npm run test`
  - `npm run test:edge`

## Visual And UX Rules

- The game screen should be fullscreen mobile with no vertical scrolling.
- Use the integrated browser or a local browser screenshot for visual UI/animation work.
- Verify visual changes at the iPhone viewport before saying they are done.
- Preserve the current scorecard layout unless the user asks to redesign it.
- Dice slots should stay fixed during rolls; only dice should animate.
- Dice roll animations should feel like dice being thrown into slots, not UI elements sliding past and snapping back.
- Use existing art assets in `assets/` when possible, especially the Sucker icon/wordmark and dice assets.

## Supabase Changes

- Add database changes as migrations under `supabase/migrations`.
- Keep `supabase/schema.sql` aligned with migrations when changing schema.
- Supabase Edge Functions run on Deno; keep shared Edge Function helpers under `supabase/functions/_shared`.
- Do not import Expo/app modules directly into Edge Functions; use Deno-compatible shared files instead.
- When typing Edge Functions with `supabase-js`, include generated table `Relationships` fields or table types may collapse to `never`.
- Deploy Edge Function changes only when the hosted multiplayer behavior needs them.
- Networked Supabase CLI commands may require escalation in Codex.

## Git And Safety

- The worktree may contain user changes. Do not revert changes you did not make.
- Keep edits scoped to the user request.
- Use `apply_patch` for manual file edits.
- For PRs, use project-facing branch names and titles: do not add `codex/` branch prefixes, `[codex]` PR title prefixes, or draft PR status unless explicitly requested.
