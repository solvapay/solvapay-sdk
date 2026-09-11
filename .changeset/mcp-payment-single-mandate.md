---
'@solvapay/react': minor
---

Drop Stripe's duplicate mandate line from the MCP payment surfaces. Enabling auto-recharge makes the backend set `setup_future_usage`, which made Stripe's `PaymentElement` render its own terms sentence ("you allow <merchant> to charge your card for future payments…") between the card fields and the country selector — a second authorization in Stripe's wording, directly above the `MandateText` that already states the charge. `McpTopupView` and the checkout PAYG step now pass `terms: { card: 'never' }` and own the full mandate.

`MandateText` takes a new `savesPaymentMethod` prop; the `topup` mandate template appends a saved-card sentence when it is set, so the card-storage disclosure moves into SolvaPay's copy rather than disappearing. `MandateContext` gains a matching optional `savesPaymentMethod` field for custom copy bundles. The default is unchanged for every other call site: `DEFAULT_PAYMENT_ELEMENT_OPTIONS` still leaves Stripe's terms on, so integrators composing `TopupForm` without `MandateText` keep Stripe's line.
