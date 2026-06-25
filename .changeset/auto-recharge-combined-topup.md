---
'@solvapay/react': minor
'@solvapay/server': minor
'@solvapay/next': patch
---

Auto-recharge can now be configured in the same top-up payment as the initial card charge, so integrators do not need a separate SetupIntent step before checkout.

- **`@solvapay/react`**: `AutoRecharge` adds `deferCardSetup` and `onPendingConfig` to stage settings until payment; `useTopup`, `TopupForm`, and `createTopupPayment` accept optional `autoRecharge`; `balance.reconcileAfterUsageDebit()` starts post-debit polling without false bumps from optimistic debits alone.
- **`@solvapay/server`**: `createTopupPaymentIntentCore` forwards optional `autoRecharge` to the SDK payment-intent API.
- **`@solvapay/next`**: `createTopupPaymentIntent` route helper accepts the same `autoRecharge` body field.
