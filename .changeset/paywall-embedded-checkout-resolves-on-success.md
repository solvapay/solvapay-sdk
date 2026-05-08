---
'@solvapay/react': patch
---

Fix `<PaywallNotice.EmbeddedCheckout>` so it dismisses synchronously on successful payment instead of waiting for `usePaywallResolver` to flip. Pre-fix, the checkout's `onPurchaseSuccess` only triggered a refetch and the parent's `onResolved` was fired by an effect that watched the resolver — backend / webhook lag (sandbox or local dev) could leave the success card stuck for 10s+ even after Stripe had confirmed the payment.

`<PaywallNotice.Root>` now dedupes `onResolved` per-mount and exposes the deduped trigger via context, so `<EmbeddedCheckout>` can signal completion immediately on payment success while the resolver-driven path keeps working as a backstop. Inline `onResolved` arrows on the parent no longer re-trigger the effect either.
