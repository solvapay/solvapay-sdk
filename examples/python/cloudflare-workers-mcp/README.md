# Cloudflare Workers MCP (Python) — beta

See the [language matrix](../../cloudflare-mcp-language-matrix.md).

Idiomatic Python Worker (`Default(WorkerEntrypoint)` + Starlette ASGI). Cloudflare's
Python runtime is first-class. The constraint is **our** package: `solvapay` is a
native PyO3 extension, so Pyodide cannot `import solvapay`.

This example bridges that one dependency through `@solvapay/server-wasm` (the
workerd export) and `solvapay_mcp.workers.WasmApiClient`. Labelled **beta** until
the locally-built PyEmscripten wheel deletes the shim
(`docs/contributing/pyodide-emscripten-wheel.md`).

Builtin MCP tools + OAuth run through `mcpDispatch` / `mcpOauthRequest`. Custom
Python payable handlers (`invokeHandler`) are not on this interim path.

## Prerequisites

- `uv` and Node/pnpm (for the workspace `@solvapay/server-wasm` build)
- `python_workers` compatibility flag (Python Workers are in open beta)
- `cd sdks/wasm && pnpm build:wasm` (or `pnpm predev` from this directory)

`examples/python/cloudflare-workers-mcp` is in `pnpm-workspace.yaml` so
`@solvapay/server-wasm` resolves as `workspace:*`.

## Local dev

```bash
# repo root
pnpm install
pnpm --filter @solvapay/server-wasm run build:wasm

cd examples/python/cloudflare-workers-mcp
cp .env.example .dev.vars
# fill secrets
uv run pywrangler dev
```

If wrangler's Python bundler does not pick up the JS workspace package, the
fallback is a relative import of `sdks/wasm/runtime/workerd.js` (same artifact).

## Deploy

```bash
uv run pywrangler secret put SOLVAPAY_SECRET_KEY
uv run pywrangler deploy
```
