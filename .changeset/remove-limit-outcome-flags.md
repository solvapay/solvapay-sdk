---
'@solvapay/server': minor
'@solvapay/react': minor
'@solvapay/mcp-core': patch
---

Limit checks no longer return `throttled`, `needsUpgrade`, or `upgraded`. `LimitOption.onExceed` is `block` or `top_up`; the API still accepts `charge` and stores it as `top_up`. Rollover options are gone from the plan types; the API drops them on input. Usage on a recurring plan is paid from prepaid credits, never billed to a card: `overage` (and `consequence: 'overage'`) now means access past the included cap paid from credits. The recurring checkout mandate no longer mentions usage past the included allowance.
