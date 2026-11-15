# MCP parity: paid MCP servers in TypeScript, Python and Go

Two kinds of paid MCP server, each written once per SDK, so you can connect a
client to all of them and compare. Every server has the same tool, `get_quote`,
which returns a made-up price for a ticker and the name of the language that
answered.

- **Paywall (legacy):** customers sign in with SolvaPay, and each call is
  checked against their plan and billed one unit. SolvaPay's `account` and
  `activate_plan` tools and the checkout widget come with it.
- **Agents:** the paywall server with SolvaPay's agent route in front of it
  on the same `/mcp`. An agent that presents a SolvaPay agent token or agent
  key goes to the route: each call is authorized by SolvaPay first (spend
  policy, budget, balance, and the owner's approval when asked), then completed
  at the cost the tool reports (estimate 0.01 USD, cost 0.005 USD). Every other
  caller gets the paywall server. This is how a merchant adds agent payments to
  an existing paid MCP server.

| Server  | TypeScript                  | Python                         | Go                      |
| ------- | --------------------------- | ------------------------------ | ----------------------- |
| Paywall | `src/paywall.ts`, port 3060 | `python/paywall.py`, port 3061 | `go/paywall`, port 3062 |
| Agents  | `src/agents.ts`, port 3070  | `python/agents.py`, port 3071  | `go/agents`, port 3072  |

Each server uses the SDK source in this repo, not a published release:
`@solvapay/mcp` and `@solvapay/agents`, `solvapay[mcp,agents]`, and
`solvapay-sdk/go` with `solvapay-sdk/go/agents`.

## Set up once

1. Install the toolchains: Node with pnpm, [uv](https://docs.astral.sh/uv/),
   and Go 1.26 or later. Then install the dependencies:
   ```bash
   pnpm install                       # repo root
   (cd examples/mcp-parity/python && uv sync)
   ```
2. Point the servers at ngrok, from `examples/mcp-parity`. The script writes
   `ngrok.yml` and the six `*_URL` lines in `.env` (creating `.env` from the
   template if needed), for the domains `paywall-ts.<suffix>` … `agents-go.<suffix>`:
   ```bash
   ./setup-ngrok.sh tommy-local.ngrok.app             # domains already reserved
   NGROK_API_KEY=… ./setup-ngrok.sh tommy-local.ngrok.app --reserve
   ```
   Names nested under an ngrok domain must be reserved before a tunnel can use
   them. `--reserve` does it with an ngrok API key (dashboard → API → New API
   key). The key is passed to ngrok and is not stored anywhere. Domains that are
   already reserved are skipped.
3. Fill in the rest of `.env`.
   - Use a sandbox merchant whose product has an active plan.
   - For the agents servers, the merchant also needs agent payments turned on,
     and `.env` needs its provider reference.
   - Each `*_URL` is the OAuth issuer clients see, so it must match its ngrok
     domain exactly. `start.sh` checks this.

## Run

```bash
./start.sh                     # all six servers and their tunnels
./start.sh paywall             # the three paywall servers
./start.sh agents go           # one server
./start.sh --no-ngrok ...      # no tunnels
```

Each output line is prefixed with the server's name. Ctrl+C stops everything.
If one process exits, the script stops the rest.

**Tunnels.** If an ngrok agent is already running, such as the platform's
with its API on `127.0.0.1:4040`, `start.sh` adds the tunnels to it and removes
them when it stops. That works on plans that allow one agent at a time.
Otherwise it starts its own agent from `ngrok.yml`. If ngrok refuses a domain
(for example, one that isn't reserved), the script stops with ngrok's error.

## Test

1. **Probe.** It sends every server of one kind the same requests and reports
   any differences: the OAuth metadata, the 401 from `/mcp`, and client
   registration. The agents servers also get an agent key SolvaPay never
   issued, which must be refused with a 401.
   ```bash
   node probe.mjs                 # through ngrok
   node probe.mjs --local         # straight to the local ports
   node probe.mjs --local agents  # one kind
   ```
2. **Paywall, as a customer.** Add `https://paywall-<lang>.…/mcp` to an MCP
   client (Claude, ChatGPT, MCP Inspector).
   1. Sign in.
   2. Call `get_quote` until the paywall answers.
   3. Open `account` and pay with a Stripe test card.
   4. Call `get_quote` again.
3. **Agents, as an agent.** Connect an agent with the SolvaPay CLI
   (`npx solvapay@preview connect --api <API base>`). Then call `get_quote` on
   `https://agents-<lang>.…/mcp` with the agent's token or key as the bearer.
   Each call should show in the account console as authorized and settled at
   0.005 USD. To try approvals, set a spend policy that asks.
   - With `AGENT_OAUTH=on`, hosts such as Claude sign in with SolvaPay's agent
     OAuth instead of the customer sign-in.

The answers should match across languages apart from `server`.

## Notes

- `APPROVAL_WAIT_SECONDS` is how long an agent's call waits for its owner.
  Keep it under the MCP client's tool-call timeout (60 seconds by default in
  the TypeScript MCP SDK).
- Only the Go servers read `.env` without a dotenv library, so keep comments on
  their own lines.
- The TypeScript servers serve the widget from the Python package's copy
  (`python/src/solvapay/mcp/mcp-app.html`). CI keeps every copy identical to the
  `mcp-app/` build, so all the servers serve the same file.
