#!/usr/bin/env bash
# Starts the TypeScript, Python and Go parity servers and their ngrok tunnels.
#
#   ./start.sh              servers + tunnels
#   ./start.sh --no-ngrok   servers only (tunnels run elsewhere)
#   ./start.sh ts go        only these servers (ts, py, go)
#
# Ctrl+C stops everything it started.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

NGROK=1
SERVERS=()
for arg in "$@"; do
  case "$arg" in
    --no-ngrok) NGROK=0 ;;
    ts|py|go) SERVERS+=("$arg") ;;
    *) echo "Unknown argument: $arg (expected --no-ngrok, ts, py or go)" >&2; exit 1 ;;
  esac
done
[ ${#SERVERS[@]} -eq 0 ] && SERVERS=(ts py go)

fail() { echo "❌ $*" >&2; exit 1; }

[ -f .env ] || fail ".env is missing: cp .env.example .env, then fill it in"
grep -v '^[[:space:]]*#' .env | grep -q 'your-subdomain\|sk_sandbox_\.\.\.\|prd_\.\.\.' \
  && fail ".env still has placeholders"
set -a; source .env; set +a

if [ "$NGROK" = 1 ]; then
  command -v ngrok >/dev/null || fail "ngrok is not installed: brew install ngrok"
  [ -f ngrok.yml ] || fail "ngrok.yml is missing: cp ngrok.yml.example ngrok.yml, then set your domains"
  grep -v '^[[:space:]]*#' ngrok.yml | grep -q 'your-subdomain' && fail "ngrok.yml still has placeholders"
  for pair in "TS_PUBLIC_BASE_URL:mcp-ts" "PY_PUBLIC_BASE_URL:mcp-py" "GO_PUBLIC_BASE_URL:mcp-go"; do
    var="${pair%%:*}"; url="${!var}"; host="${url#https://}"
    grep -q "domain: ${host}\$" ngrok.yml || fail "$var ($host) is not a domain in ngrok.yml"
  done
fi

PIDS=()
cleanup() {
  trap - EXIT INT TERM
  [ ${#PIDS[@]} -gt 0 ] && kill "${PIDS[@]}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Runs a command in the background with each output line prefixed.
run() {
  local label="$1"; shift
  ( "$@" 2>&1 | sed -u "s/^/[$label] /" ) &
  PIDS+=($!)
}

for server in "${SERVERS[@]}"; do
  case "$server" in
    ts) run ts env NODE_OPTIONS=--conditions=development pnpm exec tsx src/index.ts ;;
    py) run py bash -c 'cd python && exec uv run --quiet python main.py' ;;
    go) run go bash -c 'cd go && exec go run .' ;;
  esac
done

if [ "$NGROK" = 1 ]; then
  CONFIGS=()
  DEFAULT_CONFIG="$(ngrok config check 2>/dev/null | sed -n 's/.*configuration file at //p' | head -n1 || true)"
  [ -n "$DEFAULT_CONFIG" ] && [ -f "$DEFAULT_CONFIG" ] && CONFIGS+=(--config "$DEFAULT_CONFIG")
  CONFIGS+=(--config "$HERE/ngrok.yml")
  tunnels=()
  for server in "${SERVERS[@]}"; do tunnels+=("mcp-$server"); done
  run ngrok ngrok start "${CONFIGS[@]}" --log stdout --log-level warn "${tunnels[@]}"
fi

echo "MCP endpoints:"
for server in "${SERVERS[@]}"; do
  case "$server" in
    ts) echo "  TypeScript  $TS_PUBLIC_BASE_URL/mcp  (local http://127.0.0.1:$TS_PORT)" ;;
    py) echo "  Python      $PY_PUBLIC_BASE_URL/mcp  (local http://127.0.0.1:$PY_PORT)" ;;
    go) echo "  Go          $GO_PUBLIC_BASE_URL/mcp  (local http://127.0.0.1:$GO_PORT)" ;;
  esac
done
echo "Ctrl+C stops them all."

# Stop everything as soon as any one of them exits (bash 3.2 has no wait -n).
while sleep 1; do
  for pid in "${PIDS[@]}"; do
    kill -0 "$pid" 2>/dev/null || { echo "A process exited; stopping the rest." >&2; exit 1; }
  done
done
