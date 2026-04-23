---
name: plan-selector-card-rendering-fixes
overview: Fix the `PlanSelector` primitive so every card always shows the plan name, surfaces pricing details (PAYG per-call rate, recurring per-cycle), and treats the current plan as a visible-but-disabled "Current" card — including when the current plan is Free.
todos:
  - id: primitive-card-name
    content: "PlanSelector.CardName: remove null guard; add type-based fallback (Free / Pay as you go / Plan)"
    status: pending
  - id: primitive-card-price
    content: "PlanSelector.CardPrice: render PAYG per-call rate using creditsPerUnit + currency"
    status: pending
  - id: primitive-card-interval
    content: "PlanSelector.CardInterval: fall back to plan.billingCycle when plan.interval is empty"
    status: pending
  - id: checkout-filter
    content: "McpCheckoutView: relax planFilterPaid so the current plan (including Free) survives the filter"
    status: pending
  - id: tests-primitive
    content: "PlanSelector tests: PAYG rate, billingCycle fallback, nameless-plan fallback"
    status: pending
  - id: tests-checkout
    content: "McpCheckoutView tests: current-Free plan renders disabled card with Current badge"
    status: pending
isProject: false
---

## Context

The screenshot shows [`McpCheckoutView`'s `PlanStep`](packages/react/src/mcp/views/McpCheckoutView.tsx) rendering `<PlanSelector>` cards. Three concrete primitive bugs explain the gaps (no name on the SEK 500 card, no `/mo` suffix, no PAYG rate), plus the Free-is-current case is filtered out at the checkout view.

## Changes

### 1. `packages/react/src/primitives/PlanSelector.tsx` — rendering fixes

**`CardName`** (line 335): drop the `if (!card.plan.name) return null` early-return. Render `plan.name` when present, otherwise a type-based fallback so cards never render nameless:

- `requiresPayment === false` → "Free"
- `type === 'usage-based'` → "Pay as you go"
- `type === 'recurring'` → "Plan"
- else → empty string (return null only in that case)

**`CardPrice`** (line 349): when the plan is `usage-based`, render the per-call rate using `plan.price` (in minor units, typically 0 for PAYG), `plan.creditsPerUnit`, and `plan.currency`. Format is `<currency> <rate> / call` using `formatPrice` (already imported). Falls back to existing behaviour for recurring and free.

Pseudocode addition:

```ts
if (card.plan.type === 'usage-based') {
  const cpu = card.plan.creditsPerUnit ?? 1
  const perCallMinor = Math.max(1, Math.round(1 / cpu))
  return formatPrice(perCallMinor, currency, { locale }) + ' / call'
}
```

**`CardInterval`** (line 378): fall back to `plan.billingCycle` when `plan.interval` is not set (bootstrap-shaped plans only populate `billingCycle`). Keeps `per {interval}` copy. Suppresses itself for PAYG (no cycle) and `isFree`.

**`Grid`** card-state logic (line 264): today, `disabled = isCurrent || isFree`. Keep that — but the `data-state` precedence already renders `current` when `isCurrent`, so the current plan gets the "Current" badge via `CardBadge`. No behaviour change here; just confirms the disabled-but-visible path works for any current plan.

### 2. `packages/react/src/mcp/views/McpCheckoutView.tsx` — filter relaxation (minimal)

Update [`planFilterPaid`](packages/react/src/mcp/views/McpCheckoutView.tsx:1038) so the current plan survives even when it's Free. Pull `currentPlanRef` from the grid-level context isn't available at filter time, so instead: do the filtering inline in `paidPlans`/plan flow if needed. Simpler path — pass the filter as a factory that captures `currentPlanRef` from `usePurchase`:

```ts
const { activePurchase } = usePurchase()
const currentRef = activePurchase?.planSnapshot?.reference ?? null
const filter = (plan: Plan) =>
  plan.requiresPayment !== false || plan.reference === currentRef
```

Result: customers on Free see their Free card marked "Current" + disabled above the paid options; customers on a paid plan see that paid plan marked current-and-disabled alongside the other paid choices.

### 3. CSS — no changes required

Existing rules already style `data-state='current'` (muted bg, `cursor: default`) and `data-state='disabled'` (opacity 0.6, cursor not-allowed). The new name/interval rows reuse existing `data-solvapay-plan-selector-card-name|price|interval` selectors.

### 4. Tests

- Extend [`PlanSelector.test.tsx`](packages/react/src/components/PlanSelector.test.tsx) with cases:
  - PAYG plan renders `"$0.01 / call"` (or locale equivalent) in `CardPrice`.
  - Plan with only `billingCycle: 'monthly'` (no `interval`) renders `/mo` via `CardInterval`.
  - Nameless recurring plan renders fallback "Plan" rather than collapsing.
- Extend [`McpCheckoutView.test.tsx`](packages/react/src/mcp/views/__tests__/McpCheckoutView.test.tsx) with a case: customer on Free → Free card appears in the picker with `aria-disabled` + "Current" badge; clicking it is a no-op; `Continue` CTA stays disabled until a paid card is selected.

## Diagram

```mermaid
flowchart LR
  Grid[PlanSelector.Grid] -->|"isCurrent"| Current[data-state=current<br/>disabled]
  Grid -->|"isFree and notCurrent"| Free[data-state=disabled]
  Grid -->|"selected"| Selected[data-state=selected]
  Grid -->|"idle"| Idle[data-state=idle]
  Current --> Badge["CardBadge → 'Current'"]
  Idle --> Popular{"isPopular?"}
  Popular -->|"yes"| PopBadge["'Popular'"]
