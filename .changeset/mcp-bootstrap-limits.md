---
'@solvapay/server': minor
'@solvapay/mcp-core': patch
'@solvapay/react': minor
---

Seed MCP bootstrap `limits` into `useLimits` / `useUsage` so the account widget can render remaining allowance without a second `checkLimits` call.
