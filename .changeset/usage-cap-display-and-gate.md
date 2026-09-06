---
'@solvapay/server': minor
'@solvapay/react': minor
'@solvapay/mcp-core': patch
'@solvapay/mcp': patch
---

Put measured `used`/`limit` on the limits wire so the account widget keeps a stable cap, and close paywall concurrency plus retry double-count holes.

`LimitResponse` now carries optional `used` and `limit` when the backend measured a finite cap. The widget takes the cap from those fields (or the plan) instead of `purchase.usage.used + remaining`. Concurrent `checkLimits` calls coalesce and each consume a distinct unit; `trackUsage` sends `idempotencyKey` from the `decide()` request id so retries do not double-count. That does not dedupe a genuine duplicate `tools/call` from the host. Usage events also record `toolName` when the payable handler knows it.
