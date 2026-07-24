# Workerd edge WASM smoke (Step 38R)

Tiny Cloudflare Workers fixture that imports the built `@solvapay/server` edge
entry and exercises:

1. async `verifyWebhook` (WASM)
2. sync `buildPaywallGate` + `paywallErrorToClientPayload` (`initSync`)
3. `@solvapay/core` `validateBusinessDetails` (edge install path)
4. async `getMerchant` against an in-worker fetch stub (`WasmClient`)

## Prerequisites

```bash
# from repo root
cd rust/bindings/wasm && pnpm build:wasm && cd ../../..
pnpm --filter @solvapay/server --filter @solvapay/core build
```

## Run

```bash
cd rust/bindings/wasm/scripts/workerd-edge-smoke

pnpm dlx wrangler@4.20.0 dev --local --port 8787
# in another shell:
curl -s http://127.0.0.1:8787/smoke
```

Expect `"ok": true` with the expected `webhook.id`, `gate.kind`,
`businessSuccess`, and `merchantDisplayName`.
