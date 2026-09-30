---
'@solvapay/mcp-core': patch
---

Account bootstrap stamps `nextAction` only when `checkLimits` blocked the call, and adds `isCreditBased`. The default view opens top-up only for that gate. Narration says credits will not help on a capped plan even when the wallet is empty.
