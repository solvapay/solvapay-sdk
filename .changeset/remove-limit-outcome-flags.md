---
'@solvapay/server': minor
'@solvapay/react': minor
'@solvapay/mcp-core': patch
---

Limit checks no longer return `throttled`, `needsUpgrade`, or `upgraded`. `LimitOption.onExceed` is `block` or `draw_credits`; the API still accepts `top_up` and `charge` and stores both as `draw_credits`. Rollover options are gone from the plan types; the API drops them on input. Usage on a recurring plan is paid from prepaid credits, never billed to a card: `overage` (and `consequence: 'overage'`) now means access past the included cap paid from credits. The recurring checkout mandate no longer mentions usage past the included allowance.
