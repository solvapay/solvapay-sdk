---
'@solvapay/react': patch
---

Three small fixes / UX changes for the MCP "Your plan" card:

- **Cycle suffix bug fix.** `<CurrentPlanCard>` now falls back to
  `activePurchase.planSnapshot.billingCycle` when the top-level
  `activePurchase.billingCycle` is missing. Recurring plans whose
  cycle was only stamped on the snapshot (e.g. SEK monthly bootstraps)
  previously rendered "SEK 500" instead of "SEK 500 / month".

- **Single-CTA MCP account view.** `<McpAccountView>` now passes both
  `hideCancelButton` and `hideUpdatePaymentButton` to its embedded
  `<CurrentPlanCard>` and renders a one-line hint underneath
  ("Click Manage account to update your card or cancel your plan.")
  pointing users at the portal CTA below. Inline cancellation inside
  the host iframe was unreliable; until that's root-caused both card
  flows route through the customer portal.

- **`customerPortal.launchButton` copy renamed** from "Manage billing"
  to "Manage account" to match the broader scope of what the portal
  exposes (card + cancellation + invoices). This is a default localised
  string — integrators that override `customerPortal.launchButton` via
  `<SolvaPayProvider config={{ copy }}>` are unaffected, and consumers
  passing `children` to `<LaunchCustomerPortalButton>` already control
  their own label.

Also adds a `currentPlan.portalHint` copy key (defaulting to the hint
above) and renames the same default in `<McpTopupView>`'s post-topup
success state.
