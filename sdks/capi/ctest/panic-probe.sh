#!/usr/bin/env bash
# Rebuild solvapay-c with panic-probe and assert the FFI edge returns Panic.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CTEST="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "==> cargo build -p solvapay-c --features panic-probe"
cargo build -p solvapay-c --features panic-probe

TARGET_DIR="$(cargo metadata --format-version=1 --no-deps | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')"
LIB_DIR="${TARGET_DIR}/debug"

EXTRA_LIBS=()
case "$(uname -s)" in
  Linux) EXTRA_LIBS+=(-lpthread -ldl -lm) ;;
esac

PROBE_BIN="$(mktemp)"
cleanup() { rm -f "$PROBE_BIN"; }
trap cleanup EXIT

cc -std=c11 -Wall -Wextra -Werror \
  -I"$CTEST/../include" \
  "$CTEST/panic_probe.c" \
  -L"$LIB_DIR" \
  -lsolvapay_c \
  "${EXTRA_LIBS[@]}" \
  -o "$PROBE_BIN"

if [[ "$(uname -s)" == "Darwin" ]]; then
  DYLD_LIBRARY_PATH="$LIB_DIR${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" "$PROBE_BIN"
else
  LD_LIBRARY_PATH="$LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" "$PROBE_BIN"
fi
