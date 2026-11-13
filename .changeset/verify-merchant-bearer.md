---
'@solvapay/mcp': patch
'@solvapay/mcp-core': minor
---

Merchant MCP servers built with `createSolvaPayMcpFetch` or `createMcpOAuthBridge` now verify every bearer token with SolvaPay (`/v1/customer/auth/userinfo`) before serving a request. The customer comes from SolvaPay's answer, never from the token's own payload, so a token SolvaPay doesn't recognise is refused with the 401 sign-in challenge. If SolvaPay can't be reached, the request gets a 503 instead of being served. Valid answers are cached for 60 seconds. `@solvapay/mcp-core` adds `createSolvaPayTokenVerifier` and `verifyAuthInfoFromBearer`. Upgrade is strongly recommended.
