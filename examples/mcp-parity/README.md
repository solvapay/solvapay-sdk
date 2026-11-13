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

1. In the ngrok dashboard, reserve one domain per server. The templates use
   `paywall-ts`, `paywall-py`, `paywall-go`, `agents-ts`, `agents-py` and
   `agents-go` under your subdomain.
2. Install the toolchains: Node with pnpm, [uv](https://docs.astral.sh/uv/),
   and Go 1.26 or later. Then install the dependencies:
   ```bash
   pnpm install                       # repo root
   (cd examples/mcp-parity/python && uv sync)
   ```
3. In `examples/mcp-parity`:
   ```bash
   cp .env.example .env               # merchant, agent settings, public URLs
   cp ngrok.yml.example ngrok.yml     # your domains
   ```

   - Use a sandbox merchant whose product has an active plan. For the agents
     servers, the merchant also needs agent payments turned on, and you need
     its provider reference.
   - Each `*_URL` must be exactly the `https://` domain in `ngrok.yml`. It is
     the OAuth issuer clients see, so sign-in fails if they differ.
     `start.sh` checks this.

## Run

```bash
./start.sh                     # all six servers and their tunnels
./start.sh paywall             # the three paywall servers
./start.sh agents go           # one server
./start.sh --no-ngrok ...      # no tunnels (they run elsewhere)
```

Each output line is prefixed with the server's name. Ctrl+C stops everything.
If one process exits, the script stops the rest.

**One ngrok agent at a time?** If your plan allows one agent and the
platform's tunnels are running, the script's ngrok fails to start. Add the
tunnels from `ngrok.yml.example` to the platform's `ngrok.yml` instead,
restart the platform's tunnels, and use `./start.sh --no-ngrok`.

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
