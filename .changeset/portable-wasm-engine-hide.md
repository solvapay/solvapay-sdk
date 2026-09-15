---
'@solvapay/release-train': major
'@solvapay/react': minor
---

Remove the `@solvapay/core/portable` TypeScript fallback. The MCP App widget and `@solvapay/react/mcp` always load browser WASM. `hideToolsByAudience` filtering is owned by the Rust engine (`hideAudiences` + `userAgent`); host `bypassWhen` wrapping is gone.
