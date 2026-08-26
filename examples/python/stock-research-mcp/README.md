# Python SDK — stock research MCP

Paywalled MCP server that joins the [Top 5 Stocks](https://top5stocks.netlify.app/api/v1/stocks/public.json)
ranking feed with [Zelothorn](https://zelothorn.com) SEC company data. Educational
market research only. Not financial advice.

The server mounts the SolvaPay OAuth bridge and the twelve built-in SolvaPay
tools (`upgrade`, `manage_account`, `topup`, …) next to six payable research
tools. Customer identity comes from the host's bearer token, not an env var.

## Billing

Each research tool call bills **one unit**, including the composed tools that
fan out to six upstream HTTP requests (`research_top_assets`,
`verify_catalyst_claims`, `detect_stale_rankings`). `company_brief` (one lookup)
and `research_top_assets` (six) are billed the same. `options.units` is accepted
and ignored in V1.

## Tools

| Tool | Upstream calls | What it returns |
| --- | --- | --- |
| `top_ranked_assets` | 1 | Five rows sorted by `selection_score`, plus regime, timestamp, disclaimer |
| `company_brief` | 1 | Verbatim 10-K extract (with a thin/substantive hint), earnings, key filings |
| `research_top_assets` | 6 | Ranked rows each merged with a company brief |
| `verify_catalyst_claims` | 6 | Catalyst text vs four-quarter EPS beats (`corroborated` / `partially_corroborated` / `contradicted`) |
| `detect_stale_rankings` | 6 | Symbols with SEC filings newer than the ranking `last_updated` |
| `compare_symbols` | 1 + N | Side-by-side briefs for arbitrary tickers; ranked-row fields when the symbol is on the list |

`official_final_symbols` is not a separate tool. Pass those five tickers to
`compare_symbols`. A dedicated `official_picks_brief` tool is a reasonable
exercise if you want a one-shot wrapper.

## Demo (mock SolvaPay, live market APIs)

```bash
# from sdks/python-mcp (builds the local PyO3 binding):
uv sync --extra dev
uv run --extra dev --with httpx python ../../examples/python/stock-research-mcp/main.py --mode demo
uv run --extra dev --with httpx python ../../examples/python/stock-research-mcp/main.py --mode demo --gate
```

## Serve (HTTP) and ngrok tunnel

Streamable HTTP on `/mcp` (default `MCP_PORT=3030`) plus OAuth discovery at
`/.well-known/oauth-protected-resource`. This process is the server behind
the reserved origin **`https://appmcp.jack-local.ngrok.app`** (platform ngrok
`mcpapp` → `localhost:3030`). Do not run `mcp-checkout-app` on 3030 at the
same time, and do not use the mcp-proxy wildcard
(`https://<tenant>.local.jack-local.ngrok.app`) — that is a different process
and returns `MCP server not found`.

```bash
cp .env.example .env
# set SOLVAPAY_SECRET_KEY, SOLVAPAY_PRODUCT, SOLVAPAY_API_BASE_URL
# STOCK_RESEARCH_NGROK_URL defaults to https://appmcp.jack-local.ngrok.app

pnpm mcp:stock-research:tunnel
```

In MCPJam, connect to **`https://appmcp.jack-local.ngrok.app/mcp`** and complete
OAuth. Local-only: `pnpm mcp:stock-research` then `http://127.0.0.1:3030/mcp`
(still requires `MCP_PUBLIC_BASE_URL` so discovery documents are correct).

By default the bridge only challenges `tools/call` (`MCP_AUTH_MODE=tools-call`).
Hosts that connect unauthenticated first (MCPJam Auto) treat that as an open
server and never prompt. Set `MCP_AUTH_MODE=all` to 401 every JSON-RPC method,
including `initialize`, so those hosts ask **Continue with OAuth?** at connect.
The MCPJam server-card toggle only reuses stored credentials. Use **Reconnect**
(or remove and re-add the server) to open a consent screen.

## Offline test

```bash
uv run --project ../../sdks/python-mcp --extra dev --with httpx --with uvicorn pytest -q
```
