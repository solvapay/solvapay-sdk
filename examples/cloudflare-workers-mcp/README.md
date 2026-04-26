# Cloudflare Workers starter for SolvaPay MCP

A minimal fetch-first MCP server that runs on Cloudflare Workers, using the unified `@solvapay/mcp/fetch` factory. One adapter import, one factory call — the Workers isolate answers OAuth, tool calls, widget resource reads, and CSP metadata in a single `fetch` handler.

Ships with a toy paywalled demo toolbox (`predict_price_chart`, `predict_direction` — a seeded stock-predictor oracle) so you can see the full paywall + widget flow end-to-end before plugging in your own tools.

> **Sibling:** [`examples/supabase-edge-mcp/`](../supabase-edge-mcp/) is the same example on the Supabase Edge runtime. The worker entrypoint is the only meaningful difference between the two.

## What you get

- OAuth discovery (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`, `/.well-known/openid-configuration`)
- Bridge routes (`/oauth/{register,authorize,token,revoke}`) backed by SolvaPay's hosted OAuth
- The SolvaPay MCP tool surface (`check_purchase`, `create_payment_intent`, `process_payment`, `upgrade`, `manage_account`, `topup`, …)
- A text-only paywall narration when a paywalled tool is called past the customer's plan limit, routing the LLM to the right recovery intent (`upgrade` / `topup` / `activate_plan`)
- The SolvaPay MCP widget iframe (`ui://cloudflare-workers-mcp/mcp-app.html`) with CSP auto-including your `apiBaseUrl`

## Prerequisites

- Node.js 20+ and pnpm 9.6+ (workspace-managed)
- A SolvaPay account with:
  - A secret key (`sk_…`)
  - A product ref (`prd_…`) — create one in the dashboard under **Products**
- A Cloudflare account with:
  - `wrangler` CLI authenticated (`npx wrangler login`)
  - A zone you control if you want a custom domain (this example's `wrangler.jsonc` targets `mcp-workers-example.solvapay.com` — change the `routes` entry to your own hostname, or drop it entirely and use the default `*.workers.dev` URL)

## Local dev

```bash
# From the monorepo root
pnpm install
pnpm -w build:packages

cd examples/cloudflare-workers-mcp
cp .dev.vars.example .dev.vars
# Fill in SOLVAPAY_SECRET_KEY, SOLVAPAY_PRODUCT_REF in .dev.vars

pnpm build            # Builds src/assets/mcp-app.html via vite
pnpm serve:local      # wrangler dev on http://localhost:8787
```

Then point an MCP client at `http://localhost:8787/`. Good candidates for a first smoke:

- **MCP Inspector** (`npx @modelcontextprotocol/inspector`) — reference client; gives you raw tool/resource call inspection.
- **MCPJam** — hosted web client with a chat UI.
- **Claude Desktop** — edit `claude_desktop_config.json` to add an HTTP MCP server entry.

## Deploy

```bash
# From examples/cloudflare-workers-mcp/
pnpm build

# Set the merchant secret (one-time per Worker)
pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY

# Edit wrangler.jsonc:
#   - `routes[].pattern`  — your hostname (or remove the routes block entirely to serve on *.workers.dev)
#   - `vars.SOLVAPAY_PRODUCT_REF`    — your product ref (prd_…)
#   - `vars.MCP_PUBLIC_BASE_URL`     — the canonical public URL
# SOLVAPAY_API_BASE_URL is not a var — worker.ts defaults to https://api.solvapay.com.
# Override only if you need a different environment:
#   echo "https://api-dev.solvapay.com" | pnpm exec wrangler secret put SOLVAPAY_API_BASE_URL

pnpm deploy
```

### Deploy-time overrides via secrets

Every var in `wrangler.jsonc` can be overridden at runtime by a same-named `wrangler secret put`. Useful when you want to keep the committed `vars` clean (safe defaults, ready to clone) but point a specific Worker at different values:

```bash
# Override committed placeholders without editing wrangler.jsonc
echo "prd_your_real_ref"           | pnpm exec wrangler secret put SOLVAPAY_PRODUCT_REF
echo "https://your-worker.example" | pnpm exec wrangler secret put MCP_PUBLIC_BASE_URL
echo "https://api-dev.solvapay.com"| pnpm exec wrangler secret put SOLVAPAY_API_BASE_URL
```

Secrets are not committed; they persist across `wrangler deploy` runs and can be rotated without a repo change.

## File layout

```
examples/cloudflare-workers-mcp/
├── package.json              // deps: @solvapay/server, @solvapay/mcp; devDeps: wrangler, vite, typescript, …
├── wrangler.jsonc            // Workers config; routes, vars, Text rule for *.html
├── tsconfig.json             // ES2022, Bundler, @cloudflare/workers-types
├── vite.config.ts            // Builds src/mcp-app.tsx -> dist/mcp-app.html (duplicated from supabase-edge-mcp)
├── mcp-app.html              // top-level HTML entry
├── .dev.vars.example
├── .gitignore
└── src/
    ├── worker.ts             // ~60-line entrypoint: createSolvaPayMcpFetch + CORS mirror
    ├── demo-tools.ts         // paywalled demo tools (stock-predictor oracle)
    ├── mcp-app.tsx           // widget entry
    └── assets/
        └── mcp-app.html      // Vite build output (gitignored); imported as text at build
```

## How it wires together

```mermaid
flowchart TD
    Client["MCP client<br/>(Claude / Cursor / MCPJam / Inspector)"]
    Worker["src/worker.ts<br/>(Cloudflare Worker)"]
    Fetch["createSolvaPayMcpFetch<br/>(from @solvapay/mcp/fetch)"]
    Core["buildSolvaPayDescriptors<br/>(from @solvapay/mcp-core, transitive)"]
    API["api.solvapay.com<br/>(OAuth + merchant product)"]

    Client -->|POST /| Worker
    Worker -->|CORS wrap| Fetch
    Fetch --> Core
    Fetch -->|OAuth + payable tool calls| API
```

The whole integration surface is:

```ts
import { createSolvaPay } from '@solvapay/server'
import { createSolvaPayMcpFetch } from '@solvapay/mcp/fetch'

const handler = createSolvaPayMcpFetch({
  solvaPay: createSolvaPay({ apiKey, apiBaseUrl }),
  productRef,
  resourceUri: 'ui://cloudflare-workers-mcp/mcp-app.html',
  readHtml: async () => mcpAppHtml,
  publicBaseUrl,
  apiBaseUrl,
  mode: 'json-stateless',
  hideToolsByAudience: ['ui'],
  additionalTools: registerDemoTools,
})
```

`mode: 'json-stateless'` is required for Workers (isolates don't pin across requests, so sessions can't persist in memory). `hideToolsByAudience: ['ui']` drops UI-only virtual tools (`create_checkout_session`, `process_payment`, …) from `tools/list` so text-only hosts don't reason about transport tools meant for the embedded iframe.

## Swapping in your own tools

The demo tools live entirely in `src/demo-tools.ts` and are not part of any `@solvapay/*` package. Replace the body of `registerDemoTools` with your own `registerPayable(...)` calls, or gate them off entirely by setting `DEMO_TOOLS=false` in `wrangler.jsonc` or `.dev.vars`.

## Widget source sync

The widget iframe payload (`mcp-app.html`, `src/mcp-app.tsx`, `vite.config.ts`) is byte-for-byte copied from [`examples/supabase-edge-mcp/`](../supabase-edge-mcp/). If you change the widget, apply the same edit to both examples until we extract a shared package. A TODO in both READMEs tracks this.

## Known limits

- Bundle size: the Workers free tier caps at 1MB post-gzip. `@modelcontextprotocol/sdk` + `@solvapay/mcp` + `@solvapay/server` sit close to that ceiling. On the paid tier (10MB), there's plenty of headroom.
- Cold start: expect ~50-150ms on the first request per isolate. Warm requests are sub-20ms. Measure for your own geography before committing.

## Upstream

This example lives in the [SolvaPay SDK monorepo](https://github.com/solvapay/solvapay-sdk). File issues, PRs, and `@preview` feedback there. The SDK surfaces it relies on are:

- [`@solvapay/server`](../../packages/server/README.md) — merchant client + paywall runtime
- [`@solvapay/mcp`](../../packages/mcp/README.md) — MCP toolbox; imported at the `./fetch` subpath
- [`@solvapay/mcp-core`](../../packages/mcp-core/README.md) — framework-neutral descriptor builder (transitive; rarely imported directly)
