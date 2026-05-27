---
'@solvapay/server': patch
---

Await `trackUsage` on edge runtimes so paywall limits decrement correctly.

Floating `trackUsage` promises were dropped when Cloudflare Workers returned
the MCP response, so usage never reached the backend and free-quota gating
never fired. All three paywall tracking paths now await tracking and swallow
errors so tool calls stay reliable.
