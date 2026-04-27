---
'@solvapay/react': minor
---

Lead the MCP account view with the product in focus, then the active
plan and usage. Mirrors the hosted manage page's information hierarchy
(`who I am`, `the seller`, `the current product and plan`) without
forking layout primitives:

- `<McpAppShell>` threads `bootstrap.product` and `onRefreshBootstrap`
  into `<McpAccountView>` as new `product` and `onRefresh` props.
- `<McpAccountView>` now opens with a `<header>` painting the product
  name (`<h1>`) and optional description (`<p>`), then a
  `CURRENT PLAN AND USAGE` section label row with an inline refresh
  icon button. Both render unconditionally — even when no purchase or
  credits exist — so the surface always answers "which product am I
  managing?".
- The standalone "Credit balance" hero card is gone. Its in-card
  pay-as-you-go state lives inside the same plan card as the no-plan
  empty state, with consistent styling and the same `Top up` /
  `See plans` / `Pick a plan` CTAs.
- `<CurrentPlanCard>` gains `hideHeading`, `hideProductContext`,
  `showStartDate`, and `showReference` props plus matching
  `classNames.startedLine` / `classNames.reference` slots. The MCP
  account view sets all four so the card reads as a card body
  beneath the section label, with `Started {date}` and the
  `pur_…` reference inline. Default behaviour is unchanged for
  hosted callers.
- New `account.{currentPlanAndUsage, refreshLabel, payAsYouGoTitle,
  payAsYouGoBody, noPlanTitle, noPlanBody, seePlansButton,
  pickPlanButton}` and `currentPlan.startedOn` copy keys.
- New `productHeader`, `productName`, `productDescription`,
  `sectionLabelRow`, `sectionLabel`, and `refreshButton` className
  slots on `McpViewClassNames` for theming overrides.
