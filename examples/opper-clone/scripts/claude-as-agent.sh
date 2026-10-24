#!/bin/sh
# Runs Claude Code as the SolvaPay agent saved in data/agent-credential, with
# its model calls going to this clone. Arguments pass through to `claude`:
#
#   scripts/claude-as-agent.sh -p "Research X and write a brief"
#   scripts/claude-as-agent.sh            # interactive
#
# Why each part (apiKeyHelper spike, S2.6, 8 Oct 2026):
# - Claude Code uses ANTHROPIC_AUTH_TOKEN, then ANTHROPIC_API_KEY, and only then
#   apiKeyHelper. Both variables are removed from the environment here.
# - A settings file's `env` overwrites the shell, so ~/.claude/settings.json can
#   reintroduce ANTHROPIC_API_KEY; `--setting-sources project,local` leaves user
#   settings out. Without it, every call carries the user's own key and Claude
#   Code burns its whole retry budget on 401s.
# - The helper's output is cached for CLAUDE_CODE_API_KEY_HELPER_TTL_MS (default
#   5 min), below the agent token's 15 min, and is re-run on a 401.
set -eu

dir=$(cd "$(dirname "$0")/.." && pwd)
port=$(sed -n 's/^PORT=//p' "$dir/.env" | tail -1)
if [ -z "$port" ]; then
  echo "PORT is not set in $dir/.env" >&2
  exit 1
fi

settings=$(printf '{"apiKeyHelper":"%s/scripts/api-key-helper.sh","env":{"ANTHROPIC_BASE_URL":"http://localhost:%s/v3/compat"}}' "$dir" "$port")

exec env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
  claude --setting-sources project,local --settings "$settings" "$@"
