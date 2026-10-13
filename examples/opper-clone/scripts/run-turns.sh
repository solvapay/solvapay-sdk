#!/bin/sh
# Runs N one-sentence Claude Code turns as the SolvaPay agent, one after the
# other, through claude-as-agent.sh. For live runs that need spend to build
# up, such as S6's top-ups:
#
#   scripts/run-turns.sh 15
#   scripts/run-turns.sh 15 "In one short sentence, name a prime number above"
#
# Each turn's prompt ends with its number, so no two are the same. Stops at the
# first turn that fails (the clone's 402 or 422 ends Claude Code with exit 1)
# and says which. From the desktop app's terminal panel, wrap it in env -i as
# claude-as-agent.sh needs.
set -eu

dir=$(cd "$(dirname "$0")" && pwd)
count=${1:-}
case $count in
  '' | *[!0-9]*)
    echo "usage: scripts/run-turns.sh <turns> [prompt]" >&2
    exit 2
    ;;
esac
prompt=${2:-"In one short sentence, give a fact about the number"}

i=1
while [ "$i" -le "$count" ]; do
  printf 'turn %s/%s: ' "$i" "$count"
  if ! "$dir/claude-as-agent.sh" --model sonnet -p "$prompt $i."; then
    echo "turn $i/$count failed; stopping" >&2
    exit 1
  fi
  i=$((i + 1))
done
echo "$count turns done"
