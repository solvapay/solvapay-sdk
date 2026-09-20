---
'@solvapay/mcp': patch
'@solvapay/mcp-core': patch
---

Narrow the `@solvapay/server` peer to `^2.0.0`. The previous `^1.4.0 || ^2.0.0` branch matched nothing publishable — stable server 1.x stops at 1.3.0, and mcp-core imports `creditSignals` / `FreeLimit` that do not exist there.
