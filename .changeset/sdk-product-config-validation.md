---
'@solvapay/core': minor
'@solvapay/server': minor
'@solvapay/mcp-core': patch
'@solvapay/mcp': patch
'@solvapay/init': minor
'solvapay': minor
---

Add tiered product config validation: sync `productRef` shape checks + one-line MCP config logging, enriched OAuth DCR failure diagnostics, opt-in `verifyProductConfiguration()` on `@solvapay/server`, and `solvapay doctor` for explicit network checks (secret key, product existence, readiness, and known env-var pitfalls).
