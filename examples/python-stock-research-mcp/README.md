# Stock research MCP (Python)

A paid MCP server built with the `solvapay` Python SDK. Six research tools join
the [Top 5 Stocks](https://top5stocks.netlify.app/api/v1/stocks/public.json)
ranking feed with [Zelothorn](https://zelothorn.com) SEC company data. Educational
market research only, not financial advice.

Customers sign in with SolvaPay over OAuth (the server forwards each step to
SolvaPay). Every tool call is checked against the customer's plan first: a call
that may go ahead runs and is billed as one unit; one that may not returns the
paywall, with a checkout link.

## Tools

| Tool | Upstream calls | Returns |
| --- | --- | --- |
| `top_ranked_assets` | 1 | Five rows by `selection_score`, plus regime, timestamp, disclaimer |
| `company_brief` | 1 | 10-K extract (thin or substantive), earnings, key filings |
| `research_top_assets` | 6 | The ranked rows, each with a company brief |
| `verify_catalyst_claims` | 6 | Each catalyst against four quarters of EPS beats |
| `detect_stale_rankings` | 6 | Symbols with SEC filings newer than the ranking |
| `compare_symbols` | 1 + N | Side-by-side briefs for any tickers |

Every call bills one unit, whatever its upstream fan-out.

`create_solvapay_mcp_server` adds SolvaPay's built-in tools next to these, free
to call: `account` (the customer's plan, balance and checkout or top-up link)
and `activate_plan`, plus the `/upgrade`, `/manage_account`, `/topup` and
`/activate_plan` prompts. A paywall message names `account` as the way to pay.

## Run it

```bash
uv sync
cp .env.example .env    # then fill it in
uv run python main.py   # MCP endpoint: http://localhost:3030/mcp
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
so sign-in fails if it does not match. In development, tunnel port 3030:

```bash
ngrok http 3030
```

Then add `https://<your-tunnel>.ngrok.app/mcp` to an MCP client as a remote
server. The client opens SolvaPay's sign-in, then can call the tools.

## Tests

```bash
uv run pytest
```

The tests use the recorded market data in `fixtures/` and a mocked SolvaPay
API, so they need no keys or network.

Ported from the Rust-core track's example: the research code (`analysis.py`,
`market_data.py`, `http_market_data.py`, fixtures and their tests) is
unchanged; `tools.py` and `main.py` are rewritten for this SDK.
