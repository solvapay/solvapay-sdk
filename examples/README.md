# SolvaPay SDK Examples

Runnable examples by language. Each language subtree holds at least one offline-tested example (redesign §9 / D20).

## Layout

```text
examples/
├── typescript/   # Node / Next / Workers / Supabase / MCP demos (@example/*)
├── python/       # Python binding examples
├── ruby/         # Ruby gem examples
├── go/           # Go module examples
└── rust/         # Rust crate examples
```

## TypeScript

All TypeScript demos live under [`typescript/`](./typescript/). Shared stub utilities: [`typescript/shared/`](./typescript/shared/).

```bash
# from repo root
pnpm install
pnpm build:packages
./examples/typescript/setup-env.sh   # optional .env scaffolding

cd examples/typescript/express-basic && pnpm dev   # keyless — injects a stub apiClient
```

| Example                                                           | Stack                 | Notes                                                         |
| ----------------------------------------------------------------- | --------------------- | ------------------------------------------------------------- |
| [express-basic](./typescript/express-basic)                       | Express               | `payable.http()` paywall; runs keyless via a stub `apiClient` |
| [express-provider-linkage](./typescript/express-provider-linkage) | Express               | Linkage-first: your IdP + `ensureCustomer` before metering    |
| [nextjs-auth0](./typescript/nextjs-auth0)                         | Next.js + Auth0       | Canonical Auth0 `sub` → customer linkage + embedded PAYG      |
| [checkout-demo](./typescript/checkout-demo)                       | Next.js               | Full embedded checkout + Supabase auth                        |
| [hosted-checkout-demo](./typescript/hosted-checkout-demo)         | Next.js               | Redirect checkout + hosted portal                             |
| [shadcn-checkout](./typescript/shadcn-checkout)                   | Next.js + shadcn/ui   | Primitives mapped onto shadcn via `asChild` (port 3012)       |
| [tailwind-checkout](./typescript/tailwind-checkout)               | Next.js + Tailwind v4 | Same four files, styled in userspace (port 3011)              |
| [chat-checkout-demo](./typescript/chat-checkout-demo)             | Vite + Workers        | Streaming chat gated with `payable.gate()`                    |
| [supabase-edge](./typescript/supabase-edge)                       | Deno / Edge           | `@solvapay/server/fetch` one-liners                           |
| [mcp-time-app](./typescript/mcp-time-app)                         | Express MCP           | Smallest UI-enabled MCP app                                   |
| [mcp-oauth-bridge](./typescript/mcp-oauth-bridge)                 | Express MCP           | OAuth bridge for a non-hosted MCP origin                      |
| [mcp-checkout-app](./typescript/mcp-checkout-app)                 | Express MCP           | Full MCP App UI — the canonical reference server              |
| [supabase-edge-mcp](./typescript/supabase-edge-mcp)               | Supabase Edge MCP     | Deno fetch-runtime gate                                       |
| [cloudflare-workers-mcp](./typescript/cloudflare-workers-mcp)     | Workers MCP           | Sibling of supabase-edge-mcp                                  |
| [supabase-edge-mcp-proxy](./typescript/supabase-edge-mcp-proxy)   | Cloudflare Worker     | Root-URL proxy so RFC 9728 discovery works                    |

See each example’s README for setup. Build all workspace examples: `pnpm build:examples`.

## Local platform stack

When pointing an example at a sibling [`platform`](../../platform) monorepo stack,
start from [`.env.platform-local.example`](./.env.platform-local.example). Copy
the vars you need into the target example's own `.env` — each package loads
dotenv from its directory. Use `SOLVAPAY_API_BASE_URL=http://localhost:3010`
(provider-app proxy) and remap MCP/example ports to `3030+` so they don't
collide with platform services. Convenience scripts from the repo root:
`pnpm mcp:checkout` / `pnpm mcp:checkout:tunnel`,
`pnpm mcp:stock-research` / `pnpm mcp:stock-research:tunnel`,
`pnpm mcp:bitcoin-analytics` / `pnpm mcp:bitcoin-analytics:tunnel`, and
`pnpm mcp:guerrillamail` / `pnpm mcp:guerrillamail:tunnel`.

## Python

| Example                                           | Description                                                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [stock-research-mcp](./python/stock-research-mcp) | Paywalled MCP tools joining a ranked watchlist with SEC company data. Ngrok via `pnpm mcp:stock-research:tunnel` |

```bash
cd examples/python/stock-research-mcp
uv run --project ../../sdks/python-mcp --extra dev --with uvicorn pytest -q
```

## Ruby

| Example                                               | Description                                                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [bitcoin_analytics_mcp](./ruby/bitcoin_analytics_mcp) | Paywalled MCP tools composing Bitcoin halving, mempool.space, and btcnode data. Ngrok via `pnpm mcp:bitcoin-analytics:tunnel` |

```bash
cd sdks/ruby-mcp
bundle exec ruby -Ilib ../../examples/ruby/bitcoin_analytics_mcp/test/run.rb
```

## Go

| Example                         | Description                                                                 |
| ------------------------------- | --------------------------------------------------------------------------- |
| [weather-mcp](./go/weather-mcp) | Paywalled Open-Meteo weather tools; HTTP OAuth for MCPJam (`go test ./...`) |

```bash
cd examples/go/weather-mcp && go test ./...
```

## Rust

| Example                                       | Description                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [guerrillamail-mcp](./rust/guerrillamail-mcp) | Paywalled disposable-inbox MCP over Guerrilla Mail. Ngrok via `pnpm mcp:guerrillamail:tunnel` |

```bash
cargo test --manifest-path examples/rust/guerrillamail-mcp/Cargo.toml
```
