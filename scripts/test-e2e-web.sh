#!/usr/bin/env bash
set -euo pipefail

supabase start
supabase db reset

status_env="$(supabase status -o env)"
read_status_value() {
  printf '%s\n' "$status_env" | sed -n "s/^$1=//p" | head -n 1 | sed 's/^"//;s/"$//'
}

api_url="$(read_status_value API_URL)"
anon_key="$(read_status_value ANON_KEY)"
service_role_key="$(read_status_value SERVICE_ROLE_KEY)"

export SUPABASE_URL="${SUPABASE_URL:-${api_url:-http://127.0.0.1:54321}}"
export SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$anon_key}"
export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$service_role_key}"
export EXPO_PUBLIC_SUPABASE_URL="$SUPABASE_URL"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY"
export EXPO_PUBLIC_E2E_DISABLE_ANIMATIONS=1
export SUCKER_E2E_FIXED_DIE=1
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:8081}"

if [[ -z "$SUPABASE_ANON_KEY" || -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  echo "Unable to read local Supabase keys from 'supabase status -o env'." >&2
  exit 1
fi

SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  supabase functions serve game-action --no-verify-jwt &
functions_pid=$!

BROWSER=none npm run web -- --port 8081 &
expo_pid=$!

cleanup() {
  kill "$expo_pid" >/dev/null 2>&1 || true
  kill "$functions_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..60}; do
  if ! kill -0 "$functions_pid" >/dev/null 2>&1; then
    wait "$functions_pid"
  fi

  if curl --connect-timeout 2 --max-time 5 -fsS -X OPTIONS "$SUPABASE_URL/functions/v1/game-action" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

for _ in {1..90}; do
  if ! kill -0 "$expo_pid" >/dev/null 2>&1; then
    wait "$expo_pid"
  fi

  if curl --connect-timeout 2 --max-time 5 -fsS "$E2E_BASE_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

npx playwright test "$@"
