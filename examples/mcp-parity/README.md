# MCP parity: the same paid MCP server in TypeScript, Python and Go

Three servers with the same behaviour, each built on its own SDK, so you can
connect one MCP client to all three and compare them. Each server has:

- one paid tool, `get_quote`, which returns a made-up price for a ticker and the
  name of the language that answered;
- SolvaPay's built-in `account` and `activate_plan` tools, the checkout widget
  and sign-in, as each SDK ships them.

| Server     | Code                               | Local port | ngrok domain                        |
| ---------- | ---------------------------------- | ---------- | ----------------------------------- |
| TypeScript | `src/index.ts` (`@solvapay/mcp`)   | 3040       | `mcp-ts.<your-subdomain>.ngrok.app` |
| Python     | `python/main.py` (`solvapay[mcp]`) | 3041       | `mcp-py.<your-subdomain>.ngrok.app` |
| Go         | `go/main.go` (`solvapay-sdk/go`)   | 3042       | `mcp-go.<your-subdomain>.ngrok.app` |

All three run the SDK source in this repo, not a published release.

## Set up once

1. In the ngrok dashboard, reserve the three domains in the table.
2. Install the toolchains: Node with pnpm, [uv](https://docs.astral.sh/uv/), and Go 1.26 or later. Then install the dependencies:
   ```bash
   pnpm install                       # repo root
   (cd examples/mcp-parity/python && uv sync)
   ```
3. In `examples/mcp-parity`:
   ```bash
   cp .env.example .env               # key, product, API base, public URLs
   cp ngrok.yml.example ngrok.yml     # your three domains
   ```

   - `SOLVAPAY_API_BASE_URL=http://localhost:3010` points at the local
     platform. The product needs an active plan.
   - Each `*_PUBLIC_BASE_URL` must be exactly the `https://` domain in
     `ngrok.yml`. It is the OAuth issuer clients see, so sign-in fails if they
     differ. `start.sh` checks this.

## Run

```bash
./start.sh              # the three servers and their tunnels
./start.sh ts go        # only some servers
./start.sh --no-ngrok   # servers only, when the tunnels run elsewhere
```

Each output line is prefixed with `[ts]`, `[py]`, `[go]` or `[ngrok]`. Ctrl+C
stops everything. If one process exits, the script stops the rest.

**One ngrok agent at a time?** If your plan allows one agent and the
platform's tunnels are running, the script's ngrok fails to start. Add the
three tunnels from `ngrok.yml.example` to the platform's `ngrok.yml` instead,
restart the platform's tunnels, and use `./start.sh --no-ngrok`.

## Test

1. Run the probe. It checks the steps a client takes before sign-in (OAuth
   metadata, the 401 from `/mcp`, client registration) on all three servers
   and reports any differences:
   ```bash
   node probe.mjs            # through ngrok
   node probe.mjs --local    # straight to the local ports
   ```
2. Add each `https://mcp-<lang>.<your-subdomain>.ngrok.app/mcp` to an MCP
   client (Claude, ChatGPT, MCP Inspector) as a remote server.
3. On each server:
   1. Sign in.
   2. Call `get_quote` until the paywall answers.
   3. Open `account`, pay with a Stripe test card, then call `get_quote` again.

   The answers should match apart from `server`.

## Notes

- Only the Go server reads `.env` without a dotenv library, so keep comments on
  their own lines.
- The TypeScript server serves the widget from the Python package's copy
  (`python/src/solvapay/mcp/mcp-app.html`). CI keeps every copy identical to the
  `mcp-app/` build, so all three servers serve the same file.
