# Sucker!

Sucker! is a mobile-first, head-to-head dice game built with Expo and React Native. It uses a familiar five-dice scorecard structure, then adds Sucker Tokens for extra rolls, mulligans, attacks, blocks, and tactical category scratches.

The gameplay source of truth is [docs/game-design-spec-v2.md](docs/game-design-spec-v2.md).

## Stack

- Expo `~54.0.0`
- React Native and React Native Web
- TypeScript
- Supabase for multiplayer state, database migrations, and Edge Functions
- Node test runner for game-rule tests
- Playwright for web E2E coverage

## Local Setup

Install dependencies:

```sh
npm install
```

Copy the example environment file when working with multiplayer:

```sh
cp .env.example .env
```

Set these values in `.env` for a Supabase-backed session:

```sh
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Without Supabase configuration, the app can still run the local demo game.

## Run The App

Start the Expo dev server:

```sh
npm start
```

Run the web build locally:

```sh
npm run web -- --port 8081
```

Platform shortcuts:

```sh
npm run ios
npm run android
```

## Validation

Core checks:

```sh
npm run typecheck
npm run test
```

Supabase Edge Function checks:

```sh
npm run typecheck:edge
npm run test:edge
```

Web E2E checks:

```sh
npm run test:e2e:web
```

Formatting and linting:

```sh
npm run lint
npm run format:check
```

## Useful Scripts

Computer strategy simulations:

```sh
npm run simulate:computer
npm run tournament:computer
npm run tournament:sucker-tokens
```

Supabase integration test setup:

```sh
npm run prepare:e2e-env
npm run test:integration:supabase
```

## Project Layout

- [App.tsx](App.tsx): main Expo app and game UI
- [shared/](shared): platform-neutral game rules and shared types
- [src/multiplayer/](src/multiplayer): Supabase client-side multiplayer code
- [supabase/migrations/](supabase/migrations): database migrations
- [supabase/functions/](supabase/functions): Supabase Edge Functions
- [tests/](tests): game-rule tests
- [e2e/](e2e): browser E2E tests and snapshots
- [assets/](assets): game art and dice assets
- [docs/](docs): gameplay and UI reference documentation

## Gameplay Notes

- Two players per game
- One active turn at a time
- Five dice, up to four standard rolls per turn
- Sucker Tokens power extra rolls, mulligans, Sucker Punch, and Sucker Blocker
- Scratching a category awards one token
- Suckers do not award tokens

See the design spec for complete rules and balancing details.