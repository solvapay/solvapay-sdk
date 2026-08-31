#!/usr/bin/env bash
# Reserved-domain ngrok for Rust guerrillamail-mcp.
# If an ngrok agent already has that hostname online, reuse it and bind
# the local HTTP server to the tunnel's existing local port (3030).
set -euo pipefail

EXAMPLE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$EXAMPLE_DIR/../../.." && pwd)"
SOLVA_PAY_ROOT="$(cd "$EXAMPLE_DIR/../../../.." && pwd)"
PLATFORM_NGROK_CONFIG="$SOLVA_PAY_ROOT/platform/ngrok.yml"
BACKEND_NGROK_CONFIG="$SOLVA_PAY_ROOT/solvapay-backend/ngrok.yml"
NGROK_API="${NGROK_API:-http://127.0.0.1:4040/api/tunnels}"

is_shared_mcp_example() {
  local cmd="$1"
  [[ "$cmd" == *bitcoin_analytics_mcp* ||
    "$cmd" == *weather-mcp* ||
    "$cmd" == *guerrillamail-mcp* ||
    "$cmd" == *"--mode http"* ||
    "$cmd" == *stock-research-mcp* ]]
}

stop_mcp_example_on_port() {
  local port="$1"
  local pid cmd ppid pcmd
  local pids
  pids="$(lsof -nP -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -z "$pids" ]] && return 0
  for pid in $pids; do
    cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if ! is_shared_mcp_example "$cmd"; then
      continue
    fi
    echo "Stopping leftover MCP example (pid ${pid}) on :${port}"
    ppid="$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d ' ' || true)"
    kill "$pid" 2>/dev/null || true
    if [[ -n "$ppid" && "$ppid" != "1" ]]; then
      pcmd="$(ps -p "$ppid" -o command= 2>/dev/null || true)"
      if [[ "$pcmd" == *go\ run* || "$pcmd" == *uv\ run* || "$pcmd" == *ruby* || "$pcmd" == *cargo\ run* ]]; then
        kill "$ppid" 2>/dev/null || true
      fi
    fi
  done
  sleep 0.4
  pids="$(lsof -nP -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  for pid in $pids; do
    cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if is_shared_mcp_example "$cmd"; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    pkill -P "$SERVER_PID" 2>/dev/null || true
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  stop_mcp_example_on_port "${MCP_PORT:-3030}"
  if [[ -n "${NGROK_PID:-}" ]]; then
    kill "$NGROK_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

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

# True when an ngrok agent already advertises this exact hostname.
# Wildcard tunnels (the platform MCP proxy) are not a match — this example
# must sit on the reserved origin `appmcp.jack-local.ngrok.app`, not the proxy.
tunnel_local_port() {
  local want="$1"
  python3 - "$want" "$NGROK_API" <<'PY'
import json
import sys
import urllib.request
from urllib.parse import urlparse

want_host = (urlparse(sys.argv[1]).hostname or "").lower()
api = sys.argv[2]
try:
    with urllib.request.urlopen(api, timeout=2) as response:
        payload = json.load(response)
except Exception:
    raise SystemExit(1)
for tunnel in payload.get("tunnels", []):
    public = (tunnel.get("public_url") or "").rstrip("/")
    host = (urlparse(public).hostname or "").lower()
    if host != want_host:
        continue
    addr = ((tunnel.get("config") or {}).get("addr") or "").strip()
    port = urlparse(addr).port
    if port is None:
        raise SystemExit(1)
    print(port)
    raise SystemExit(0)
raise SystemExit(1)
PY
}

load_env_file "$EXAMPLE_DIR/.env"
load_env_file "$EXAMPLE_DIR/.env.local"

DEFAULT_PUBLIC_URL="https://appmcp.jack-local.ngrok.app"
PUBLIC_URL="${GUERRILLAMAIL_NGROK_URL:-${MCP_PUBLIC_BASE_URL:-$DEFAULT_PUBLIC_URL}}"

export MCP_PUBLIC_BASE_URL="$PUBLIC_URL"
export MCP_HOST="${MCP_HOST:-127.0.0.1}"
export MCP_SOURCE="${MCP_SOURCE:-live}"

REUSE_EXISTING=0
if TUNNEL_PORT="$(tunnel_local_port "$PUBLIC_URL")"; then
  REUSE_EXISTING=1
  if [[ -n "${MCP_PORT:-}" && "$MCP_PORT" != "$TUNNEL_PORT" ]]; then
    echo "Existing ${PUBLIC_URL} tunnel points at localhost:${TUNNEL_PORT}, not MCP_PORT=${MCP_PORT}." >&2
    echo "guerrillamail-mcp must listen on ${TUNNEL_PORT} to serve that hostname." >&2
    exit 1
  fi
  export MCP_PORT="$TUNNEL_PORT"
  echo "Using existing ngrok tunnel ${PUBLIC_URL} → localhost:${MCP_PORT}."
else
  export MCP_PORT="${MCP_PORT:-3030}"
  if ! command -v ngrok >/dev/null 2>&1; then
    echo "ngrok is required to expose guerrillamail-mcp. Install it with: brew install ngrok" >&2
    exit 1
  fi

  NGROK_CONFIG="${GUERRILLAMAIL_NGROK_CONFIG:-}"
  if [[ -z "$NGROK_CONFIG" ]]; then
    if [[ -f "$PLATFORM_NGROK_CONFIG" ]]; then
      NGROK_CONFIG="$PLATFORM_NGROK_CONFIG"
    elif [[ -f "$BACKEND_NGROK_CONFIG" ]]; then
      NGROK_CONFIG="$BACKEND_NGROK_CONFIG"
    fi
  fi

  if [[ -z "${NGROK_CONFIG:-}" || ! -f "$NGROK_CONFIG" ]]; then
    echo "Missing ngrok config." >&2
    echo "Copy platform/ngrok.yml.example to platform/ngrok.yml, or set GUERRILLAMAIL_NGROK_CONFIG." >&2
    echo "For local-only HTTP (no tunnel), use: pnpm mcp:guerrillamail" >&2
    exit 1
  fi
fi

echo "Starting guerrillamail-mcp on http://127.0.0.1:${MCP_PORT}"
echo "Public tunnel origin: ${MCP_PUBLIC_BASE_URL}"
echo "MCP endpoint: ${MCP_PUBLIC_BASE_URL}/mcp"

stop_mcp_example_on_port "${MCP_PORT}"

cargo run --manifest-path "$REPO_ROOT/examples/rust/guerrillamail-mcp/Cargo.toml" -- --mode http &
SERVER_PID=$!

if [[ "$REUSE_EXISTING" -eq 0 ]]; then
  echo "Starting ngrok tunnel at $PUBLIC_URL → localhost:${MCP_PORT}"
  ngrok http "$MCP_PORT" --config "$NGROK_CONFIG" --url "$PUBLIC_URL" &
  NGROK_PID=$!
fi

while true; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "guerrillamail-mcp exited unexpectedly." >&2
    wait "$SERVER_PID" 2>/dev/null || true
    exit 1
  fi
  if [[ -n "${NGROK_PID:-}" ]] && ! kill -0 "$NGROK_PID" 2>/dev/null; then
    echo "ngrok exited unexpectedly. Check your ngrok auth token and reserved domain." >&2
    wait "$NGROK_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 1
done
