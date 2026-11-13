#!/usr/bin/env bash
# Points the six parity servers at ngrok domains under one suffix: writes
# ngrok.yml and the *_URL lines in .env, and with --reserve reserves the
# domains in your ngrok account first.
#
#   ./setup-ngrok.sh <suffix>             e.g. tommy-local.ngrok.app
#   ./setup-ngrok.sh <suffix> --reserve   also reserve the six domains
#
# The domains are paywall-ts.<suffix>, paywall-py.<suffix>, … agents-go.<suffix>.
# --reserve needs an ngrok API key (dashboard → API → New API key) in
# NGROK_API_KEY; it is passed to ngrok and never written anywhere. Domains you
# already reserved are left alone. Without --reserve, the domains must be
# reserved already (or covered by a wildcard you reserved, *.<suffix>).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

fail() { echo "❌ $*" >&2; exit 1; }

SUFFIX=""
RESERVE=0
for arg in "$@"; do
  case "$arg" in
    --reserve) RESERVE=1 ;;
    -*) fail "Unknown option: $arg" ;;
    *) [ -z "$SUFFIX" ] || fail "One suffix only"; SUFFIX="$arg" ;;
  esac
done
[ -n "$SUFFIX" ] || fail "Usage: ./setup-ngrok.sh <suffix> [--reserve], e.g. tommy-local.ngrok.app"
case "$SUFFIX" in
  https://*|http://*|*/*|.*) fail "The suffix is a bare domain such as tommy-local.ngrok.app" ;;
esac

SERVERS="paywall-ts:3060 paywall-py:3061 paywall-go:3062 agents-ts:3070 agents-py:3071 agents-go:3072"

if [ "$RESERVE" = 1 ]; then
  command -v ngrok >/dev/null || fail "ngrok is not installed: brew install ngrok"
  [ -n "${NGROK_API_KEY:-}" ] || fail "--reserve needs NGROK_API_KEY (dashboard → API → New API key)"
  existing="$(ngrok api reserved-domains list --api-key "$NGROK_API_KEY" --limit 1000 \
    | python3 -c 'import json,sys; print("\n".join(d["domain"] for d in json.load(sys.stdin)["reserved_domains"]))')"
  for entry in $SERVERS; do
    domain="${entry%%:*}.$SUFFIX"
    if printf '%s\n' "$existing" | grep -qx "$domain"; then
      echo "✓ $domain (already reserved)"
    else
      ngrok api reserved-domains create --api-key "$NGROK_API_KEY" --domain "$domain" \
        --description "SolvaPay SDK mcp-parity example" >/dev/null
      echo "✓ $domain (reserved)"
    fi
  done
fi

{
  echo "# Written by setup-ngrok.sh for $SUFFIX. The authtoken stays in ngrok's"
  echo "# own config, or in the platform's ngrok.yml when start.sh attaches to"
  echo "# the platform's running agent."
  echo "version: '3'"
  echo "tunnels:"
  for entry in $SERVERS; do
    name="${entry%%:*}"
    printf '  %s:\n    proto: http\n    addr: %s\n    domain: %s.%s\n' "$name" "${entry##*:}" "$name" "$SUFFIX"
  done
} > ngrok.yml
echo "✓ ngrok.yml"

[ -f .env ] || { cp .env.example .env; echo "✓ .env created from .env.example: fill in the merchant and agent settings"; }
python3 - "$SUFFIX" <<'EOF'
import pathlib, sys
suffix = sys.argv[1]
path = pathlib.Path(".env")
names = ["paywall-ts", "paywall-py", "paywall-go", "agents-ts", "agents-py", "agents-go"]
urls = {f"{n.upper().replace('-', '_')}_URL": f"https://{n}.{suffix}" for n in names}
lines, seen = [], set()
for line in path.read_text().splitlines():
    key = line.split("=", 1)[0].strip()
    if key in urls:
        line, _ = f"{key}={urls[key]}", seen.add(key)
    lines.append(line)
lines += [f"{k}={v}" for k, v in urls.items() if k not in seen]
path.write_text("\n".join(lines) + "\n")
EOF
echo "✓ .env URLs point at *.$SUFFIX"
echo
echo "Next: ./start.sh"
