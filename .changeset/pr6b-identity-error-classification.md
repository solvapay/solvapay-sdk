---
'@solvapay/server': minor
'@solvapay/core': minor
---

Customer identity uses one precedence op (`resolveCustomerRef`). Next.js and legacy `createNextHandler` no longer fabricate `demo_user` — the no-identity ref is `anonymous`. When both a verified JWT and `x-customer-ref` are present, the JWT subject wins. `mapRouteError` now classifies `PaywallError` as HTTP 402 and preserves `SolvaPayError.status`. Legacy `createMCPHandler` sets `isError: false` on paywall gates, matching `McpAdapter`.
