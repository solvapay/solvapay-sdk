#!/usr/bin/env bash
# Build libsolvapay_c with the test-only fixture host, compile + run the C census.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CTEST="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "==> cargo build -p solvapay-c --features fixture-host"
cargo build -p solvapay-c --features fixture-host

TARGET_DIR="$(cargo metadata --format-version=1 --no-deps | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')"
LIB_DIR="${TARGET_DIR}/debug"

BIN="$(mktemp)"
cleanup() {
  rm -f "$BIN"
}
trap cleanup EXIT

echo "==> compile contract_fixtures.c"
EXTRA_LIBS=()
case "$(uname -s)" in
  Linux) EXTRA_LIBS+=(-lpthread -ldl -lm) ;;
esac

cc -std=c11 -Wall -Wextra -Werror \
  -I"$CTEST/../include" \
  -I"$CTEST" \
  "$CTEST/contract_fixtures.c" \
  "$CTEST/contract/dispatch.c" \
  "$CTEST/contract/harness.c" \
  -L"$LIB_DIR" \
  -lsolvapay_c \
  "${EXTRA_LIBS[@]}" \
  -o "$BIN"

echo "==> run C fixture census"
if [[ "$(uname -s)" == "Darwin" ]]; then
  DYLD_LIBRARY_PATH="$LIB_DIR${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" "$BIN"
else
  LD_LIBRARY_PATH="$LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" "$BIN"
fi
