---
'@solvapay/server': minor
'@solvapay/mcp-core': patch
'@solvapay/next': patch
'@solvapay/release-train': patch
---

Stop asking an already-paying customer to switch plan on a credit shortfall, and stop minting hosted checkout sessions with a non-browsable MCP endpoint as `returnUrl`. Pass `returnUrl: null` to `createCheckoutSessionCore` to omit the field instead of falling back to the request origin.
