# `@example/supabase-edge-mcp`

Full SolvaPay MCP server running on [**Supabase Edge Functions**](https://supabase.com/docs/guides/functions). The same paywalled demo toolbox that ships in [`../mcp-checkout-app`](../mcp-checkout-app) — deployed at the network edge, no Node server, no Express middleware.

- Unified MCP + HTTP factory — [`createSolvaPayMcpFetch`](../../packages/mcp/src/fetch/createSolvaPayMcpFetch.ts) from the `@solvapay/mcp/fetch` subpath (Web-standards `Request`/`Response` handler with the full SolvaPay tool surface + OAuth bridge baked in)
- Underlying MCP server — built via [`buildSolvaPayMcpServer`](../../packages/mcp/src/internal/buildMcpServer.ts) (framework-neutral descriptors + payable handler)
- OAuth bridge — the fetch-first `/oauth/{register,authorize,token,revoke}` routes composed into the unified factory by [`createOAuthFetchRouter`](../../packages/mcp/src/fetch/oauth-bridge.ts)
- Paywalled tools — [`demo-tools.ts`](./supabase/functions/mcp/demo-tools.ts), the two Goldberg stock-predictor Oracle tools (trimmed from `mcp-checkout-app`'s full toolbox)

> **Sibling example:** [`../cloudflare-workers-mcp/`](../cloudflare-workers-mcp/) is the same paywalled toolbox on the Cloudflare Workers runtime. The widget iframe source (`mcp-app.html`, `src/mcp-app.tsx`, `vite.config.ts`, `demo-tools.ts` tool handlers) is byte-for-byte duplicated between the two until we extract a shared package. **Sync edits in both places** if you change the widget or the demo tools.

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
            ├── index.ts                   Deno.serve(createSolvaPayMcpFetch(…))
            ├── demo-tools.ts              paywalled tool handlers (runtime-neutral copy)
            ├── deno.json                  PRODUCTION import map → npm:@solvapay/*@preview
            ├── deno.local.json            CI validate + local serve → same @preview pins
            └── mcp-app.html               build artefact (copied from ../../../dist/)
```

## From scratch (Supabase + Cloudflare proxy + MCPJam)

You need **two** deploys: the MCP function on Supabase, then a
Cloudflare Worker proxy so OAuth discovery works with MCPJam (the raw
`*.supabase.co/functions/v1/mcp` URL has a path component that breaks
RFC 9728 metadata lookup). See
[`../supabase-edge-mcp-proxy/`](../supabase-edge-mcp-proxy/) for why.

### Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli#installation)
- A Supabase project (note the **project ref** from the dashboard URL)
- SolvaPay **secret key** + **product ref** (`prd_…`)
- [Cloudflare account](https://dash.cloudflare.com/) (personal is fine)
- Node + pnpm (from the monorepo root: `pnpm install`)

### 1 — Deploy the Supabase edge function

```bash
cd examples/supabase-edge-mcp
pnpm install

supabase login
supabase link --project-ref <your-project-ref>

# Required secrets. Use a placeholder for MCP_PUBLIC_BASE_URL for now —
# you will update it after the proxy deploy in step 2.
supabase secrets set \
  SOLVAPAY_SECRET_KEY=sk_... \
  SOLVAPAY_PRODUCT_REF=prd_...

# Optional — staging API instead of production:
# supabase secrets set SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com

pnpm build
pnpm deploy
```

Smoke-test the function directly (401 without a token is correct):

```bash
curl -s -X POST "https://<your-project-ref>.supabase.co/functions/v1/mcp" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'
```

### 2 — Deploy the Cloudflare proxy (personal account)

```bash
cd ../supabase-edge-mcp-proxy
pnpm install

pnpm exec wrangler login
pnpm exec wrangler whoami   # note your Account ID

# Set the required env vars (Wrangler reads these from your shell or a
# `.dev.vars` file in the proxy directory):
export SUPABASE_PROJECT_REF=<your-project-ref>
export CLOUDFLARE_ACCOUNT_ID=<your-cloudflare-account-id>

# One-time: register a workers.dev subdomain if wrangler prompts you:
# https://dash.cloudflare.com/<your-account-id>/workers/onboarding

pnpm deploy
# → https://supabase-edge-mcp-proxy.<your-subdomain>.workers.dev
```

### 3 — Point Supabase OAuth metadata at the proxy URL

```bash
cd ../supabase-edge-mcp
supabase secrets set \
  MCP_PUBLIC_BASE_URL=https://supabase-edge-mcp-proxy.<your-subdomain>.workers.dev
pnpm deploy
```

Verify OAuth discovery through the proxy (both must return 200):

```bash
WORKER=https://supabase-edge-mcp-proxy.<your-subdomain>.workers.dev
curl -s "$WORKER/.well-known/oauth-protected-resource" | jq '.resource'
curl -s "$WORKER/.well-known/oauth-authorization-server" | jq '.issuer'
# both should print the workers.dev URL (no /functions/v1/mcp path)
```

### 4 — Connect MCPJam

In MCPJam Inspector:

| Field            | Value                                                          |
| ---------------- | -------------------------------------------------------------- |
| **URL**          | `https://supabase-edge-mcp-proxy.<your-subdomain>.workers.dev` |
| **Auth**         | OAuth                                                          |
| **Protocol**     | `2025-06-18`                                                   |
| **Registration** | Dynamic Client Registration (DCR)                              |

Do **not** use the raw Supabase URL in MCPJam — OAuth discovery will fail.

### Quick reference — what runs where

| Component         | URL                                                 | Purpose                                       |
| ----------------- | --------------------------------------------------- | --------------------------------------------- |
| Supabase function | `https://<ref>.supabase.co/functions/v1/mcp`        | MCP server + OAuth bridge (backend)           |
| Cloudflare proxy  | `https://supabase-edge-mcp-proxy.<sub>.workers.dev` | Root URL for MCP clients + RFC 9728 discovery |
| MCPJam            | proxy URL above                                     | Browser MCP client                            |

## Setup (Supabase only — no MCPJam)

If you only need Cursor / Claude Desktop (native clients), you can skip
the proxy and set `MCP_PUBLIC_BASE_URL` to the Supabase URL:

```bash
supabase secrets set \
  SOLVAPAY_SECRET_KEY=sk_... \
  SOLVAPAY_PRODUCT_REF=prd_... \
  MCP_PUBLIC_BASE_URL=https://<your-project-ref>.supabase.co/functions/v1/mcp
pnpm build && pnpm deploy
```

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

| File                                     | Mode                      | Bare specifier resolution                                                  |
| ---------------------------------------- | ------------------------- | -------------------------------------------------------------------------- |
| `supabase/functions/mcp/deno.json`       | production deploy         | `"@solvapay/mcp": "npm:@solvapay/mcp@preview"` — mutable preview dist-tag  |
| `supabase/functions/mcp/deno.local.json` | CI validate + local serve | same `@preview` pins (checks last-published preview, not workspace source) |

The function source uses bare specifiers only (`import … from '@solvapay/mcp'`, never `'npm:@solvapay/mcp'`) so the import map alone picks the resolution. `supabase functions deploy` picks up `deno.json`; `pnpm validate` and `pnpm serve:local` pass `--config=…/deno.local.json` explicitly so CI type-checks against the last-published `@preview` npm release (one-commit-late regression detection).

## What the function does on each request

`createSolvaPayMcpFetchHandler` is a single `(req: Request) => Promise<Response>` function that internally routes on `new URL(req.url).pathname`:

| Path prefix                                                                                                             | Behaviour                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------- | ----------------------------------------------- |
| `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/.well-known/openid-configuration` | Serves the issuer-scoped OAuth discovery JSON (mirror of `buildOAuthDiscovery()` in `@solvapay/mcp-core`).                                                        |
| `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`                                                  | Proxies to the SolvaPay OAuth backend with byte-verbatim body forwarding (so `+` vs `%20` in form-encoded bodies survives unchanged) and normalised error shapes. |
| `/mcp` (or whatever you set `mcpPath` to)                                                                               | JSON-RPC MCP transport. Bearer-authenticated; 401 + `WWW-Authenticate` challenge on missing/invalid token.                                                        |
| `OPTIONS *`                                                                                                             | CORS preflight. Mirrors `Origin` only when it matches `/^(cursor                                                                                                  | vscode | vscode-webview | claude):\/\/.+$/` — native-scheme clients only. |

See [`packages/mcp-fetch/src/handler.ts`](../../packages/mcp-fetch/src/handler.ts) for the exact implementation.

## Trying the demo tools

Once deployed, any MCP client can list the tools. The demo toolbox is the Goldberg stock-predictor Oracle — two paywalled tools that share a single seeded simulation so their outputs agree for the same ticker:

- `predict_price_chart` — paywalled Oracle: 30 days of history + an N-day forecast with an 80% confidence band as parallel numeric arrays; renders as an interactive line-chart artifact on capable hosts (Claude artifacts, ChatGPT Apps, MCP Inspector).
- `predict_direction` — paywalled Oracle: up/down verdict + confidence score in `[0.5, 0.95]` for the same horizon; renders as a compact verdict card artifact.

Both charge 1 credit per call. When the customer runs out, `content[0].text` narrates "call the `upgrade` tool…" and the host mounts the SolvaPay widget iframe.

To disable the demo tools when using this example as a template:

```bash
supabase secrets set DEMO_TOOLS=false
```

## CI gate

The root [`.github/workflows/publish-preview.yml`](../../.github/workflows/publish-preview.yml) runs `pnpm --filter @example/supabase-edge-mcp validate` as a required gate before publishing `@solvapay/mcp` snapshots. The gate runs `deno check` against this function using the local import map, so **any change that breaks the canonical Supabase Edge consumer blocks the preview publish** — not a test, a type-check under a real Deno binary.

## See also

- [`packages/mcp/src/fetch/`](../../packages/mcp/src/fetch/) — full fetch-first handler reference (the `@solvapay/mcp/fetch` subpath export)
- [`packages/mcp/README.md`](../../packages/mcp/README.md) — the `@modelcontextprotocol/sdk` adapter used inside the handler
- [`examples/mcp-checkout-app/README.md`](../mcp-checkout-app/README.md) — same toolbox, Express transport
- [`examples/supabase-edge/README.md`](../supabase-edge/README.md) — checkout REST functions (the non-MCP companion)
