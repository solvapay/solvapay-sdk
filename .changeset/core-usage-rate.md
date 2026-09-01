---
'@solvapay/core': minor
---

Publish `usageRate` (and the tier-band readers it uses). `@solvapay/react` and `@solvapay/mcp-core` already import this API, but `core@1.5.0` on npm predates it, so widget builds fail with a missing export.
