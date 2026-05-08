---
'@solvapay/react': patch
---

`<MandateText>` now explicitly calls out that one-time charges are one-time. The `oneTime` mandate template (rendered by `<MandateText>`, `<PaywallNotice.EmbeddedCheckout>`, and `<CheckoutSteps.PaymentForm>` whenever the resolved plan is a one-time / lifetime plan) was previously indistinguishable from the recurring template at a glance: *"By confirming, you authorize Acme Inc to charge $99 for Widget API. Payments are processed by SolvaPay."* — no signal that this is a single charge versus a subscription. Inserts "a one-time" before the amount so the sentence now reads *"...to charge a one-time $99 for Widget API..."*. Mirrors the disambiguation the `recurring` template gets via `every {period} until you cancel`.

Integrators with snapshot tests pinned to the previous wording will need to update their fixtures. Integrators using a custom `copy.mandate.oneTime` override are unaffected.
