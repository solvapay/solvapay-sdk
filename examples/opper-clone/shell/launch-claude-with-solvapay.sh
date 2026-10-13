#!/bin/sh
# Starts Claude Code paying for Opper through SolvaPay: our stand-in for
# `opper launch claude --pay-with solvapay`. Runs on any machine with curl and
# claude; the clone, the SolvaPay API and the console are reached by URL.
#
#   sh -c "$(curl -fsSL https://<shell host>/launch-claude-with-solvapay.sh)"
#   sh launch-claude-with-solvapay.sh -p "say hi"     # arguments pass to claude
#   sh launch-claude-with-solvapay.sh --reset         # forget this machine's agent
#
# The first run signs the owner in by email code, in the terminal, and creates
# an agent; its credential is saved in ~/.solvapay/opper (mode 600) and the
# account session is dropped. Later runs launch straight away. Claude Code
# gets a fresh 15-minute agent token from key-helper.sh, as in
# scripts/claude-as-agent.sh (why each launch flag is there is explained in
# that script).
#
# shell/serve.sh fills in the defaults below from the clone's .env when it
# serves this file; each can be overridden from the environment.
#
# Everything is inside main(), called on the last line, so `curl … | sh` reads
# the whole script before the prompts take over stdin.

main() {
  set -eu

  api=${SOLVAPAY_API:-__SOLVAPAY_API__}
  opper=${OPPER_BASE_URL:-__OPPER_BASE_URL__}
  provider=${SOLVAPAY_PROVIDER_REF:-__SOLVAPAY_PROVIDER_REF__}
  console=${SOLVAPAY_CONSOLE_URL:-__SOLVAPAY_CONSOLE_URL__}
  state=${SOLVAPAY_STATE_DIR:-$HOME/.solvapay/opper}
  api=${api%/}
  opper=${opper%/}
  console=${console%/}

  case "$api$opper$provider$console" in
    *__*) fail "This copy has no URLs filled in. Fetch it from the shell host, or set SOLVAPAY_API, OPPER_BASE_URL, SOLVAPAY_PROVIDER_REF and SOLVAPAY_CONSOLE_URL." ;;
  esac

  if [ "${1:-}" = "--reset" ]; then
    rm -rf "$state"
    say "Removed $state. The agent itself stays until you revoke it at $console/agents"
    exit 0
  fi

  command -v curl >/dev/null 2>&1 || fail "curl is not installed."
  command -v claude >/dev/null 2>&1 ||
    fail "Claude Code is not installed. Install it with: curl -fsSL https://claude.ai/install.sh | bash"

  # A tunnel that is down answers with ngrok's own page, so ask for something
  # only the real service answers.
  curl -fsS -o /dev/null "${opper%/v3/compat}/health" 2>/dev/null ||
    fail "The Opper endpoint ${opper%/v3/compat} is not answering."
  curl -fsS -o /dev/null "$api/v1/agent/jwks.json" 2>/dev/null ||
    fail "The SolvaPay API $api is not answering."

  umask 077
  mkdir -p "$state"
  credential="$state/agent-credential"
  helper="$state/key-helper.sh"

  if [ ! -s "$credential" ]; then
    connect
  fi
  write_helper

  # Fails here, not inside Claude Code, when the agent was revoked.
  if ! "$helper" >/dev/null 2>"$state/helper-error"; then
    fail "This agent can no longer get tokens ($(cat "$state/helper-error")). It may have been revoked at $console/agents. Run with --reset to connect a new one."
  fi

  say "Starting Claude Code on Opper, paid through SolvaPay…"
  settings=$(printf '{"apiKeyHelper":"%s","env":{"ANTHROPIC_BASE_URL":"%s"}}' "$helper" "$opper")
  if [ ! -t 0 ] && has_tty; then
    exec </dev/tty
  fi
  exec env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN \
    claude --setting-sources project,local --settings "$settings" "$@"
}

