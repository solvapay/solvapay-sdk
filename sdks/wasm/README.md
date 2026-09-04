# `@solvapay/server-wasm`

wasm-bindgen binding for SolvaPay edge/browser runtimes (Step 38).

## Profiles

| Profile   | Features  | Exports                                                                                                                                                                                                           |
| --------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edge`    | `edge`    | `ready`, `wasmVersion`, `wasmBuildInfo`, `verifyWebhook`, `WasmClient` (Groups A–C + MCP composites), sync decision / MCP payload envelopes                                                                       |
| `browser` | `browser` | `ready`, `wasmVersion`, `wasmBuildInfo`, plus the public-safe business-details / credit-display / seller-identity / money-format / tax-note / plan-pricing envelopes. No webhook, no `WasmClient`, no MCP symbols |

## Rebuild artifacts

Requires Rust 1.96 toolchain, `wasm-bindgen-cli` **0.2.126**, and `binaryen@131.0.0` (via pnpm).

```bash
pnpm install
pnpm build                 # verifies committed pkg/{edge,browser} exist (no Rust)
pnpm build:wasm            # regenerate pkg/{edge,browser} (needs Rust + wasm-bindgen + binaryen)
pnpm build:check-drift     # CI: fail if committed artifacts differ from a fresh rebuild
pnpm symbols:check
pnpm measure:record        # once, to write budgets.json
pnpm measure               # CI check
pnpm test
```
