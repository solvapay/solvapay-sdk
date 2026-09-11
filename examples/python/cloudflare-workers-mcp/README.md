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
Python payable handlers (`invokeHandler`) run through `solvapay_mcp.workers_payable`
(`gateNext` / `invokePayableNext` / `mcpResume`). This Worker registers the six
stock-research tools from `examples/python/stock-research-mcp` (symlinked into
`src/`) over `js.fetch`.

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
pnpm predev
uv run pywrangler dev
```

`pywrangler deploy` does not resolve npm specifiers. `pnpm predev` / `pnpm deploy:dev`
stages `sdks/wasm/runtime/workerd.js`, the edge wasm, and `runtime/mcp-app-html.js`
into `src/vendor/server-wasm/` (gitignored). The Worker loads those paths via
`import_from_javascript`.

## Deploy

Dev goldberg target at `mcp-python-dev.solvapay.app`, Worker
`solvapay-mcp-goldberg-python-dev`, backend `https://api-dev.solvapay.com`.
Named wrangler envs do not inherit `compatibility_flags` / `rules`, so `[env.dev]`
redeclares `python_workers`, `find_additional_modules`, and the JS/wasm rules.

```bash
cd examples/python/cloudflare-workers-mcp
cp .env.dev.example .env.dev
# fill sk_test_/sk_sandbox_, prd_…

# One-time
uv run pywrangler secret put SOLVAPAY_SECRET_KEY --env dev

pnpm preflight:dev
pnpm deploy:dev   # builds @solvapay/server-wasm, then stages workerd.js + wasm + mcp-app-html.js
```

Health: `https://mcp-python-dev.solvapay.app/health`.
MCP: `https://mcp-python-dev.solvapay.app/mcp`. Widget:
`ui://cloudflare-workers-mcp/mcp-app.html` (`resources/read`). Unauthenticated
`tools/call` returns 401 with `WWW-Authenticate` pointing at
`https://mcp-python-dev.solvapay.app/.well-known/oauth-protected-resource`.
