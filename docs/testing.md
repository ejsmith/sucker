# Test quality and CI performance

Every pull request runs the app and Edge checks, real database integration,
the complete browser suite, a production-export smoke test, and all 1,000
deterministic computer strategy games. No suite is relegated to nightly-only.

## Running checks

- `npm run test`: fast rule, recovery, layout-policy, and simulation-contract tests.
- `npm run test:computer-quality`: seeds 1–1000 on two workers. Reports average,
  minimum, maximum, and elapsed time. The minimum average is 290, approximately
  3% below the established 298.851 baseline. Improvements pass; lowering the
  floor requires explicit strategy evaluation in review.
- `npm run typecheck`, `npm run typecheck:edge`, `npm run test:edge`.
- `npm run test:integration:supabase`: real RLS, transactional updates, replay,
  mixed-client compatibility, notification ownership, and accounting.
- `npm run test:e2e:web`: two workers; each test must own its users, games,
  browser contexts, and storage. Never reset shared tables inside a test.
- `npm run test:e2e:web -- --shard=1/4`: one CI shard. All four are required.
- `npm run build:web` then `npm run test:production`: serve and exercise the
  exported artifact rather than Metro. Requires configured public Supabase URL
  and anon key; the authentication request is intercepted and sends no email.

## Browser coverage rules

Use realistic device user agents with their matching browser engine. iPhone and
iPad desktop identity use WebKit, Android uses Chromium. Do not replace the UA
with bare platform names: this breaks Expo's Safari font-loading workaround and
causes a 12-second startup timeout. Platform-classification permutations belong
in the shared device-policy unit tests.

Keep complete invitation and turn-flow smoke tests. Focused punch, taunt, and
statistics scenarios create games through authenticated API fixtures instead of
repeating the invitation UI. Test sessions are cached only for setup actions;
browser authentication and sign-out tests use fresh sessions.

Realtime is enabled in the local stack. A real socket test pauses app timers
before a database update so polling cannot satisfy its assertion. Explicit
disconnected-socket tests continue to cover fallback polling and recovery.
Use the browser clock for deliberate delay thresholds, not shorter production
timeouts. Animation/geometry tests retain their real rendering behavior.

Prefer observable contracts: rendered containment, button spacing, minimum
touch targets, score changes, replay safety, and independent ranking results.
Exact style constants and source-format regexes are not rendering tests. The
TypeScript AST check for native font-scaling props complements browser checks
with 20% enlarged text; it does not claim to simulate native Dynamic Type.

## Measurement and evidence

Before this change, CI run 37219118234 took 19m57s overall: Web E2E 19m43s
(16.1m execution), app checks 4m03s (149s in one simulation), integration 3m11s
(44s of tests), and production compilation 23s. Compare same-runner CI timings,
not local wall time against hosted runners.

Each browser shard saves JSON timings and a blob report on success or failure.
CI merges the four blobs into an HTML report; artifacts are retained 14 days.
Review slow-test durations and setup separately. Count skipped engine-specific
cases separately from executed cases. Keep failure traces and screenshots.
Benchmark worker counts before increasing concurrency: more processes can
increase contention and make timing-sensitive tests flaky.

Native release verification still requires a device: keyboard overlay and focus
on iOS/Android, portrait locking, Dynamic Type at the allowed growth limit,
recipient punch impact, attacker hit impact, and Sucker-roll haptics. Browser
emulation and native configuration checks cannot establish tactile behavior.
