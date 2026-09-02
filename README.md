# SolvaPay SDK

[![npm version](https://img.shields.io/npm/v/@solvapay/server.svg)](https://www.npmjs.com/package/@solvapay/server)
[![preview](https://img.shields.io/npm/v/@solvapay/server/preview?label=preview)](https://www.npmjs.com/package/@solvapay/server?activeTab=versions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Monetize APIs, AI agents, and MCP servers — paywall protection, checkout UI, and purchase management. One Rust semantic core, five language surfaces: TypeScript, Python, Ruby, Go, and Rust.

**Configure** with `npx solvapay init` or `npm create solvapay -- --type mcp` · **Integrate** with Express, Next.js, Supabase Edge, or MCP · **Monetize** with paywalls, checkout, and usage metering.

## Language surfaces

| Language          | Packages                          | Status                                  |
| ----------------- | --------------------------------- | --------------------------------------- |
| TypeScript / Node | `solvapay` CLI, `@solvapay/*`     | Published on npm                        |
| Python            | `solvapay`, `solvapay-mcp`        | Built and tested — not yet on PyPI      |
| Ruby              | `solvapay`, `solvapay-mcp`        | Built and tested — not yet on RubyGems  |
| Go                | `github.com/solvapay/solvapay-go` | Built and tested — not yet published    |
| Rust              | `solvapay`                        | Built and tested — not yet on crates.io |

Only the TypeScript surface can be installed from a registry today. The other four are built, tested, and exercised by the shared conformance fixtures in this repo, but their release trains have not pushed production tags yet — so `pip install solvapay`, `gem install solvapay`, `cargo add solvapay`, and `go get github.com/solvapay/solvapay-go` do **not** resolve. To use them now, clone this repo and depend on the in-tree path. See [`docs/publishing.mdx`](./docs/publishing.mdx) for the release train.

- [`docs/platform-support.mdx`](./docs/platform-support.mdx) — wheel, gem, and ABI coverage per platform
- [`docs/contributing/architecture.md`](./docs/contributing/architecture.md) — the Rust core and how each surface delegates to it

## Quickstart (TypeScript)

### Existing project — auth + env

```bash
npx solvapay init
```

### New paid MCP app (recommended)

```bash
npm create solvapay@latest my-mcp-app -- --type mcp
```

### Try an example (no API key)

```bash
git clone https://github.com/solvapay/solvapay-sdk
cd solvapay-sdk && pnpm install && pnpm build
cd examples/typescript/express-basic && pnpm dev   # keyless — injects a stub apiClient
```

### Skills for coding agents

> **Using Claude Code, Codex, Cursor, or other AI coding agents?**
>
> Install the [SolvaPay skills](https://docs.solvapay.com/guides/use-agent-skill) and describe what you want to build — the router picks the right workflow (MCP app, SDK integration, checkout, etc.).
>
> ```bash
> npx skills add solvapay/skills
> ```

## Integration paths

| Path                  | Entry                                                 | Packages                                                     | Example                                                            | Docs                                                                                                                                |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Express API           | `npx solvapay init`                                   | `@solvapay/server`                                           | [express-basic](./examples/typescript/express-basic)               | [Express](https://docs.solvapay.com/sdks/typescript/guides/express)                                                                 |
| Next.js checkout      | `npx solvapay init`                                   | `@solvapay/next` + `@solvapay/react`                         | [checkout-demo](./examples/typescript/checkout-demo)               | [Next.js](https://docs.solvapay.com/sdks/typescript/guides/nextjs), [React](https://docs.solvapay.com/sdks/typescript/guides/react) |
| Hosted checkout       | `npx solvapay init`                                   | `@solvapay/next`                                             | [hosted-checkout-demo](./examples/typescript/hosted-checkout-demo) | [Purchase management](https://docs.solvapay.com/sdks/typescript/guides/purchase-management)                                         |
| Supabase Edge         | `npx solvapay init`                                   | `@solvapay/server/fetch` + `@solvapay/react`                 | [supabase-edge](./examples/typescript/supabase-edge)               | [Supabase Edge](https://docs.solvapay.com/sdks/typescript/guides/supabase-edge)                                                     |
| MCP app (server + UI) | **`npm create solvapay@latest <name> -- --type mcp`** | `@solvapay/mcp` + `@solvapay/react/mcp` + `@solvapay/server` | scaffold template                                                  | [MCP](https://docs.solvapay.com/sdks/typescript/guides/mcp), [MCP app](https://docs.solvapay.com/sdks/typescript/guides/mcp-app)    |
| MCP App UI (advanced) | manual on existing server                             | `@solvapay/mcp` + `@solvapay/react/mcp`                      | [mcp-checkout-app](./examples/typescript/mcp-checkout-app)         | [MCP app](https://docs.solvapay.com/sdks/typescript/guides/mcp-app)                                                                 |
| Existing MCP server   | `npx solvapay init`                                   | `@solvapay/server` + `@solvapay/mcp-core`                    | [mcp-oauth-bridge](./examples/typescript/mcp-oauth-bridge)         | [MCP](https://docs.solvapay.com/sdks/typescript/guides/mcp)                                                                         |

## Packages

Published on npm today:

| Package                                                        | Purpose                                      |
| -------------------------------------------------------------- | -------------------------------------------- |
| [`solvapay`](./tools/cli)                                      | CLI — `npx solvapay init` for existing repos |
| [`create-solvapay`](./tools/create-solvapay)                   | Scaffold new MCP apps                        |
| [`@solvapay/init`](./tools/init)                               | CLI internals shared by the two above        |
| [`@solvapay/server`](./sdks/typescript/server)                 | Paywall, API client, webhooks (Node + Edge)  |
| [`@solvapay/react`](./sdks/typescript/react)                   | Headless checkout UI and hooks               |
| [`@solvapay/next`](./sdks/typescript/next)                     | Next.js API route helpers                    |
| [`@solvapay/mcp`](./sdks/typescript/mcp)                       | Official MCP SDK adapter                     |
| [`@solvapay/mcp-core`](./sdks/typescript/mcp-core)             | Framework-neutral MCP contracts              |
| [`@solvapay/auth`](./sdks/typescript/auth)                     | Auth adapters                                |
| [`@solvapay/react-supabase`](./sdks/typescript/react-supabase) | Supabase auth for React                      |
| [`@solvapay/core`](./sdks/typescript/core)                     | Shared types and utilities                   |

Each package README is the npm landing page for that surface.

Two more npm packages exist in-repo but have not shipped yet: `@solvapay/server-native` (plus its eight platform packages) and `@solvapay/server-wasm`. Both must reach npm before, or in the same batch as, the next `@solvapay/server` release that depends on them — the ordering constraint and the gate that enforces it are documented in [`docs/publishing.mdx`](./docs/publishing.mdx).

Under the hood, shared SDK behavior lives in a Rust semantic core that every language surface delegates to. These five crates are internal dependencies of the public `solvapay` facade:

| Crate                                             | Purpose                                                       |
| ------------------------------------------------- | ------------------------------------------------------------- |
| [`solvapay-export`](./core/solvapay-export)       | Inert `#[solvapay_export]` marker scanned by codegen          |
| [`solvapay-dto`](./core/solvapay-dto)             | Generated wire DTOs                                           |
| [`solvapay-core`](./core/solvapay-core)           | Pure SDK logic — no HTTP, no tokio, no wasm-bindgen           |
| [`solvapay-mcp-core`](./core/solvapay-mcp)        | Descriptors, OAuth, auth gate, JSON-RPC engine                |
| [`solvapay-transport`](./core/solvapay-transport) | HTTP `Transport` trait, native reqwest/rustls, and WASM Fetch |

See [`docs/contributing/architecture.md`](./docs/contributing/architecture.md) for the as-built architecture.

## Usage at a glance

Every surface exposes the same two-arm gate: **allow** (run the handler, then record usage) or **paywall** (return structured 402 content). Python and Ruby also ship a handler wrapper that raises on the paywall arm; Go and Rust are gate-plus-match by design.

### TypeScript

**Server paywall** — see [`@solvapay/server`](./sdks/typescript/server/README.md):

```typescript
import { createSolvaPay } from '@solvapay/server'

const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY })
const payable = solvaPay.payable({ product: 'prd_YOUR_PRODUCT' })

app.post('/tasks', payable.http(handler)) // Express
export const POST = payable.next(handler) // Next.js App Router
```

**Client checkout** — see [`@solvapay/react`](./sdks/typescript/react/README.md):

```tsx
import { SolvaPayProvider, CheckoutLayout } from '@solvapay/react'
;<SolvaPayProvider>
  <CheckoutLayout productRef="prd_myapi" prefillCustomer={{ email }} />
</SolvaPayProvider>
```

**Next.js API routes** — see [`@solvapay/next`](./sdks/typescript/next/README.md) (not duplicated here).

**Supabase Edge** — one-liner handlers via [`@solvapay/server/fetch`](./sdks/typescript/server/README.md#web-standards-runtimes--solvapayserverfetch-subpath).

### Python

```python
import os
from solvapay import create_solvapay

sp = create_solvapay(api_key=os.environ["SOLVAPAY_SECRET_KEY"])

# Handler wrapper — raises PaywallError instead of running the body when gated
@sp.payable(product="prd_YOUR_PRODUCT")
async def create_task(args: dict) -> str:
    return "ok"

await create_task({"auth": {"customer_ref": "cus_abc"}})

# Or gate manually
result = await sp.gate("cus_abc", product="prd_YOUR_PRODUCT")
if result.kind == "allow":
    result.track_success(duration=12)
```

`sp.gate_blocking(...)` is the synchronous equivalent.

### Ruby

```ruby
require "solvapay"

sp = SolvaPay.create(api_key: ENV.fetch("SOLVAPAY_SECRET_KEY"))

# Handler wrapper — raises SolvaPay::PaywallError instead of running the block when gated
create_task = sp.payable(product: "prd_YOUR_PRODUCT").protect { |value:, **| value * 2 }
create_task.call(value: 3, customer_ref: "cus_123")

# Or gate manually
result = sp.gate("cus_123", product: "prd_YOUR_PRODUCT")
result.track_success(duration: 12) if result.is_a?(SolvaPay::PayableAllowResult)
```

### Go

```go
import solvapay "github.com/solvapay/solvapay-go"

client, err := solvapay.NewClient(ctx, os.Getenv("SOLVAPAY_SECRET_KEY"))
if err != nil {
    return err
}
defer client.Close(ctx)

out, err := client.Gate(ctx, "cus_abc", solvapay.GateOpts{Product: "prd_YOUR_PRODUCT"})
if err != nil {
    return err
}
switch outcome := out.(type) {
case *solvapay.Allow:
    // run the handler, then record usage
    return outcome.TrackSuccess(ctx, solvapay.TrackOpts{})
case *solvapay.Paywall:
    // write a 402 from outcome.Gate — the structured content, verbatim
}
```

`client.Payable(product, usageType).Gate(ctx, customerRef)` binds the product once.

### Rust

```rust
use solvapay::{Client, Config, GateOutcome, TrackOpts};

let client = Client::new(Config {
    api_key: std::env::var("SOLVAPAY_SECRET_KEY")?,
    ..Config::default()
})?;

match client.payable("prd_YOUR_PRODUCT", "requests").gate("cus_abc").await? {
    GateOutcome::Allow(allow) => {
        // run the handler, then record usage
        allow.track_success(TrackOpts::default()).await?;
    }
    GateOutcome::Paywall(gate) => {
        // render a 402 from `gate` — the structured content, verbatim
    }
}
```

A blocking facade (`solvapay::blocking`) mirrors the async one.

## Examples

TypeScript:

| Example                                                                    | Stack                 | Notes                                                         |
| -------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------- |
| [express-basic](./examples/typescript/express-basic) †                     | Express               | `payable.http()` paywall; runs keyless via a stub `apiClient` |
| [express-provider-linkage](./examples/typescript/express-provider-linkage) | Express               | Linkage-first: your IdP + `ensureCustomer` before metering    |
| [nextjs-auth0](./examples/typescript/nextjs-auth0)                         | Next.js + Auth0       | Canonical Auth0 `sub` → customer linkage + embedded PAYG      |
| [checkout-demo](./examples/typescript/checkout-demo)                       | Next.js               | Full embedded checkout + Supabase auth                        |
| [hosted-checkout-demo](./examples/typescript/hosted-checkout-demo)         | Next.js               | Redirect checkout + hosted portal                             |
| [shadcn-checkout](./examples/typescript/shadcn-checkout) †                 | Next.js + shadcn/ui   | Primitives mapped onto shadcn via `asChild` (port 3012)       |
| [tailwind-checkout](./examples/typescript/tailwind-checkout) †             | Next.js + Tailwind v4 | Same four files, styled in userspace (port 3011)              |
| [chat-checkout-demo](./examples/typescript/chat-checkout-demo)             | Vite + Workers        | Streaming chat gated with `payable.gate()`                    |
| [supabase-edge](./examples/typescript/supabase-edge)                       | Deno / Edge           | `@solvapay/server/fetch` one-liners                           |
| [mcp-time-app](./examples/typescript/mcp-time-app)                         | Express MCP           | Smallest UI-enabled MCP app                                   |
| [mcp-oauth-bridge](./examples/typescript/mcp-oauth-bridge)                 | Express MCP           | OAuth bridge for a non-hosted MCP origin                      |
| [mcp-checkout-app](./examples/typescript/mcp-checkout-app)                 | Express MCP           | Full MCP App UI — the canonical reference server              |
| [supabase-edge-mcp](./examples/typescript/supabase-edge-mcp)               | Supabase Edge MCP     | Deno fetch-runtime gate                                       |
| [cloudflare-workers-mcp](./examples/typescript/cloudflare-workers-mcp)     | Workers MCP           | Sibling of supabase-edge-mcp                                  |
| [supabase-edge-mcp-proxy](./examples/typescript/supabase-edge-mcp-proxy)   | Cloudflare Worker     | Root-URL proxy so RFC 9728 discovery works                    |

Python, Ruby, Go, and Rust:

| Example                                                             | Description                                                                                                                   |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [python/stock-research-mcp](./examples/python/stock-research-mcp)   | Paywalled MCP tools joining a ranked watchlist with SEC company data. Ngrok via `pnpm mcp:stock-research:tunnel`              |
| [ruby/bitcoin_analytics_mcp](./examples/ruby/bitcoin_analytics_mcp) | Paywalled MCP tools composing Bitcoin halving, mempool.space, and btcnode data. Ngrok via `pnpm mcp:bitcoin-analytics:tunnel` |
| [go/weather-mcp](./examples/go/weather-mcp)                         | Paywalled Open-Meteo weather tools; HTTP OAuth for MCPJam (`go test ./...`)                                                   |
| [rust/guerrillamail-mcp](./examples/rust/guerrillamail-mcp)         | Paywalled disposable-inbox MCP over Guerrilla Mail. Ngrok via `pnpm mcp:guerrillamail:tunnel`                                 |

† Runs without an API key — falls back to a stub client.

See [`examples/README.md`](./examples/README.md) for setup instructions and per-language test commands.

## Documentation

- **[TypeScript SDK](https://docs.solvapay.com/sdks/typescript/intro)** — integration guides and API reference
- **[Platform support](./docs/platform-support.mdx)** — prebuilt artifact and ABI coverage per language
- **[Architecture](./docs/contributing/architecture.md)** — Rust core + five language surfaces (contributors)
- **[Publishing](./docs/publishing.mdx)** — release trains, ordering constraints, rehearsals
- **[Contributing](./CONTRIBUTING.md)** — development workflow

## Development

```bash
pnpm install
pnpm build
pnpm test
```

The monorepo uses [Changesets](https://github.com/changesets/changesets) for per-package npm versioning; the non-TypeScript surfaces share a lockstep version. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`docs/publishing.mdx`](./docs/publishing.mdx) for branching, preview publishes, and release workflow.

## Security

API keys never reach the browser. Payment flows run through backend routes. Webhook signature verification is included.

**Found a vulnerability?** See [SECURITY.md](./SECURITY.md).

## License

MIT — see [LICENSE.md](./LICENSE.md).

## Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Email**: contact@solvapay.com
- **Docs**: [docs.solvapay.com](https://docs.solvapay.com)
