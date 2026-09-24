---
'@solvapay/server': patch
---

Plan option types match the current pricing contract. `TrialOption.onEnd` is `convert` or `cancel`. `LimitOption.onExceed` no longer includes `notify`, and `uiHint` no longer includes `soft_warning`.
