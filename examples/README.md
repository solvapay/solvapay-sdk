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

cd examples/typescript/express-basic && pnpm dev   # stub mode — no API key
```

| Example                                                       | Stack             | Notes                               |
| ------------------------------------------------------------- | ----------------- | ----------------------------------- |
| [express-basic](./typescript/express-basic)                   | Express           | Paywall + stub mode                 |
| [checkout-demo](./typescript/checkout-demo)                   | Next.js           | Full checkout + Supabase            |
| [hosted-checkout-demo](./typescript/hosted-checkout-demo)     | Next.js           | Redirect checkout + portal          |
| [supabase-edge](./typescript/supabase-edge)                   | Deno / Edge       | `@solvapay/server/fetch` one-liners |
| [mcp-oauth-bridge](./typescript/mcp-oauth-bridge)             | Express MCP       | OAuth + `payable.mcp()`             |
| [mcp-checkout-app](./typescript/mcp-checkout-app)             | Express MCP       | Full MCP App UI                     |
| [supabase-edge-mcp](./typescript/supabase-edge-mcp)           | Supabase Edge MCP | Deno fetch-runtime gate             |
| [cloudflare-workers-mcp](./typescript/cloudflare-workers-mcp) | Workers MCP       | Sibling of supabase-edge-mcp        |
| [chat-checkout-demo](./typescript/chat-checkout-demo)         | Vite + Workers    | Chat paywall demo                   |
| [nextjs-auth0](./typescript/nextjs-auth0)                     | Next.js + Auth0   | Auth starter (no SolvaPay yet)      |

See each example’s README for setup. Build all workspace examples: `pnpm build:examples`.

## Python

| Example                               | Description                                                         |
| ------------------------------------- | ------------------------------------------------------------------- |
| [get-merchant](./python/get-merchant) | `SolvaPayClient.get_merchant_blocking` + offline `http.server` test |

```bash
cd examples/python/get-merchant
python -m pytest -q
```

## Ruby

| Example                             | Description                                             |
| ----------------------------------- | ------------------------------------------------------- |
| [get_merchant](./ruby/get_merchant) | `SolvaPay::Client#get_merchant` + offline TCP stub test |

```bash
cd examples/ruby/get_merchant
ruby -I../../../rust/bindings/ruby/lib test/get_merchant_test.rb
```

## Go

| Example                           | Description                            |
| --------------------------------- | -------------------------------------- |
| [get-merchant](./go/get-merchant) | `Client.GetMerchant` + `httptest` test |

```bash
cd examples/go/get-merchant && go test ./...
```

## Rust

| Example                             | Description                                           |
| ----------------------------------- | ----------------------------------------------------- |
| [get-merchant](./rust/get-merchant) | Facade `get_merchant` + injected `MockTransport` test |

```bash
cargo test --manifest-path examples/rust/get-merchant/Cargo.toml
```
