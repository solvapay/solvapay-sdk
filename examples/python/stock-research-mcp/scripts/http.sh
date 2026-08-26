#!/usr/bin/env bash
set -euo pipefail

EXAMPLE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$EXAMPLE_DIR/../../.." && pwd)"
PYTHON_MCP="$REPO_ROOT/sdks/python-mcp"

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

export MCP_PORT="${MCP_PORT:-3030}"
export MCP_PUBLIC_BASE_URL="${MCP_PUBLIC_BASE_URL:-https://appmcp.jack-local.ngrok.app}"

exec uv run --project "$PYTHON_MCP" --extra dev --with httpx --with uvicorn \
  python "$EXAMPLE_DIR/main.py" --mode http
