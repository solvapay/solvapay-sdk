---
'@solvapay/mcp-core': patch
---

`account` no longer tells a customer who can call to "continue".

- The "To continue, call `account` with view: …" line now ends the text only when the customer is blocked: no plan yet, short of credits, allowance used up, or a free plan to claim. A funded or within-allowance customer (a credits plan with balance, a subscription, a free plan with calls left, overage, a cancelled plan still running) got it too, and hosts and models read it as a block. The body still names the optional next step (top up, switch plan, reactivate).
- The bootstrap payload's `product` (`account`'s `structuredContent` and `solvapay://bootstrap.json`) drops `balance` and `totalTransactions`. They are the merchant's own figures for the product, not the customer's, and read as the customer having a balance of 0. The customer's balance is `customer.balance`. `BootstrapProduct` is now `Omit<SdkProductResponse, 'balance' | 'totalTransactions'>`.

Conformance: 22 narration, transport-tools and tool-descriptor cases re-recorded. Python and Go adopt them in their own PR.
