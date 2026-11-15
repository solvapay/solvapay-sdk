#!/usr/bin/env bash
# Starts the parity servers and their ngrok tunnels.
#
#   ./start.sh                     all six servers, and tunnels
#   ./start.sh paywall             the three paywall servers
#   ./start.sh agents go           the Go agents server
#   ./start.sh --no-ngrok ...      no tunnels (they run elsewhere)
#
# Tunnels: when an ngrok agent is already running (the platform's, with its
# API on 127.0.0.1:4040), the tunnels are added to it and removed on exit, so
# a plan that allows one agent still works. Otherwise this script starts its
# own agent from ngrok.yml. Run ./setup-ngrok.sh once to write ngrok.yml and
# the URLs in .env.
#
# Ctrl+C stops everything it started; so does any one process exiting.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

NGROK=1
KINDS=""
LANGS=""
for arg in "$@"; do
  case "$arg" in
    --no-ngrok) NGROK=0 ;;
    paywall|agents) KINDS="$KINDS $arg" ;;
    ts|py|go) LANGS="$LANGS $arg" ;;
    *) echo "Unknown argument: $arg (expected --no-ngrok, paywall, agents, ts, py or go)" >&2; exit 1 ;;
  esac
done
[ -n "$KINDS" ] || KINDS="paywall agents"
[ -n "$LANGS" ] || LANGS="ts py go"
SERVERS=()
for kind in $KINDS; do for lang in $LANGS; do SERVERS+=("$kind-$lang"); done; done

fail() { echo "❌ $*" >&2; exit 1; }

[ -f .env ] || fail ".env is missing: cp .env.example .env, then fill it in"
set -a; source .env; set +a

# The variable that holds a server's public URL: paywall-ts -> PAYWALL_TS_URL.
url_var() { echo "$1" | tr 'a-z-' 'A-Z_' | sed 's/$/_URL/'; }

for server in "${SERVERS[@]}"; do
  var="$(url_var "$server")"; url="${!var:-}"
  [ -n "$url" ] || fail "$var is not set in .env"
  case "$url" in *your-subdomain*) fail "$var still has the placeholder" ;; esac
done

if [ "$NGROK" = 1 ]; then
  command -v ngrok >/dev/null || fail "ngrok is not installed: brew install ngrok"
  [ -f ngrok.yml ] || fail "ngrok.yml is missing: run ./setup-ngrok.sh <suffix>"
  for server in "${SERVERS[@]}"; do
    var="$(url_var "$server")"; url="${!var}"; host="${url#https://}"
    grep -q "domain: ${host}\$" ngrok.yml || fail "$var ($host) is not a domain in ngrok.yml"
  done
fi

AGENT_API="http://127.0.0.1:4040/api/tunnels"
ATTACHED=()
PIDS=()
cleanup() {
  trap - EXIT INT TERM
  for name in ${ATTACHED[@]+"${ATTACHED[@]}"}; do
    curl -s -o /dev/null -X DELETE "$AGENT_API/$name" || true
  done
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
  kind="${server%-*}"
  case "$server" in
    *-ts) run "$server" env NODE_OPTIONS=--conditions=development pnpm exec tsx "src/$kind.ts" ;;
    *-py) run "$server" bash -c "cd python && exec uv run --quiet python $kind.py" ;;
    *-go) run "$server" bash -c "cd go && exec go run ./$kind" ;;
  esac
done

if [ "$NGROK" = 1 ] && curl -s -o /dev/null --max-time 2 "$AGENT_API"; then
  echo "Adding the tunnels to the ngrok agent already running (127.0.0.1:4040)."
  for server in "${SERVERS[@]}"; do
    var="$(url_var "$server")"; url="${!var}"
    case "$server" in
      paywall-ts) port=3060 ;; paywall-py) port=3061 ;; paywall-go) port=3062 ;;
      agents-ts) port=3070 ;; agents-py) port=3071 ;; agents-go) port=3072 ;;
    esac
    # A per-run name: the agent keeps a failed tunnel's name reserved.
    name="parity-$server-$$"
    answer="$(curl -s -X POST "$AGENT_API" -H 'content-type: application/json' \
      -d "{\"name\":\"$name\",\"proto\":\"http\",\"addr\":\"$port\",\"domain\":\"${url#https://}\"}")"
    case "$answer" in
      *'"public_url"'*) ATTACHED+=("$name") ;;
      *) fail "ngrok refused the tunnel for $server: $answer" ;;
    esac
  done
elif [ "$NGROK" = 1 ]; then
  CONFIGS=()
  DEFAULT_CONFIG="$(ngrok config check 2>/dev/null | sed -n 's/.*configuration file at //p' | head -n1 || true)"
  [ -n "$DEFAULT_CONFIG" ] && [ -f "$DEFAULT_CONFIG" ] && CONFIGS+=(--config "$DEFAULT_CONFIG")
  CONFIGS+=(--config "$HERE/ngrok.yml")
  run ngrok ngrok start "${CONFIGS[@]}" --log stdout --log-level warn "${SERVERS[@]}"
fi

echo "MCP endpoints:"
for server in "${SERVERS[@]}"; do
  var="$(url_var "$server")"; printf '  %-11s %s/mcp\n' "$server" "${!var}"
done
echo "Ctrl+C stops them all."

# Stop everything as soon as any one of them exits (bash 3.2 has no wait -n).
while sleep 1; do
  for pid in "${PIDS[@]}"; do
    kill -0 "$pid" 2>/dev/null || { echo "A process exited; stopping the rest." >&2; exit 1; }
  done
done
