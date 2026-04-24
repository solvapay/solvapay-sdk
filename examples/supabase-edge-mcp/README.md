# `@example/supabase-edge-mcp`

Full SolvaPay MCP server running on [**Supabase Edge Functions**](https://supabase.com/docs/guides/functions). The same paywalled demo toolbox that ships in [`../mcp-checkout-app`](../mcp-checkout-app) — deployed at the network edge, no Node server, no Express middleware.

- HTTP transport — [`createSolvaPayMcpFetchHandler`](../../packages/mcp-fetch/src/handler.ts) (Web-standards `Request`/`Response`)
- MCP server — [`createSolvaPayMcpServer`](../../packages/mcp/src/server.ts) (framework-neutral descriptors + payable handler)
- OAuth bridge — the fetch-first `/oauth/{register,authorize,token,revoke}` routes from [`@solvapay/mcp-fetch`](../../packages/mcp-fetch)
- Paywalled tools — [`demo-tools.ts`](./supabase/functions/mcp/demo-tools.ts), byte-for-byte copy of `mcp-checkout-app`'s toolbox

## Why this example exists

The plain [`../supabase-edge/`](../supabase-edge/) example hosts the checkout/billing REST surface — `POST /check-purchase`, `POST /create-payment-intent`, etc. This example sits one abstraction up: it hosts an MCP server that _paywalls arbitrary tools_, served from Supabase Edge in a single turnkey handler. If you're building an MCP-accessible product (Claude skills, Cursor tools, ChatGPT apps), this is the shape.

## Layout

```
examples/supabase-edge-mcp/
├── README.md                              this file
├── .env.example                           Supabase secret names (not a filesystem .env)
├── package.json                           vite + validate + deploy scripts
├── vite.config.ts                         single-file iframe bundle
├── mcp-app.html                           iframe chrome (bundled)
├── src/
│   └── mcp-app.tsx                        iframe entrypoint (copied from mcp-checkout-app)
└── supabase/
    └── functions/
        └── mcp/
            ├── index.ts                   Deno.serve(createSolvaPayMcpFetchHandler(…))
            ├── demo-tools.ts              paywalled tool handlers (runtime-neutral copy)
            ├── deno.json                  PRODUCTION import map → npm:@solvapay/*
            ├── deno.local.json            LOCAL-DEV import map → file:../../../../packages/*
            └── mcp-app.html               build artefact (copied from ../../../dist/)
```

## Setup

```bash
# 1. Install the Supabase CLI — pick the method that fits your OS.
#    https://supabase.com/docs/guides/cli#installation

# 2. Link this example to your Supabase project.
cd examples/supabase-edge-mcp
supabase login
supabase link --project-ref <your-project-ref>

# 3. Set the required secrets on your Supabase project.
supabase secrets set \
  SOLVAPAY_SECRET_KEY=sk_live_... \
  SOLVAPAY_PRODUCT_REF=prod_... \
  MCP_PUBLIC_BASE_URL=https://<your-project-ref>.supabase.co/functions/v1/mcp

# 4. Build the iframe bundle + deploy the function.
pnpm build
pnpm deploy
```

The function is now live at `https://<your-project-ref>.supabase.co/functions/v1/mcp`. Point any MCP client at that URL as the server endpoint.

## Local development loop

```bash
# Type-check the function against the LOCAL workspace via the
# dev-only import map. This is exactly what CI runs.
pnpm validate

# Optional — boot the function under the real Supabase CLI runtime
# and poke at it with curl.
pnpm serve:local &
sleep 3
curl -s http://localhost:54321/functions/v1/mcp/.well-known/oauth-authorization-server \
  | jq '.issuer'
# → "http://localhost:54321/functions/v1/mcp"
```

### Two import maps, one source file

The function ships with **two** deno.json files side by side:

| File                                      | Mode        | Bare specifier resolution                                       |
| ----------------------------------------- | ----------- | --------------------------------------------------------------- |
| `supabase/functions/mcp/deno.json`        | production  | `"@solvapay/mcp": "npm:@solvapay/mcp"` — published npm releases |
| `supabase/functions/mcp/deno.local.json`  | local dev   | `"@solvapay/mcp": "file:../../../../packages/mcp/dist/index.js"` |

The function source uses bare specifiers only (`import … from '@solvapay/mcp'`, never `'npm:@solvapay/mcp'`) so the import map alone picks the resolution. `supabase functions deploy` picks up `deno.json`; `pnpm validate` and `pnpm serve:local` pass `--import-map=…/deno.local.json` explicitly so you're always type-checking against the current workspace source, not the last-published npm release.

## What the function does on each request

`createSolvaPayMcpFetchHandler` is a single `(req: Request) => Promise<Response>` function that internally routes on `new URL(req.url).pathname`:

| Path prefix                                                    | Behaviour                                                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/.well-known/openid-configuration` | Serves the issuer-scoped OAuth discovery JSON (mirror of `buildOAuthDiscovery()` in `@solvapay/mcp-core`). |
| `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`  | Proxies to the SolvaPay OAuth backend with byte-verbatim body forwarding (so `+` vs `%20` in form-encoded bodies survives unchanged) and normalised error shapes. |
| `/mcp` (or whatever you set `mcpPath` to)                      | JSON-RPC MCP transport. Bearer-authenticated; 401 + `WWW-Authenticate` challenge on missing/invalid token. |
| `OPTIONS *`                                                    | CORS preflight. Mirrors `Origin` only when it matches `/^(cursor|vscode|vscode-webview|claude):\/\/.+$/` — native-scheme clients only. |

See [`packages/mcp-fetch/src/handler.ts`](../../packages/mcp-fetch/src/handler.ts) for the exact implementation.

## Trying the demo tools

Once deployed, any MCP client can list the tools. The demo toolbox includes:

- `search_knowledge` — paywalled search against a deterministic stub corpus
- `get_market_quote` — paywalled deterministic quote for a ticker symbol
- `query_sales_trends` — paywalled sales rows that attach a `low-balance` upsell nudge when the customer is close to running out
- `predict_price_chart` — paywalled Oracle: history + forecast numeric arrays for an interactive line-chart artifact
- `predict_direction` — paywalled Oracle: up/down verdict with a confidence score for a card artifact

To disable the demo tools when using this example as a template:

```bash
supabase secrets set DEMO_TOOLS=false
```

## CI gate

The root [`.github/workflows/publish-preview.yml`](../../.github/workflows/publish-preview.yml) runs `pnpm --filter @example/supabase-edge-mcp validate` as a required gate before publishing `@solvapay/mcp-fetch` snapshots. The gate runs `deno check` against this function using the local import map, so **any change that breaks the canonical Supabase Edge consumer blocks the preview publish** — not a test, a type-check under a real Deno binary.

## See also

- [`packages/mcp-fetch/README.md`](../../packages/mcp-fetch/README.md) — full fetch-first handler reference
- [`packages/mcp/README.md`](../../packages/mcp/README.md) — the `@modelcontextprotocol/sdk` adapter used inside the handler
- [`examples/mcp-checkout-app/README.md`](../mcp-checkout-app/README.md) — same toolbox, Express transport
- [`examples/supabase-edge/README.md`](../supabase-edge/README.md) — checkout REST functions (the non-MCP companion)
