#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(dirname "$SCRIPT_DIR")"
# examples/typescript/checkout-demo → solva-pay/ (sibling of solvapay-sdk)
SOLVA_PAY_ROOT="$(cd "$APP_ROOT/../../../.." && pwd)"
REPO_ROOT="$(cd "$APP_ROOT/../../.." && pwd)"
BACKEND_NGROK_CONFIG="${CHECKOUT_DEMO_NGROK_CONFIG:-$SOLVA_PAY_ROOT/solvapay-backend/ngrok.yml}"
DEV_PORT="${CHECKOUT_DEMO_PORT:-3014}"

cleanup() {
  if [[ -n "${NEXT_PID:-}" ]]; then
    kill "$NEXT_PID" 2>/dev/null || true
  fi

  if [[ -n "${NGROK_PID:-}" ]]; then
    kill "$NGROK_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

cd "$APP_ROOT"

echo "Building @solvapay/react (checkout-demo consumes packages/react/dist)..."
(cd "$REPO_ROOT" && pnpm --filter @solvapay/react build)

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok is required to expose checkout-demo. Install it with: brew install ngrok" >&2
  exit 1
fi

if [[ ! -f "$BACKEND_NGROK_CONFIG" ]]; then
  echo "Missing backend ngrok config at: $BACKEND_NGROK_CONFIG" >&2
  echo "For local-only Next (no tunnel), use: pnpm run dev:local" >&2
  echo "Or set CHECKOUT_DEMO_NGROK_CONFIG to your ngrok.yml path." >&2
  exit 1
fi

load_env_file() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

load_env_file "$APP_ROOT/.env"
load_env_file "$APP_ROOT/.env.local"

CHECKOUT_DEMO_NGROK_URL="${CHECKOUT_DEMO_NGROK_URL:-}"
if [[ -z "$CHECKOUT_DEMO_NGROK_URL" ]]; then
  echo "Missing CHECKOUT_DEMO_NGROK_URL." >&2
  echo "Set it in examples/typescript/checkout-demo/.env or .env.local, for example:" >&2
  echo "  CHECKOUT_DEMO_NGROK_URL=https://checkout-your-subdomain.ngrok.app" >&2
  echo "  CHECKOUT_DEMO_NGROK_HOST=checkout-your-subdomain.ngrok.app" >&2
  exit 1
fi

if [[ -z "${CHECKOUT_DEMO_NGROK_HOST:-}" ]]; then
  CHECKOUT_DEMO_NGROK_HOST="${CHECKOUT_DEMO_NGROK_URL#https://}"
  CHECKOUT_DEMO_NGROK_HOST="${CHECKOUT_DEMO_NGROK_HOST#http://}"
  CHECKOUT_DEMO_NGROK_HOST="${CHECKOUT_DEMO_NGROK_HOST%%/*}"
fi
export CHECKOUT_DEMO_NGROK_HOST
export CHECKOUT_DEMO_NGROK_URL

start_next() {
  echo "Starting checkout-demo on http://localhost:${DEV_PORT}"
  echo "Public tunnel origin: ${CHECKOUT_DEMO_NGROK_URL}"
  # --webpack: Turbopack rebundles workspace @solvapay/server and breaks napi.
  # CHECKOUT_DEMO_NGROK_HOST feeds next.config allowedDevOrigins for the tunnel host.
  (
    cd "$APP_ROOT"
    NODE_OPTIONS='--max-old-space-size=8192 --disable-warning=DEP0205' \
      CHECKOUT_DEMO_NGROK_HOST="$CHECKOUT_DEMO_NGROK_HOST" \
      pnpm exec next dev --webpack --port "$DEV_PORT"
  ) &
  NEXT_PID=$!
}

start_next

echo "Starting checkout-demo tunnel at $CHECKOUT_DEMO_NGROK_URL → localhost:${DEV_PORT}"
ngrok http "$DEV_PORT" --config "$BACKEND_NGROK_CONFIG" --url "$CHECKOUT_DEMO_NGROK_URL" &
NGROK_PID=$!

# Relaunch Next.js in place if it dies so the public URL stays stable.
while true; do
  if ! kill -0 "$NEXT_PID" 2>/dev/null; then
    echo "Next.js exited (likely OOM); restarting in 2s..." >&2
    wait "$NEXT_PID" 2>/dev/null || true
    sleep 2
    start_next
  fi

  if ! kill -0 "$NGROK_PID" 2>/dev/null; then
    echo "ngrok exited unexpectedly. Check your ngrok auth token and reserved domain." >&2
    wait "$NGROK_PID" 2>/dev/null || true
    exit 1
  fi

  sleep 1
done
