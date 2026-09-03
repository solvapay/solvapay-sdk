---
'@solvapay/react': minor
---

Fix plan switching and clarify the plan card on the MCP account surface.

The account view only rendered `<CurrentPlanCard>` for a paid purchase, so customers on Free or pay-as-you-go saw the pick-a-plan empty state instead of their actual plan, with no way to switch. It now renders for any active purchase and offers `Upgrade` or `Change plan` based on the catalog, resolved through the new `mergePlanSnapshot` / `findCatalogPlan` helpers so a thin purchase snapshot still matches its catalog plan.

A $0 usage-based plan also rendered as `Free`. `<CurrentPlanCard>` now formats a usage rate for metered plans (falling back to the catalog plan when the snapshot has no `options[]`) and omits the price line when no rate can be resolved.

UI: the plan card no longer nests a second bordered box inside the MCP card, the surface carries a `Your plan` title in the same slot as checkout's `Choose a plan`, and the price/rate and balance values can be captioned via the new `showFieldLabels` prop (off by default).
