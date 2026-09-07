---
'@solvapay/server': minor
---

MCP server contract and paywall hardening for the account widget release.

Seed bootstrap `limits` on the MCP bootstrap payload so clients can render remaining allowance without a second `checkLimits` call. Add `getCreditActivity` / fetch handler for account-wide credit ledger rows. Expose `reusable` on the payment-method contract so clients can tell a chargeable saved card from a one-off card on file.

Paywall: put measured `used`/`limit` on `LimitResponse` when the backend measured a finite cap; coalesce concurrent `checkLimits` calls; send `idempotencyKey` on `trackUsage` from the `decide()` request id so retries do not double-count. Record `toolName` on usage events when the payable handler knows it.

Accept `customerCountry`, `customerState`, and `customerPostalCode` on attach/confirm so the MCP widget owns billing country instead of Stripe PaymentElement.
