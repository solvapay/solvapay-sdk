---
'@solvapay/python': patch
'@solvapay/go': patch
---

`account` no longer tells a customer who can call to "continue", as in `@solvapay/mcp-core`. The "To continue, call …" line ends the text only when the customer is blocked (no plan, short of credits, allowance used up, a free plan to claim). The bootstrap payload's `product` drops the merchant's `balance` and `totalTransactions`, which read as the customer having a balance of 0. Adopts the 22 re-recorded conformance cases.
