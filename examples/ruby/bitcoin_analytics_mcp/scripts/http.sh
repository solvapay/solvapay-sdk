#!/usr/bin/env bash
set -euo pipefail

EXAMPLE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$EXAMPLE_DIR/../../.." && pwd)"

cd "$EXAMPLE_DIR"

load_env_file() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

load_env_file "$EXAMPLE_DIR/.env"
load_env_file "$EXAMPLE_DIR/.env.local"

export MCP_HOST="${MCP_HOST:-127.0.0.1}"
export MCP_PORT="${MCP_PORT:-3030}"
export MCP_PUBLIC_BASE_URL="${MCP_PUBLIC_BASE_URL:-https://appmcp.jack-local.ngrok.app}"
export MCP_SOURCE="${MCP_SOURCE:-live}"
export SOLVAPAY_API_BASE_URL="${SOLVAPAY_API_BASE_URL:-http://localhost:3010}"

exec ruby \
  -I"${REPO_ROOT}/sdks/ruby/lib" \
  -I"${REPO_ROOT}/sdks/ruby-mcp/lib" \
  main.rb --mode http
