#!/usr/bin/env bash
# Build libsolvapay_c, start a mock /v1/sdk/merchant server, compile + run smoke.c.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CTEST="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "==> cargo build -p solvapay-c"
cargo build -p solvapay-c

TARGET_DIR="$(cargo metadata --format-version=1 --no-deps | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')"
LIB_DIR="${TARGET_DIR}/debug"

URL_FILE="$(mktemp)"
SMOKE_BIN="$(mktemp)"
MOCK_PID=""
cleanup() {
  rm -f "$URL_FILE" "$SMOKE_BIN"
  if [[ -n "${MOCK_PID}" ]]; then
    kill "$MOCK_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

python3 - "$URL_FILE" <<'PY' &
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

url_file = sys.argv[1]

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/v1/sdk/merchant"):
            body = json.dumps({"displayName": "Acme Payments", "country": "US"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *_args):
        return

httpd = HTTPServer(("127.0.0.1", 0), H)
host, port = httpd.server_address
with open(url_file, "w", encoding="utf-8") as f:
    f.write(f"http://{host}:{port}")
httpd.serve_forever()
PY
MOCK_PID=$!

for _ in $(seq 1 50); do
  if [[ -s "$URL_FILE" ]]; then
    break
  fi
  sleep 0.05
done
if [[ ! -s "$URL_FILE" ]]; then
  echo "mock server failed to start" >&2
  exit 1
fi
export SOLVAPAY_SMOKE_BASE_URL
SOLVAPAY_SMOKE_BASE_URL="$(cat "$URL_FILE")"
echo "==> mock server at $SOLVAPAY_SMOKE_BASE_URL"

echo "==> compile smoke.c"
EXTRA_LIBS=()
case "$(uname -s)" in
  Linux) EXTRA_LIBS+=(-lpthread -ldl -lm) ;;
esac

cc -std=c11 -Wall -Wextra -Werror \
  -I"$CTEST/../include" \
  "$CTEST/smoke.c" \
  -L"$LIB_DIR" \
  -lsolvapay_c \
  "${EXTRA_LIBS[@]}" \
  -o "$SMOKE_BIN"

echo "==> run smoke"
if [[ "$(uname -s)" == "Darwin" ]]; then
  DYLD_LIBRARY_PATH="$LIB_DIR${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" "$SMOKE_BIN"
else
  LD_LIBRARY_PATH="$LIB_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" "$SMOKE_BIN"
fi

echo "OK: C ABI smoke passed"
