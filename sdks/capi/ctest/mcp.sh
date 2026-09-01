#!/usr/bin/env bash
# Compile + run C MCP fixture replay and the reference engine adapter.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CTEST="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "==> cargo build -p solvapay-c"
cargo build -p solvapay-c

TARGET_DIR="$(cargo metadata --format-version=1 --no-deps | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')"
LIB_DIR="${TARGET_DIR}/debug"

EXTRA_LIBS=()
case "$(uname -s)" in
  Linux) EXTRA_LIBS+=(-lpthread -ldl -lm) ;;
esac

CALL_BIN="$(mktemp)"
ENGINE_BIN="$(mktemp)"
cleanup() { rm -f "$CALL_BIN" "$ENGINE_BIN"; }
trap cleanup EXIT

cc_link() {
  local out="$1"
  shift
  echo "==> compile $(basename "$out")"
  cc -std=c11 -Wall -Wextra -Werror \
    -I"$CTEST/../include" \
    -I"$CTEST" \
    "$@" \
    -L"$LIB_DIR" \
    -lsolvapay_c \
    "${EXTRA_LIBS[@]}" \
    -o "$out"
}

cc_link "$CALL_BIN" "$CTEST/mcp_call.c"
cc_link "$ENGINE_BIN" "$CTEST/mcp_engine.c" "$CTEST/mcp_json.c"

export SOLVAPAY_MCP_FIXTURES="$ROOT/contract/mcp-fixtures"
export SOLVAPAY_MCP_CALL="$CALL_BIN"
export SOLVAPAY_MCP_ENGINE="$ENGINE_BIN"
export SOLVAPAY_API_BASE_URL="${SOLVAPAY_API_BASE_URL:-http://127.0.0.1:1}"

run() {
  local bin="$1"
  shift
  if [[ "$(uname -s)" == "Darwin" ]]; then
    DYLD_LIBRARY_PATH="$LIB_DIR${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" "$bin" "$@"
  else
    LD_LIBRARY_PATH="$LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" "$bin" "$@"
  fi
}

echo "==> replay fixtures"
if [[ "$(uname -s)" == "Darwin" ]]; then
  DYLD_LIBRARY_PATH="$LIB_DIR${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" \
    python3 "$CTEST/replay_fixtures.py"
else
  LD_LIBRARY_PATH="$LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    python3 "$CTEST/replay_fixtures.py"
fi

echo "==> engine initialize (raw JSON-RPC stdin)"
RPC='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"c","version":"0"}}}'
OUT="$(printf '%s' "$RPC" | run "$ENGINE_BIN")"
echo "$OUT" | grep -q '"status":200'
echo "$OUT" | grep -q 'solvapay-mcp'
echo "ok: engine initialize"

echo "==> engine invokeHandler → mcpResume"
LOOP="$(python3 - <<'PY'
import json
print(json.dumps({
    "method": "POST",
    "path": "/mcp",
    "headers": {"authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjdXNfMSIsImlzcyI6Imh0dHBzOi8vYXBwLmV4YW1wbGUuY29tIiwiYXVkIjoiaHR0cHM6Ly9hcHAuZXhhbXBsZS5jb20vbWNwIiwiZXhwIjo0MTAyNDQ0ODAwfQ.eb4F_ZV0NAHvVw_MNTAOzvEpZj_0P0rutht4rFEw2aA"},
    "body": json.dumps({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {"name": "echo_paid", "arguments": {"n": 1}},
    }),
    "config": {
        "productRef": "prd_demo",
        "publicBaseUrl": "https://app.example.com",
        "resourceUri": "ui://test/view.html",
        "mcpPath": "/mcp",
        "payableTools": ["echo_paid"],
        "apiBaseUrl": "http://127.0.0.1:1",
        "hs256Secret": "solvapay-mcp-fixture-hs256-secret-32b!!",
        "nowUnixSecs": 1700000000,
    },
}))
PY
)"
OUT="$(printf '%s' "$LOOP" | run "$ENGINE_BIN")"
echo "$OUT" | grep -q '"status":200'
echo "$OUT" | grep -q '"id":3'
echo "$OUT" | grep -q '"n":1'
echo "$OUT" | grep -q 'cus_1'
echo "ok: engine invokeHandler resume"
echo "OK: C MCP fixtures + engine adapter"
