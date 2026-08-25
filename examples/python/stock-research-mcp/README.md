# Python SDK — stock research MCP

Paywalled MCP server that joins the [Top 5 Stocks](https://top5stocks.netlify.app/api/v1/stocks/public.json)
ranking feed with [Zelothorn](https://zelothorn.com) SEC company data. Educational
market research only. Not financial advice.

All six tools are payable. The adapter replaces the host `tools/call` handler, so
there is no free-tool escape hatch.

## Billing

Each tool call bills **one unit**, including the composed tools that fan out to
six upstream HTTP requests (`research_top_assets`, `verify_catalyst_claims`,
`detect_stale_rankings`). `company_brief` (one lookup) and `research_top_assets`
(six) are billed the same. `options.units` is accepted and ignored in V1.

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

## Serve (stdio, real SolvaPay)

```bash
cp .env.example .env
# set SOLVAPAY_SECRET_KEY, SOLVAPAY_CUSTOMER_REF, SOLVAPAY_PRODUCT
uv run --extra dev --with httpx python ../../examples/python/stock-research-mcp/main.py --mode serve
```

Point Cursor / Claude Desktop at that stdio command. Customer identity comes
from `SOLVAPAY_CUSTOMER_REF` via `get_customer_ref` — do not rely on a
`customer_ref` tool argument; hosts drop undeclared fields and the adapter
would otherwise bill `anonymous`.

## Offline test

```bash
uv run --project ../../sdks/python-mcp --extra dev --with httpx pytest -q
```
