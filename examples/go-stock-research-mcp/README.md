# Stock research MCP (Go)

The [Python stock research example](../python-stock-research-mcp) ported to the
SolvaPay Go SDK (`github.com/solvapay/solvapay-sdk/go`): the same six paid
research tools, the same recorded fixtures and the same environment, so the two
servers can be compared call for call. Educational market research only, not
financial advice.

Customers sign in with SolvaPay over OAuth (the server forwards each step to
SolvaPay). Every tool call is checked against the customer's plan first: a call
that may go ahead runs and is billed as one unit; one that may not returns the
paywall, with a checkout link. `NewMCPServer` adds SolvaPay's own free tools
next to these: `account` (plan, balance, checkout or top-up) and
`activate_plan`, plus the widget's tools and prompts.

## Tools

| Tool | Upstream calls | Returns |
| --- | --- | --- |
| `top_ranked_assets` | 1 | Five rows by `selection_score`, plus regime, timestamp, disclaimer |
| `company_brief` | 1 | 10-K extract (thin or substantive), earnings, key filings |
| `research_top_assets` | 6 | The ranked rows, each with a company brief |
| `verify_catalyst_claims` | 6 | Each catalyst against four quarters of EPS beats |
| `detect_stale_rankings` | 6 | Symbols with SEC filings newer than the ranking |
| `compare_symbols` | 1 + N | Side-by-side briefs for any tickers |

## Run it

```bash
cp .env.example .env    # then fill it in
go run .                # MCP endpoint: http://localhost:3031/mcp
```

`.env`:

```bash
SOLVAPAY_SECRET_KEY=sk_sandbox_...
SOLVAPAY_PRODUCT_REF=prd_...
SOLVAPAY_API_BASE_URL=https://api.solvapay.com   # or your local stack
PUBLIC_BASE_URL=https://<your-tunnel>.ngrok.app   # where MCP clients reach this server
MARKET_DATA=fixtures                              # optional: recorded data, no live calls
```

`PUBLIC_BASE_URL` must be the URL clients use: it is the OAuth issuer they see,
so sign-in fails if it does not match. In development, tunnel port 3031:

```bash
ngrok http 3031
```

Then add `https://<your-tunnel>.ngrok.app/mcp` to an MCP client as a remote
server. The client opens SolvaPay's sign-in, then can call the tools.

## The SDK version

`go.mod` replaces the SDK with this repo's `go/` module, so the example always
builds against the code next to it (CI builds and tests it on every change).
To run it against a published version instead, drop the `replace` and the
`require`, then fetch the latest release:

```bash
go mod edit -dropreplace github.com/solvapay/solvapay-sdk/go -droprequire github.com/solvapay/solvapay-sdk/go
go get github.com/solvapay/solvapay-sdk/go@latest
go mod tidy
```

Drop the `require` too: it names `v0.0.0`, which was never published.

## Tests

```bash
go test ./...
```

The tests use the recorded market data in `fixtures/` (copied from the Python
example) and a fake SolvaPay API, so they need no keys or network.
