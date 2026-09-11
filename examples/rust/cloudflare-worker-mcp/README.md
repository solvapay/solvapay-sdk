# Cloudflare Workers MCP (Rust)

See the [language matrix](../../cloudflare-mcp-language-matrix.md) for why this is
100% Rust and why Go/Ruby use containers.

100% Rust on [`workers-rs`](https://github.com/cloudflare/workers-rs). The Worker
adapts `worker::Request` to [`McpHttpServer`](../../../sdks/rust-mcp) and talks to
SolvaPay over [`FetchTransport`](../../../sdks/rust). Path dependencies only — nothing
is published for this example.

Cloudflare's Rust support is first-class. The work that made this crate compile is
four host shims in `sdks/rust` / `sdks/rust-mcp` (`Date::now`, `Math.random`,
`setTimeout` sleep) so the SDK no longer assumes a native clock and tokio time driver.

This Worker is JSON-only (`McpHttpServer` returns a complete HTTP body per request).
UI-audience tools are hidden (`hide_audiences: ["ui"]`). Browser clients get an
`Origin` mirror plus `WWW-Authenticate` / `Mcp-Session-Id` on CORS.

## Prerequisites

- Rust 1.96+ with `wasm32-unknown-unknown` (`rustup target add wasm32-unknown-unknown`)
- [`worker-build`](https://crates.io/crates/worker-build)
- A SolvaPay secret key and product ref
- `wrangler` authenticated (`npx wrangler login`)

## Local dev

```bash
cd examples/rust/cloudflare-worker-mcp
cp .env.example .dev.vars
# fill SOLVAPAY_SECRET_KEY, SOLVAPAY_PRODUCT_REF, MCP_PUBLIC_BASE_URL

npx wrangler dev
```

Point an MCP client at `http://localhost:8787/mcp`.

## Deploy

Dev goldberg target at `goldberg-rust-dev.solvapay.app`, Worker
`solvapay-mcp-goldberg-rust-dev`, backend `https://api-dev.solvapay.com`.

```bash
cd examples/rust/cloudflare-worker-mcp
cp .env.dev.example .env.dev
# fill sk_test_/sk_sandbox_, prd_… (same merchant as the TS goldberg demo)

# One-time — secret is scoped to solvapay-mcp-goldberg-rust-dev
pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY --env dev

pnpm preflight:dev
pnpm deploy:dev
```

MCP endpoint: `https://goldberg-rust-dev.solvapay.app/mcp`. Unauthenticated
`tools/list` should 401 with `WWW-Authenticate` pointing at
`https://goldberg-rust-dev.solvapay.app/.well-known/oauth-protected-resource`.

The free-tier Worker size limit is 1 MB; this crate should sit well under the
TypeScript example, which is near that ceiling.

## Tests (native, no workerd)

```bash
cargo test --manifest-path examples/rust/cloudflare-worker-mcp/Cargo.toml
```
