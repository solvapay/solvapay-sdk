---
'@solvapay/mcp': minor
'@solvapay/server': minor
'@solvapay/mcp-core': patch
'create-solvapay': minor
---

Add `registerFree` for otherwise-free MCP tools with a per-customer cap declared in code. Tools that name the same `free-*` meter share one allowance; exhaustion emits the existing paywall gate (`paywallReason: 'limit_reached'`). Unidentified callers fail with `identity_required` instead of sharing an anonymous bucket. The scaffolder accepts a `free-capped` operation tier that emits `ctx.registerFree`.
