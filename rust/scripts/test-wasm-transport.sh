#!/usr/bin/env bash
# Start the Node wire-fixture server and run solvapay-transport wasm32 tests.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK_ROOT="$(cd "$ROOT/.." && pwd)"
FIXTURES_ROOT="$SDK_ROOT/contract/fixtures/client"
SERVER_JS="$ROOT/scripts/wasm-fixture-server.mjs"
WASM_BINDGEN_VERSION="0.2.126"

cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required (Node ≥18 with global fetch)" >&2
  exit 1
fi

if ! command -v wasm-bindgen-test-runner >/dev/null 2>&1; then
  echo "installing wasm-bindgen-cli@${WASM_BINDGEN_VERSION} ..."
  cargo install wasm-bindgen-cli --version "$WASM_BINDGEN_VERSION" --locked
fi

installed="$(wasm-bindgen --version 2>/dev/null | awk '{print $2}' || true)"
if [[ "$installed" != "$WASM_BINDGEN_VERSION" ]]; then
  echo "wasm-bindgen-cli version mismatch: have '${installed:-none}', need ${WASM_BINDGEN_VERSION}" >&2
  echo "reinstalling wasm-bindgen-cli@${WASM_BINDGEN_VERSION} ..."
  cargo install wasm-bindgen-cli --version "$WASM_BINDGEN_VERSION" --locked --force
fi

server_log="$(mktemp -t solvapay-wasm-fixture-server.XXXXXX.log)"
cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$server_log"
}
trap cleanup EXIT

# Port 0 → OS assigns an ephemeral port; server prints "listening <port>".
node "$SERVER_JS" "$FIXTURES_ROOT" 0 >"$server_log" 2>&1 &
SERVER_PID=$!

port=""
for _ in $(seq 1 50); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "fixture server exited early:" >&2
    cat "$server_log" >&2
    exit 1
  fi
  if grep -q '^listening ' "$server_log"; then
    port="$(awk '/^listening / { print $2; exit }' "$server_log")"
    break
  fi
  sleep 0.1
done

if [[ -z "$port" ]]; then
  echo "timed out waiting for fixture server:" >&2
  cat "$server_log" >&2
  exit 1
fi

export SOLVAPAY_FIXTURE_SERVER="http://127.0.0.1:${port}"
# Round-tripping ~100 fixtures needs more than the default 20s browser timeout.
export WASM_BINDGEN_TEST_TIMEOUT="${WASM_BINDGEN_TEST_TIMEOUT:-120}"

echo "SOLVAPAY_FIXTURE_SERVER=${SOLVAPAY_FIXTURE_SERVER}"
echo "running: cargo test -p solvapay-transport --target wasm32-unknown-unknown"

cargo test -p solvapay-transport --target wasm32-unknown-unknown -- --nocapture
