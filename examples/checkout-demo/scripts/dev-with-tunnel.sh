#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_NGROK_CONFIG="$APP_ROOT/../../../solvapay-backend/ngrok.yml"

cleanup() {
  if [[ -n "${NEXT_PID:-}" ]]; then
    kill "$NEXT_PID" 2>/dev/null || true
  fi

  if [[ -n "${NGROK_PID:-}" ]]; then
    kill "$NGROK_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok is required to expose checkout-demo. Install it with: brew install ngrok" >&2
  exit 1
fi

if [[ ! -f "$BACKEND_NGROK_CONFIG" ]]; then
  echo "Missing backend ngrok config at: $BACKEND_NGROK_CONFIG" >&2
  exit 1
fi

if [[ -f "$APP_ROOT/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$APP_ROOT/.env.local"
  set +a
fi

CHECKOUT_DEMO_NGROK_URL="${CHECKOUT_DEMO_NGROK_URL:-}"
if [[ -z "$CHECKOUT_DEMO_NGROK_URL" ]]; then
  echo "Missing CHECKOUT_DEMO_NGROK_URL." >&2
  echo "Set it in examples/checkout-demo/.env.local, for example:" >&2
  echo "  CHECKOUT_DEMO_NGROK_URL=https://checkout-<your-subdomain>.ngrok.app" >&2
  exit 1
fi

echo "Starting checkout-demo on http://localhost:3010"
NODE_OPTIONS='--disable-warning=DEP0205' next dev --port 3010 &
NEXT_PID=$!

echo "Starting checkout-demo tunnel at $CHECKOUT_DEMO_NGROK_URL"
ngrok http 3010 --config "$BACKEND_NGROK_CONFIG" --url "$CHECKOUT_DEMO_NGROK_URL" &
NGROK_PID=$!

while kill -0 "$NEXT_PID" 2>/dev/null && kill -0 "$NGROK_PID" 2>/dev/null; do
  sleep 1
done
