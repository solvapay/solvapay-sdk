---
'@solvapay/server': minor
'@solvapay/mcp-core': patch
---

Gate link honesty: thread `purpose: 'credit_topup'` through checkout session creation, label recovery links by destination (`Add credits` vs `Open checkout`), drop invented top-up presets from the narrator, and classify recovery links from `paywallReason` instead of URL substring heuristics.
