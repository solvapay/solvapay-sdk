---
'@solvapay/react': minor
---

Auto-skip the plan step in checkout when a product exposes only one selectable plan, and ship baseline CSS for the `solvapay-checkout-*` namespace so the recommended-default paywall and `<CheckoutSteps.*>` surfaces look correct out of the box.

### Behavioural changes

- **`useCheckoutFlow` now auto-skips the plan step when only one plan is selectable.** When `plans.filter(p => p.requiresPayment !== false).length === 1`, the hook auto-selects that plan, fires `onPlanSelect` once, and advances past the `'plan'` step (recurring → `'payment'`, PAYG → calls `transport.activatePlan` then `'amount'`). Opt out via `useCheckoutFlow({ autoSkipSinglePlan: false })` or `<CheckoutSteps.Root autoSkipSinglePlan={false}>`.
- **`<PaywallNotice.EmbeddedCheckout>` benefits automatically** — single-plan paywalls (e.g. one Unlimited plan) land directly on the payment form instead of showing a one-card grid above a redundant "Continue with X" button.
- **`@solvapay/react/styles.css` ships baseline rules for `solvapay-checkout-*` parts** — continue button, back link, order summary, amount picker, success receipt. Apps overriding the per-part `className` are unaffected; apps relying on no styling will see new defaults. The pay button (`.solvapay-checkout-pay-button`) and form errors (`.solvapay-checkout-error`) are deliberately not styled here — the underlying `<PaymentForm>` / `<TopupForm>` primitives already cover them via `[data-solvapay-*-submit]` and `[data-solvapay-*-error]`.

### Additions

- **`UseCheckoutFlowReturn.canGoBack`** — derived boolean read by `<CheckoutSteps.BackLink>` to suppress itself when there's no meaningful previous step (e.g. recurring single-plan payment after auto-skip). PAYG `payment → amount` keeps `canGoBack === true` because changing the topup amount is always useful.

### MCP

- The MCP wrapper opts out of the new auto-skip default (`autoSkipSinglePlan: false`) so the paywall-entry "Stay on Free" affordance stays reachable when bootstrap returns `[Free, Paid]` (one selectable plan but the affordance lives on the plan step). All existing `<McpCheckoutView>` tests pass unchanged.
