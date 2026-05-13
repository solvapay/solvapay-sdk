---
'@solvapay/react': minor
---

Allow customers on an active usage-based (PAYG) plan to top up without bouncing off the plan step.

### Behavioural changes

- **`<PlanSelector.Grid>` keeps PAYG `currentPlanRef` cards selectable.** Previously every "Current" card was disabled (`disabled = isCurrent || isFree`), which on topup products — where `buildDefaultCheckoutPlanFilter` collapses the catalogue down to a single PAYG card — left the customer staring at an inert grid with no way forward. Recurring/one-time current cards stay disabled because re-selecting them would re-charge the customer; the PAYG branch is the topup conduit and re-entering it is the expected next action. The "Current" badge still renders so the customer sees their active plan.
- **`<PlanSelector.Root>` auto-selects the customer's PAYG `currentPlanRef`** when it lands in the visible plan list. Topup checkout (`<CheckoutSteps.Root>` → `autoSelectFirstPaid: false`) now opens with `<CheckoutSteps.PlanContinueButton>` enabled instead of greyed-out. One-shot per `productRef` so a deliberate `clearSelection` doesn't immediately re-snap. Recurring/one-time current plans are not auto-selected — staying with `autoSelectFirstPaid: false`'s explicit-consent contract.
- **`useCheckoutFlow.advance()` skips `transport.activatePlan` when the selected plan is already the customer's current plan.** PAYG re-activation is a no-op on the backend and the round-trip just adds latency plus a transient `status: 'activating'` flicker. The flow steps straight to the amount picker.
