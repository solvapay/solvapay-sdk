---
'@solvapay/mcp-core': patch
---

`account` no longer tells a customer who can call to "continue".

- The "To continue, call `account` with view: …" line now ends the text only when the customer is blocked: no plan yet, short of credits, allowance used up, or a free plan to claim. A funded or within-allowance customer (a credits plan with balance, a subscription, a free plan with calls left, overage, a cancelled plan still running) got it too, and hosts and models read it as a block. The body still names the optional next step (top up, switch plan, reactivate).
- The bootstrap payload's `product` (`account`'s `structuredContent` and `solvapay://bootstrap.json`) now carries only `reference`, `name`, `status`, `description` and `imageUrl`. It used to pass the whole product through, including the merchant's free-form `metadata` and its own `balance` and `totalTransactions`, which read as the customer having a balance of 0. The customer's balance is `customer.balance`. `BootstrapProduct` is now a `Pick` of those five fields; a merchant handler's `ctx.product` was already only `{ reference, name }`.

Conformance: 22 narration, transport-tools and tool-descriptor cases re-recorded (9 of them record the product). Python and Go adopt them in their own PR.
