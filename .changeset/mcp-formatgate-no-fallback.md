---
'@solvapay/release-train': patch
---

MCP `formatGate` no longer hand-builds a paywall tool result when the native binding is missing. The binding must be installed; a missing install fails loudly.
