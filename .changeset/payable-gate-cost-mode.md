---
'@solvapay/server': minor
---

`payable.gate()` takes a cost mode for calls priced after the fact, such as an LLM API billed per token: `gate(req, { cost: { estimateUsd } })` allows a call while the customer's balance covers the estimate, and `result.settle({ amountUsd, source })` debits exactly the call's reported cost, sub-cent included. No plan is involved and `/limits` is not called.
