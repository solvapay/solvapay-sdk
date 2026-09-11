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
if [[ -z "${MCP_PUBLIC_BASE_URL:-}" ]]; then
  echo "Missing MCP_PUBLIC_BASE_URL." >&2
  echo "Set it in examples/python/stock-research-mcp/.env to your reserved ngrok origin, for example:" >&2
  echo "  MCP_PUBLIC_BASE_URL=https://appmcp.your-subdomain.ngrok.app" >&2
  exit 1
fi
export MCP_PUBLIC_BASE_URL
export SOLVAPAY_API_BASE_URL="${SOLVAPAY_API_BASE_URL:-http://localhost:3010}"

exec uv run --project "$PYTHON_MCP" --extra dev --with httpx --with uvicorn \
  python "$EXAMPLE_DIR/main.py" --mode http
