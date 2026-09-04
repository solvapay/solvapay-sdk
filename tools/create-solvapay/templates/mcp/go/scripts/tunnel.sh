#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export MCP_PORT="${MCP_PORT:-3030}"
if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok is required. Install it with: brew install ngrok" >&2
  exit 1
fi

./scripts/http.sh &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM
ngrok http "$MCP_PORT"
