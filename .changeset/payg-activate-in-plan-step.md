---
'@solvapay/react': patch
---

**PAYG checkout now activates at the plan step.**

`CheckoutStateMachine` fires `activate_plan` from the plan picker's
`Continue with Pay as you go` button instead of from the amount picker.
This pairs with the backend change that makes `activate_plan` eagerly
create the active usage-based purchase regardless of current credit
balance — one user-visible click, one activation round-trip.

Behaviour change:

- Plan step `Continue` now awaits `activate_plan` before advancing to
  the amount picker. The button renders in its existing activating
  state while the call is in flight; failures surface via
  `activationError` below the button.
- Amount step `Continue` is now a purely-local state transition — it
  no longer fires `activate_plan`. Back-navigation from the payment
  step (`Change amount`) therefore does not re-activate.
- `AmountStep` props trimmed: `isActivating` and `activationError`
  removed (unused on this step now). `onContinue` is synchronous.

Migration notes:

- Custom surfaces that pass `isActivating` / `activationError` into
  their own `<AmountStep>` wrapper should drop those props.
- Consumers subclassing `CheckoutStateMachine` should move any logic
  that reacted to "activation-in-flight at the amount step" into the
  plan step's activating window.

Paired backend PR: `solvapay-backend#112` — eager activation for
usage-based plans in the `activate_plan` MCP tool handler.
