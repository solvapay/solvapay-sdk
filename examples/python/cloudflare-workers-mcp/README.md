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
- Node 22 for `pywrangler` (Node 26 rejects `--experimental-wasm-stack-switching`
  that Pyodide's Python shim passes through)
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

Dev goldberg target at `goldberg-python-dev.solvapay.app`, Worker
`solvapay-mcp-goldberg-python-dev`, backend `https://api-dev.solvapay.com`.
Named wrangler envs do not inherit `compatibility_flags`, so `[env.dev]`
redeclares `python_workers`.

```bash
cd examples/python/cloudflare-workers-mcp
cp .env.dev.example .env.dev
# fill sk_test_/sk_sandbox_, prd_…

# One-time
uv run pywrangler secret put SOLVAPAY_SECRET_KEY --env dev

pnpm preflight:dev
pnpm deploy:dev   # builds @solvapay/server-wasm first
```

Health: `https://goldberg-python-dev.solvapay.app/health`.
MCP: `https://goldberg-python-dev.solvapay.app/mcp`.

`pywrangler deploy` currently uploads Python modules only. The live Worker then
fails at `import_from_javascript("@solvapay/server-wasm")` (`No such module`)
until that JS package is included in the Python Worker bundle. Local
`pywrangler dev` can still resolve the workspace package.
