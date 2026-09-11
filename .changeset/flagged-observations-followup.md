---
'@solvapay/mcp-core': patch
'@solvapay/mcp': patch
'@solvapay/server': patch
---

Thread a configurable MCP payable `usageType` through TypeScript, Python, and Ruby so custom meters reach `trackUsage`. Drop the TypeScript-only 500ms cancel/reactivate settle sleeps (responses return as soon as the core confirms the mutation). Log terminal fire-and-forget `trackUsage` failures from `payable.gate()`, fail loudly on a non-object `checkLimits` body in Python/Ruby/Go, resolve Ruby `Payable#protect` customer refs from positional args, and stop turning unexpected OAuth bearer-build errors into 401 challenges.
