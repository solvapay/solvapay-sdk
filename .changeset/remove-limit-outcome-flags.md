---
'@solvapay/server': minor
'@solvapay/react': minor
'@solvapay/mcp-core': patch
---

Limit checks no longer return `throttled`, `needsUpgrade`, or `upgraded`. `LimitOption.onExceed` is `block`, `charge`, or `top_up`. An allow past the included cap sets `consequence` to `overage` only.
