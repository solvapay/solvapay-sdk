---
'@solvapay/react': minor
---

Add headless `useCheckoutFlow` hook + opt-in `<CheckoutSteps.*>` parts so MCP, paywall, and chatbot/web checkouts share one state engine while each owns its own layout. Also fix MCP-flavored copy bleed in `<PaywallNotice.Message>` for web integrators.

### Additions

- **`useCheckoutFlow({ productRef, … })`** — headless state engine for the four-step activation flow (plan → amount [PAYG only] → payment → success). Owns step state, transitions, lifecycle callbacks (`onPlanSelect`, `onAmountSelect`, `onPurchaseSuccess`, `onError`), and the `transport.activatePlan` side-effect on the PAYG plan→amount edge. Must be called inside `<PlanSelector.Root>`. Exported from `@solvapay/react` and `@solvapay/react/primitives`.
- **`<CheckoutSteps.*>`** — opt-in pre-styled parts (`Root`, `IfStep`, `PlanGrid`, `PlanContinueButton`, `AmountPicker`, `AmountContinueButton`, `Payment`, `BackLink`, `Success`) that compose on `useCheckoutFlow`. Class names follow the `solvapay-checkout-*` namespace. MCP and paywall surfaces add their own ancestor selectors (`.solvapay-mcp-shell .solvapay-checkout-card`) rather than remapping `classNames` per call site. Exported from `@solvapay/react` and `@solvapay/react/primitives`.
- **i18n keys** — new `paywall.activationRequiredMessage`, `paywall.paymentRequiredMessageNoBalance`, `paywall.topupRequiredMessage` for web-friendly paywall copy that doesn't leak MCP tool names ("Call the `upgrade` tool…") into web UIs.

### Behavioural changes

- **`<PaywallNotice.EmbeddedCheckout>` is now a stepped composition** of `<CheckoutSteps.*>` (plan → amount → payment → success with an explicit Continue between plan and the form). This is the SDK's recommended default for paywall surfaces. Apps wanting a different layout compose `<CheckoutSteps.*>` directly. Removes the previous one-shot composition where the PAYG amount picker and payment form coexisted on the same surface.
- **`<PaywallNotice.Message>` resolves a kind-specific i18n string first**, falling back to `content.message` only when no kind-specific copy exists. Strict improvement: web UIs no longer surface MCP-flavored "Call the `upgrade` tool…" copy that was authored for CLI / MCP hosts. The MCP layer routes `content.message` through `content[0].text` (its actual consumer), so MCP behaviour is unchanged.
- **`<PaywallNotice.EmbeddedCheckout>` and `<CheckoutSteps.Root>` ship a smart default plan filter.** Aligns the SDK with the hosted-checkout topup pattern (one usage-based plan + `<AmountPicker>` with currency presets — no separate "100 Credits" / "250 Credits" pack plans). The new `buildDefaultCheckoutPlanFilter(plans)` always hides Free plans, and hides PAYG when the product also exposes a non-PAYG paid plan so legacy / mixed configs render only the packs. PAYG-only products are unaffected: the filter keeps PAYG, `autoSkipSinglePlan` advances past the plan step, and the user lands on the AmountPicker. Consumers passing an explicit `filter` prop keep their existing behaviour.

### MCP

- `<McpCheckoutView>` and `mcp/views/checkout/EmbeddedCheckout` are now thin layout wrappers around `useCheckoutFlow`. The state machine moved to the hook; the MCP wrapper owns the bridge wiring (`notifyModelContext` on plan commit, `notifySuccess` on success, `sendMessage` on Stay-on-Free) and the MCP-specific chrome (banner, Stay-on-Free button). All existing `<McpCheckoutView>` tests pass unchanged.
