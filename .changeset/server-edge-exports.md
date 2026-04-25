---
'@solvapay/server': patch
---

**`@solvapay/server` edge entrypoint — restore missing paywall-state /
type-guard re-exports.**

`packages/server/src/edge.ts` now re-exports the pure paywall-state
engine (`buildGateMessage`, `buildNudgeMessage`, `classifyPaywallState`
+ the `PaywallState` discriminant), the runtime type guard
`isPaywallStructuredContent`, and the shared payment / MCP-bootstrap
types (`PaymentMethodInfo`, `SdkMerchantResponse`, `SdkProductResponse`,
`components`, `LimitResponseWithPlan`, `PaywallDecision`, etc.) that
`@solvapay/mcp-core` already imports from its top-level
`@solvapay/server` import.

Why: Deno (and every other `edge-light`/`worker`/`deno` runtime)
resolves `@solvapay/server` via the `deno` export condition to
`./dist/edge.js`. Until this patch the Node entrypoint
(`./dist/index.js`) carried the paywall-state helpers but the edge
entrypoint did not, so `@solvapay/mcp-core@0.2+` booted on Deno with
`SyntaxError: The requested module '@solvapay/server' does not
provide an export named 'buildNudgeMessage'`. The BOOT_ERROR the
Goldberg Supabase edge MCP deploy was hitting.

No semver-affecting surface change vs. the Node entrypoint — these
symbols are already stable on `./dist/index.js`. Patch release.
