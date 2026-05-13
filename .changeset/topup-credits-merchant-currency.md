---
'@solvapay/react': minor
---

Align `<CheckoutSteps>` PAYG topup flow with the hosted topup page and `<McpTopupView>` — drive amount + payment off the merchant's base currency, optimistically bump credits on success, and add the `topupCurrency` prop as a forward-compat hook for multi-currency topups.

### Currency invariant

Credits are merchant-wide, not plan-specific. The PAYG topup branch (`<CheckoutSteps.AmountPicker>`, `<CheckoutSteps.AmountContinueButton>`, `<CheckoutSteps.Payment>` PAYG variant) now resolves currency strictly from:

```
topupCurrency prop  →  merchant.defaultCurrency  →  null (UI gates)
```

`plan.currency` is **never** consulted for the topup branch — using it would mismatch what the wallet actually settles in. Recurring/one-time plan purchases keep using `plan.currency` (correct for those, since they settle in the plan's denominated currency).

### Additions

- **`topupCurrency?: string`** prop on `<CheckoutSteps.Root>` and `<PaywallNotice.EmbeddedCheckout>`. Defaults to `merchant.defaultCurrency`. Pass an explicit value when integrators surface a per-customer currency picker (multi-currency topup support, future).
- **`flow.topupCurrency: string | null`** and **`flow.topupCurrencyReady: boolean`** on the `useCheckoutFlow` return value. Step components consume both via `useCheckoutContext`; while `!topupCurrencyReady`, the AmountPicker and Continue button render skeleton/disabled state instead of a misleading default.

### Behavioural changes

- **Optimistic balance bump on PAYG success.** `useCheckoutFlow.recordPaygSuccess` now calls `balance.adjustBalance(creditsAdded)` so the header pill / `<BalanceBadge>` reflect the topup before the Stripe webhook lands. The `SolvaPayProvider`'s 8s grace window auto-reconciles via the deferred fetch — no race against the real webhook. Mirrors `<McpTopupView>`.
- **`<RecurringPayment>` distinguishes recurring vs one-time** plans in submit-button + order-summary copy. Plans with `billingCycle` render `Subscribe — $X/cycle`; plans without (e.g. lifetime / one-time) render `Pay $X` with no `/cycle` suffix. Fixes a regression where lifetime plans rendered as `Subscribe — $X/mo`.
- **`<CheckoutSteps.AmountPicker>` renders a skeleton row** while `useMerchant` is in flight and no explicit `topupCurrency` prop is passed. Ensures the picker never paints a misleading USD preset on a non-USD merchant during initial load. The merchant fetch is fast in practice (5-minute cache, often seeded), so this is rarely visible.

### Migration

No breaking changes for existing single-currency integrators. Custom transports without a `getMerchant` adapter must pass `topupCurrency` explicitly (the only currency source available without merchant data) — same shape future multi-currency pickers will use.