# Signs the owner in by email code and creates this machine's agent.
connect() {
  has_tty || fail "Connecting needs a terminal for the email code."
  email=${SOLVAPAY_EMAIL:-}
  if [ -z "$email" ]; then
    printf 'Connect this agent to SolvaPay. Your email: ' >/dev/tty
    read -r email </dev/tty
  fi
  case "$email" in
    *@*.*) ;;
    *) fail "That does not look like an email address." ;;
  esac
  case "$email" in
    *'"'* | *'\'* | *' '*) fail "That does not look like an email address." ;;
  esac

  post "/v1/account/auth/logins" "{\"email\":\"$email\"}" >/dev/null
  printf 'We sent a sign-in code to %s. Code: ' "$email" >/dev/tty
  read -r code </dev/tty
  code=$(printf '%s' "$code" | tr -cd '0-9A-Za-z')

  signed_in=$(post "/v1/account/auth/logins/verifications" "{\"email\":\"$email\",\"code\":\"$code\"}")
  session=$(field token "$signed_in")
  [ -n "$session" ] || fail "Sign-in failed."

  host=${HOSTNAME:-$(uname -n)}
  name="Claude Code on ${host%%.*}"
  created=$(post "/v1/account/agents" "{\"providerRef\":\"$provider\",\"name\":\"$name\"}" "$session")
  agent_credential=$(field credential "$created")
  agent=$(field reference "$created")
  principal=$(field principalRef "$created")
  [ -n "$agent_credential" ] || fail "Could not create the agent."

  printf '%s' "$agent_credential" >"$credential"
  printf '{"reference":"%s","principalRef":"%s","name":"%s"}\n' "$agent" "$principal" "$name" >"$state/agent.json"

  say ""
  say "✓ Connected as $agent ($name)."
  say ""
  say "Before it can pay, the owner sets a card and a spend policy for this agent."
  say "Until the console has a card page, on the dev machine, in examples/opper-clone:"
  say "  pnpm agent:connect login $email     (then verify with the code)"
  say "  pnpm agent:connect card --agent $agent"
  say "  pnpm agent:connect policy create 5 --per-call 0.50 --agent $agent"
  say "Approvals: $console/approvals"
  say ""
  if has_tty; then
    printf 'Press Enter when that is done, or now to start anyway. ' >/dev/tty
    read -r _ </dev/tty || true
  fi
}

write_helper() {
  cat >"$helper" <<EOF
#!/bin/sh
# Claude Code apiKeyHelper: prints a fresh SolvaPay agent token.
set -eu
body=\$(curl -fsS -X POST "$api/v1/agent/tokens" \\
  -H "Authorization: Bearer \$(cat "$credential")")
token=\$(printf '%s' "\$body" | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p')
if [ -z "\$token" ]; then
  echo "No agent token in SolvaPay's answer" >&2
  exit 1
fi
printf '%s' "\$token"
EOF
  chmod 700 "$helper"
}

# POST JSON to the SolvaPay API; prints the body, or fails with its message.
post() {
  if [ -n "${3:-}" ]; then
    out=$(curl -sS -w '\n%{http_code}' -X POST "$api$1" -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $3" -d "$2") || fail "Could not reach $api."
  else
    out=$(curl -sS -w '\n%{http_code}' -X POST "$api$1" -H 'Content-Type: application/json' \
      -d "$2") || fail "Could not reach $api."
  fi
  status=$(printf '%s' "$out" | tail -n 1)
  body=$(printf '%s' "$out" | sed '$d')
  case "$status" in
    2??) printf '%s' "$body" ;;
    *) fail "SolvaPay answered $status: $(field message "$body")" ;;
  esac
}

# The first string value of a JSON field; enough for these flat answers.
field() {
  printf '%s' "$2" | tr -d '\n' | grep -o "\"$1\":\"[^\"]*\"" | head -n 1 |
    sed "s/^\"$1\":\"//; s/\"\$//"
}

# A terminal the prompts can use; /dev/tty exists without one under cloud-init or CI.
has_tty() { (: </dev/tty) 2>/dev/null; }

say() { printf '%s\n' "$*" >&2; }
fail() {
  say "launch-claude-with-solvapay: $*"
  exit 1
}

main "$@"
