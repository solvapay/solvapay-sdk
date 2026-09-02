---
'@solvapay/core': minor
'@solvapay/server': minor
'@solvapay/react': minor
'@solvapay/mcp-core': patch
---

Surface the `/v1/sdk/limits` outcome flags (`throttled`, `overage`, `needsTopUp`, `needsUpgrade`, `upgraded`) on `checkLimits()`, `useLimits()`, and MCP `ctx.customer` across TypeScript, Go, Rust, Python, and Ruby. Classification, customer snapshots, allow `consequence`, and the unlimited sentinel now live in the Rust core so every surface shares one implementation.

Two behaviour changes for live integrators:

1. **Classifier precedence.** Authoritative `needsTopUp` / `needsUpgrade` from the backend now win over the credit-balance heuristic (activation still wins first).
2. **`isUnlimited` sentinel.** Only `remaining === -1` is unlimited. An unexpected negative (for example `-2`) is no longer treated as unlimited.

An allow decision also carries an optional `consequence` (`throttled` | `overage`) so a degraded allow is distinguishable from a plain allow. The field is omitted on a plain allow.
