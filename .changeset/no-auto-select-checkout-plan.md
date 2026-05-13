---
'@solvapay/react': minor
---

Make every checkout entry require a deliberate plan click + Continue, and ship baseline CSS for the `solvapay-checkout-*` namespace so the recommended-default paywall and `<CheckoutSteps.*>` surfaces look correct out of the box.

### Behavioural changes

- **`usePlans` no longer pre-selects the first plan when auto-selection is opted out.** When `autoSelectFirstPaid: false` and no `initialPlanRef` is supplied (the configuration `<CheckoutSteps.Root>` uses), `selectedPlanIndex` is `-1` and `selectedPlan` is `null` until the user picks a card. Previously the hook fell through to `0`, which silently highlighted the first card and enabled `<CheckoutSteps.PlanContinueButton>` — defeating the explicit-consent intent of `autoSelectFirstPaid: false`. `<PlanSelector.Root>` direct consumers default to `autoSelectFirstPaid: true` and are unaffected.
- **`<PaywallNotice.EmbeddedCheckout>` and `<CheckoutSteps.*>` always render the plan step.** The user clicks a card and presses Continue; nothing auto-advances. This applies even when only one plan is selectable — the plan step is where the rate / commitment is disclosed, and consenting to a paid action shouldn't be silent.
- **`@solvapay/react/styles.css` ships baseline rules for `solvapay-checkout-*` parts** — continue button, back link, order summary, amount picker, success receipt. Apps overriding the per-part `className` are unaffected; apps relying on no styling will see new defaults. The pay button (`.solvapay-checkout-pay-button`) and form errors (`.solvapay-checkout-error`) are deliberately not styled here — the underlying `<PaymentForm>` / `<TopupForm>` primitives already cover them via `[data-solvapay-*-submit]` and `[data-solvapay-*-error]`.

### Additions

- **`UseCheckoutFlowReturn.canGoBack`** — derived boolean read by `<CheckoutSteps.BackLink>`. With every progression user-driven, `canGoBack` is `true` whenever `step` is `'amount'` or `'payment'`, and `false` on `'plan'`.
