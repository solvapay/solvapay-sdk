#!/bin/sh
# Serves launch-claude-with-solvapay.sh with this clone's public URLs filled in,
# for a tunnel such as shell.<you>.ngrok.app → SHELL_PORT. Only the rendered
# script is served, from data/shell/ (git-ignored).
#
#   shell/serve.sh
#
# Reads from .env: SOLVAPAY_API_BASE_URL and SOLVAPAY_PROVIDER_REF (as the clone
# does), CLONE_PUBLIC_URL (the clone's public origin), ACCOUNT_CONSOLE_URL and
# SHELL_PORT (default 3050).
set -eu

dir=$(cd "$(dirname "$0")/.." && pwd)
env_value() { sed -n "s/^$1=//p" "$dir/.env" | tail -1; }

api=$(env_value SOLVAPAY_API_BASE_URL)
provider=$(env_value SOLVAPAY_PROVIDER_REF)
clone=$(env_value CLONE_PUBLIC_URL)
console=$(env_value ACCOUNT_CONSOLE_URL)
port=$(env_value SHELL_PORT)
port=${port:-3050}

for pair in "SOLVAPAY_API_BASE_URL=$api" "SOLVAPAY_PROVIDER_REF=$provider" \
  "CLONE_PUBLIC_URL=$clone" "ACCOUNT_CONSOLE_URL=$console"; do
  if [ -z "${pair#*=}" ]; then
    echo "${pair%%=*} is not set in $dir/.env" >&2
    exit 1
  fi
done
case "$api" in
  http://localhost* | http://127.*)
    echo "SOLVAPAY_API_BASE_URL is local ($api); remote machines need its public URL" >&2
    exit 1
    ;;
esac

out="$dir/data/shell"
mkdir -p "$out"
sed -e "s|__SOLVAPAY_API__|${api%/}|" \
  -e "s|__OPPER_BASE_URL__|${clone%/}/v3/compat|" \
  -e "s|__SOLVAPAY_PROVIDER_REF__|$provider|" \
  -e "s|__SOLVAPAY_CONSOLE_URL__|${console%/}|" \
  "$dir/shell/launch-claude-with-solvapay.sh" >"$out/launch-claude-with-solvapay.sh"

echo "Serving $out on :$port"
echo "  sh -c \"\$(curl -fsSL <shell tunnel>/launch-claude-with-solvapay.sh)\""
exec python3 -m http.server "$port" --bind 127.0.0.1 --directory "$out"
