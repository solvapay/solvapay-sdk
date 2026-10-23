---
'@solvapay/auth': minor
'solvapay': minor
'create-solvapay': minor
'@solvapay/init': minor
'@solvapay/mcp-core': minor
'@solvapay/mcp': minor
'@solvapay/next': minor
'@solvapay/server': minor
---

Node.js 22 or later is now required (`engines.node` is `>=22`). Node 18 and 20 are end-of-life and get no security fixes, including the 2026-10-21 Node.js security release. The SDK is now tested on Node 22, 24 and 26. On Node 22 the bundled npm 10 installs the MCP template, so the earlier advice to upgrade npm on Node 20 no longer applies.
