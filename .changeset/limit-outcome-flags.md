---
'@solvapay/server': minor
'@solvapay/react': minor
'@solvapay/mcp-core': patch
---

Surface the `/v1/sdk/limits` outcome flags (`throttled`, `overage`, `needsTopUp`, `needsUpgrade`, `upgraded`) on `checkLimits()`, `useLimits()`, and MCP `ctx.customer`. An allow decision now carries an optional `consequence` so a throttled or overage request is distinguishable from a plain allow.

`useLimits`' `isUnlimited` now matches only the backend's `-1` sentinel. An unexpected negative is no longer treated as unlimited.
