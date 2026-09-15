# Workerd edge WASM smoke (Step 38R)

Tiny Cloudflare Workers fixture that imports the built `@solvapay/server` edge
entry and exercises:

1. async `verifyWebhook` (WASM)
2. sync `buildPaywallGate` + `paywallErrorToClientPayload` (`initSync`)
3. `@solvapay/core` `validateBusinessDetails` (edge install path)
4. async `getMerchant` against an in-worker fetch stub (`WasmClient`)

The worker hardcodes `impl: 'rust'`. There is no TypeScript fallback; runtime
`@solvapay/server` is Rust-only after steps 52/53.

## Prerequisites

```bash
# from repo root
cd sdks/wasm && pnpm build:wasm && cd ../../..
pnpm --filter @solvapay/server --filter @solvapay/core build
```

## Run

From the repo root (CI uses this):

```bash
pnpm --filter @solvapay/server-wasm test:workerd-edge-smoke
```

The orchestrator (`run-smoke.mjs`) picks a free port, spawns `wrangler@4.98.0
dev --local`, polls `/smoke`, and asserts `ok === true` plus `webhook.id`,
`gate.kind`, `businessSuccess`, and `merchantDisplayName`.

Manual wrangler:

```bash
cd sdks/wasm/scripts/workerd-edge-smoke
pnpm exec wrangler dev --local --port 8787
# in another shell:
curl -s http://127.0.0.1:8787/smoke
```
