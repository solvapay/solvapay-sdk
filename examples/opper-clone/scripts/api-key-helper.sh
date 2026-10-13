#!/bin/sh
# Claude Code apiKeyHelper: prints a fresh SolvaPay agent token, minted from
# the agent credential in data/agent-credential (see scripts/connect-agent.ts).
# Claude Code sends the output as its API key to ANTHROPIC_BASE_URL (the clone).
set -eu

dir=$(cd "$(dirname "$0")/.." && pwd)
credential_file="$dir/data/agent-credential"
if [ ! -s "$credential_file" ]; then
  echo "No agent credential in $credential_file. Run: pnpm agent:connect login <email>" >&2
  exit 1
fi

base=$(sed -n 's/^SOLVAPAY_API_BASE_URL=//p' "$dir/.env" | tail -1)
if [ -z "$base" ]; then
  echo "SOLVAPAY_API_BASE_URL is not set in $dir/.env" >&2
  exit 1
fi

curl -fsS -X POST "${base%/}/v1/agent/tokens" \
  -H "Authorization: Bearer $(cat "$credential_file")" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).token))'
