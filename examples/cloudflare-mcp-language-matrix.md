# Cloudflare MCP language matrix

Cloudflare's **Rust** and **Python** Worker runtimes are first-class. Every
constraint below is in **our packaging**, not theirs. Customer-facing name for
these servers is **MCP server**.

| Language   | Path                                                | Why                                                                                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript | `examples/typescript/cloudflare-workers-mcp`        | Already shipping. `@solvapay/mcp/fetch` + isolate-scoped handler.                                                                                                                                                                                                                |
| Rust       | `examples/rust/cloudflare-worker-mcp`               | 100% `workers-rs`. No FFI. Four host shims in `sdks/rust` / `sdks/rust-mcp` (`Date.now`, `Math.random`, `setTimeout` sleep) so the SDK no longer panics on `wasm32-unknown-unknown`. `register_payable_tool` (rmcp `ToolRouter`) stays native-only; Workers use `McpHttpServer`. Payable handlers use a cfg'd `PayableFuture` so wasm tools may await `!Send` Fetch futures. Domain tools: Guerrilla Mail inbox (`examples/rust/guerrillamail-mcp`). |
| Python     | `examples/python/cloudflare-workers-mcp` (**beta**) | Idiomatic `Default(WorkerEntrypoint)` + Starlette. `solvapay` is a native PyO3 `.so`, so Pyodide cannot load it. Interim `solvapay_mcp.workers` shim over `@solvapay/server-wasm`, including the payable `invokeHandler` loop (`workers_payable`). Domain tools: stock-research (`examples/python/stock-research-mcp`). Wheel follow-up: `docs/contributing/pyodide-emscripten-wheel.md`. |
| Go         | `examples/cloudflare-containers`                    | `sdks/go` embeds `solvapay_core.wasm` under wazero + `wasi_snapshot_preview1`. That cannot run nested inside a TinyGo wasm guest on workerd.                                                                                                                                     |
| Ruby       | `examples/cloudflare-containers`                    | No Workers runtime. Native Magnus gem.                                                                                                                                                                                                                                           |

## Wasm host-shim finding

`sdks/wasm` has been on `wasm32-unknown-unknown` for a long time (core +
transport + Fetch). `McpHttpServer` lives in `sdks/rust-mcp` → `solvapay`,
which had never been compiled for wasm. Three of the four native assumptions
panic on the **first payable request**:

1. `now_ms()` in `sdks/rust/src/client.rs` — `SystemTime::now()`
2. `now_ms()` in `sdks/rust-mcp/src/register.rs` — same
3. `tokio::time::sleep` in `sdks/rust/src/retry.rs` — no tokio time driver on
   workers-rs (`spawn_local` / JS event loop)

`random_unit()` was a weak `SystemTime` nanos source; wasm uses `Math.random()`.

Tokio is **intentionally present** in the `sdks/rust` wasm graph (`sync` +
`time`). The CI gate that asserts tokio is absent still applies only to
`solvapay-core` and `solvapay-transport`.

## Containers escape hatch

Go and Ruby keep their existing HTTP servers. One Worker + two
`linux/amd64` images, Cloudflare Containers (`containers[]`, Durable Object
binding, `new_sqlite_classes`). **Workers Paid** is required.
`wrangler dev` builds locally; only `wrangler deploy` pushes an image to
Cloudflare's registry (an example image, not an SDK publish).

Build context is the **repo root** because both examples `replace` / `require`
the unpublished local SDKs (`sdks/go` + `//go:embed solvapay_core.wasm`;
`sdks/ruby` native extension).

## Dev deploys (api-dev)

All five goldberg Workers share the `example-deploy` harness
(`tools/example-deploy`). Dev only — no prod targets for the non-TS languages.

| Language   | Worker                             | Public origin                            | Command                         |
| ---------- | ---------------------------------- | ---------------------------------------- | ------------------------------- |
| TypeScript | `solvapay-mcp-goldberg-dev`        | `https://goldberg-demo-dev.solvapay.app` | `pnpm deploy:dev` in the TS dir |
| Rust       | `solvapay-mcp-goldberg-rust-dev`   | `https://mcp-rust-dev.solvapay.app` | `pnpm deploy:dev`               |
| Python     | `solvapay-mcp-goldberg-python-dev` | `https://mcp-python-dev.solvapay.app` | `pnpm deploy:dev`             |
| Go         | `solvapay-mcp-goldberg-go-dev`     | `https://mcp-go-dev.solvapay.app`        | `pnpm deploy:go`                |
| Ruby       | `solvapay-mcp-goldberg-ruby-dev`   | `https://mcp-ruby-dev.solvapay.app`      | `pnpm deploy:ruby`              |

Backend for every row: `https://api-dev.solvapay.com`. Go and Ruby products
must expose a `requests` meter.
