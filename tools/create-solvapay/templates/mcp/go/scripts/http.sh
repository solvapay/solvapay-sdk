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
export MCP_PUBLIC_BASE_URL="${MCP_PUBLIC_BASE_URL:-http://localhost:${MCP_PORT}}"
exec go run . --mode http
