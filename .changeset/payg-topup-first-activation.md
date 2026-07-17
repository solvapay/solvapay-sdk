---
'@solvapay/react': patch
'@solvapay/server': patch
---

Restore topup-first activation for usage-based (PAYG) plans. This reverses the eager plan-step activation shipped earlier (changelog `d4183ba`): a zero-balance PAYG customer now receives `topup_required` from `activatePlan` and the active purchase only materializes after a successful top-up.

- **`@solvapay/react`**: `useCheckoutFlow` no longer treats a PAYG plan as active at the plan step. The plan-step `activatePlan` call is expected to return `topup_required` (it creates no purchase); the flow re-activates after the top-up lands so the active purchase is created only once credits cover a unit — mirroring the `ActivationFlow` primitive's self-healing behavior.
- **`@solvapay/server`**: the `/v1/sdk/activate` OpenAPI description in the generated types now documents the topup-first policy (usage-based plans return `topup_required` at zero balance) instead of eager activation.
