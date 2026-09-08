---
'@solvapay/server': patch
---

Re-export `PaywallStructuredContentSchema` from the edge bundle. `@solvapay/mcp` imports it on Cloudflare Workers, which resolve `@solvapay/server` to `dist/edge.js`; without this export `wrangler deploy` fails at bundle time.
