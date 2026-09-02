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
├── deno.workspace.json                    TYPE-CHECK GATE import map → workspace source
├── src/
│   └── mcp-app.tsx                        iframe entrypoint (copied from mcp-checkout-app)
└── supabase/
    └── functions/
        └── mcp/
            ├── index.ts                   Deno.serve(createSolvaPayMcpFetch(…))
            ├── demo-tools.ts              paywalled tool handlers (runtime-neutral copy)
            ├── deno.json                  PRODUCTION import map → npm:@solvapay/*@preview
            ├── deno.local.json            local serve + post-publish check → @preview pins
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

| Field | Value |
| ----- | ----- |
| **URL** | `https://supabase-edge-mcp-proxy.<your-subdomain>.workers.dev` |
| **Auth** | OAuth |
| **Protocol** | `2025-06-18` |
| **Registration** | Dynamic Client Registration (DCR) |

Do **not** use the raw Supabase URL in MCPJam — OAuth discovery will fail.

### Quick reference — what runs where

| Component | URL | Purpose |
| --------- | --- | ------- |
| Supabase function | `https://<ref>.supabase.co/functions/v1/mcp` | MCP server + OAuth bridge (backend) |
| Cloudflare proxy | `https://supabase-edge-mcp-proxy.<sub>.workers.dev` | Root URL for MCP clients + RFC 9728 discovery |
| MCPJam | proxy URL above | Browser MCP client |

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

### Three import maps, one source file

The function source uses bare specifiers only (`import … from '@solvapay/mcp'`, never `'npm:@solvapay/mcp'`), so the import map alone decides where `@solvapay/*` resolves. Three configs cover three genuinely different jobs:

| File                                     | Job                                            | `@solvapay/*` resolves to                                                        |
| ---------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `supabase/functions/mcp/deno.json`       | production `supabase functions deploy`         | `npm:@solvapay/mcp@preview` — the deployed function must consume published packages |
| `supabase/functions/mcp/deno.local.json` | `pnpm serve:local` + the post-publish CI check  | same `@preview` pins                                                             |
| `deno.workspace.json`                    | `pnpm validate:workspace` — the blocking gate  | workspace source under `packages/*`                                              |

`deno.local.json` stays on `@preview` for `serve:local` because the Supabase CLI runs the function inside a Docker edge runtime that mounts only `supabase/functions` — symlinks escaping to `../../../../packages/*` are unreachable from inside the container.

`deno.workspace.json` gets workspace source by dropping the `@preview` suffix while keeping the `npm:` prefix, under `"nodeModulesDir": "manual"`. Deno then resolves those specifiers through the pnpm symlinks in `node_modules/@solvapay/*` and, because it goes through node-module resolution, honours each package's `exports` map — pairing `dist/*.js` with its sibling `dist/*.d.ts`. Three things about it are load-bearing:

- **It lives at the example root, not beside the other two.** `nodeModulesDir: "manual"` makes Deno look for `node_modules` next to the config file; only at the example root does it find the pnpm-populated tree.
- **`"unstable": ["sloppy-imports"]`.** Resolving through the symlink lands on the real `packages/*/dist` path, which Deno no longer treats as being inside `node_modules` — so it stops mapping the `./chunk-XYZ.js` specifiers that tsup writes into its `.d.ts` files onto their `.d.ts` siblings. Extension probing restores that. Without it the gate reports a cascade of spurious `TS2307`/`TS7031` errors instead of real ones.
- **Do not map to `dist/index.js` file paths instead.** That bypasses `exports` and orphans the `.d.ts`, which is the variant that produced the implicit-any cascade the first time this was attempted.

`manual` also means Deno installs nothing, so every package in the type graph must be a real dependency. That is why `package.json` declares `@modelcontextprotocol/core` and `@modelcontextprotocol/server` (`demo-tools.ts` genuinely imports the latter) and `openai` — the last is not used by any source file here; it is referenced by the type declarations behind `import 'jsr:@supabase/functions-js/edge-runtime.d.ts'`. Under the `@preview` configs Deno fetched these on demand and the gap went unnoticed.

Because the workspace gate reads the branch rather than a dist-tag, a feature branch can prove its SDK change still type-checks under Deno before merging — and the gate cannot deadlock the way a `@preview`-pinned pre-publish gate could.

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

Once deployed, any MCP client can list the tools. The demo toolbox is the Goldberg stock-predictor Oracle — two paywalled tools that share a single seeded simulation so their outputs agree for the same ticker:

- `predict_price_chart` — paywalled Oracle: 30 days of history + an N-day forecast with an 80% confidence band as parallel numeric arrays; renders as an interactive line-chart artifact on capable hosts (Claude artifacts, ChatGPT Apps, MCP Inspector).
- `predict_direction` — paywalled Oracle: up/down verdict + confidence score in `[0.5, 0.95]` for the same horizon; renders as a compact verdict card artifact.

Both charge 1 credit per call. When the customer runs out, `content[0].text`
narrates the current limit, the reason, and "call the `upgrade` tool…" plus a
https URL. **No iframe opens on a gate** — official MCP Apps / 2026-07-28 tools
guidance is that `content` is the model and text-only-host lane, and
`structuredContent` is often hidden from the model when `content` is present.
The LLM reads that copy and, if the user agrees, calls `upgrade` /
`topup` / `activate_plan`, which is the only time a UI host mounts the
SolvaPay widget. Text-only hosts (Claude Code, CLI, n8n) stop at the
narration. See
[`docs/contributing/mcp-apps-host-contract.md`](../../docs/contributing/mcp-apps-host-contract.md).

To disable the demo tools when using this example as a template:

```bash
supabase secrets set DEMO_TOOLS=false
```

## CI gate

This example is type-checked under a real Deno binary in three places — not a test, an actual `deno check`. **Any change that breaks the canonical Supabase Edge consumer blocks the merge.**

| Workflow                                                                     | Step                    | Reads                     |
| ---------------------------------------------------------------------------- | ----------------------- | ------------------------- |
| [`ci.yml`](../../.github/workflows/ci.yml) (every PR)                        | `validate:workspace`    | workspace source          |
| [`publish-preview.yml`](../../.github/workflows/publish-preview.yml) (`dev`)  | `validate:workspace` pre-publish, then `validate` after the npm verification | source, then the published `@preview` tarballs |
| [`publish.yml`](../../.github/workflows/publish.yml) (`main`)                 | `validate:workspace`    | workspace source          |

The workspace gate is the blocking one everywhere, because it checks the code the run is actually shipping. The `@preview` gate runs only *after* `publish-preview.yml` has published and verified the tag: it is the only check that exercises the assembled npm tarballs — their published `exports` maps and peer ranges — rather than workspace `dist/`, but it must not gate the publish. When it did, a broken publish froze the very tag the gate read, so the run that would have fixed it could never get past its own gate.

`publish.yml` has no dist-tag-pinned gate at all: it ships `@latest`, so `@preview` would validate an artifact the run did not produce and `@latest` would validate the previous release.

## See also

- [`packages/mcp/src/fetch/`](../../packages/mcp/src/fetch/) — full fetch-first handler reference (the `@solvapay/mcp/fetch` subpath export)
- [`packages/mcp/README.md`](../../packages/mcp/README.md) — the `@modelcontextprotocol/server` adapter used inside the handler
- [`examples/mcp-checkout-app/README.md`](../mcp-checkout-app/README.md) — same toolbox, Express transport
- [`examples/supabase-edge/README.md`](../supabase-edge/README.md) — checkout REST functions (the non-MCP companion)
