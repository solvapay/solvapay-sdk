---
'@solvapay/release-train': major
---

Rust is now the only execution path. `@solvapay/server` requires `@solvapay/server-wasm` (or `@solvapay/server-native` on Node); the TypeScript fallback and `@solvapay/core/portable` entrypoint are gone.

MCP tools are consolidated (`account`, `get_history`, `set_renewal` replace the old upgrade/topup/checkout/renewal set). `PaywallError` is `SolvaPayError`. Install and peer ranges move with the unified 3.0.0 fixed group.
