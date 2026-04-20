---
name: purchasegate productref prop
overview: Replace `<PurchaseGate.Root>`'s name-based `requireProduct` / `requirePlan` props with reference-based `productRef` and `planRef` props that match on the stable `prd_*` / `pln_*` identifiers. Breaking change accepted.
todos:
  - id: provider-swap-matcher
    content: Replace hasProduct/hasPlan with hasProductRef and hasPlanRef in SolvaPayProvider.tsx purchase context and PurchaseStatus type
    status: pending
  - id: gate-prop
    content: Replace requireProduct/requirePlan with productRef and planRef props on PurchaseGate.Root
    status: pending
  - id: tests
    content: Update PurchaseGate tests to cover productRef, planRef, and combined cases; update all SolvaPayContext mocks (~30 sites)
    status: pending
  - id: docs
    content: Update README, docs/guides/react.mdx, and example READMEs to use productRef / planRef
    status: pending
isProject: false
---

# Switch PurchaseGate to productRef (breaking)

## Why

`<PurchaseGate.Root requireProduct="...">` matches case-insensitively on `purchase.productName`. This is fragile:

- Product names are mutable in the dashboard; refs are not
- Every other primitive in the SDK (`CreditGate`, `PaymentForm`, `CheckoutLayout`, `PlanSelector`) already takes `productRef`
- Docs already disagree — `skills/lovable-checkout/SKILL.md` shows `<PurchaseGate productRef={...}>` and the sdk docs show a plan ref passed into a name-matcher

Consumers hit this: passing `pln_EN9AZB02` (plan ref) silently produces `blocked` even when the user owns the product.

Since the user has approved a breaking change, replace the legacy name-based knobs (`requireProduct`, `requirePlan`, `hasProduct`, `hasPlan`) with reference-based equivalents. Both levels of gating are preserved — just via stable identifiers.

## API shape

```tsx
// Any active purchase
<PurchaseGate.Root>...</PurchaseGate.Root>

// Active purchase for a specific product (any plan)
<PurchaseGate.Root productRef="prd_widget">...</PurchaseGate.Root>

// Active purchase for a specific plan
<PurchaseGate.Root planRef="pln_premium">...</PurchaseGate.Root>

// Both: active purchase on this product AND this plan (AND semantics)
<PurchaseGate.Root productRef="prd_widget" planRef="pln_premium">...</PurchaseGate.Root>
```

Matching precedence:

- If `planRef` is set, require a purchase whose `planRef` matches.
- If `productRef` is set, require a purchase whose `productRef` matches.
- If both are set, both must match on the same purchase (AND).
- If neither is set, any `status === 'active'` purchase allows access.

## Changelog framing

This is a breaking change to `@solvapay/react`. Call it out in `packages/react/CHANGELOG.md` under the next major bump:

- `<PurchaseGate.Root>`: `requireProduct` and `requirePlan` props removed — use `productRef` and/or `planRef`.
- `PurchaseStatus`: `hasProduct(name)` and `hasPlan(name)` removed — use `hasProductRef(ref)` and `hasPlanRef(ref)`.

## Changes

### 1. Provider: replace name matchers with ref matchers

[packages/react/src/SolvaPayProvider.tsx](packages/react/src/SolvaPayProvider.tsx) lines 668-677 — replace `hasProduct` and `hasPlan` with:

```ts
hasProductRef: (productRef: string) => {
  return purchaseData.purchases.some(
    p => p.productRef === productRef && p.status === 'active',
  )
},
hasPlanRef: (planRef: string) => {
  return purchaseData.purchases.some(
    p => p.planRef === planRef && p.status === 'active',
  )
},
```

### 2. Type surface

[packages/react/src/types/index.ts](packages/react/src/types/index.ts) `PurchaseStatus` lines 173-175 — replace:

```ts
hasProduct: (productName: string) => boolean
/** @deprecated Use hasProduct instead */
hasPlan: (productName: string) => boolean
```

with:

```ts
hasProductRef: (productRef: string) => boolean
hasPlanRef: (planRef: string) => boolean
```

### 3. PurchaseGate primitive

[packages/react/src/primitives/PurchaseGate.tsx](packages/react/src/primitives/PurchaseGate.tsx) — `RootProps` becomes:

```ts
type RootProps = {
  /** Require an active purchase for this product (e.g. "prd_abc"). */
  productRef?: string
  /** Require an active purchase for this specific plan (e.g. "pln_premium"). */
  planRef?: string
  asChild?: boolean
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>
```

Matcher (lines 57-62) — AND semantics when both are supplied, both must match on the same purchase:

```ts
const { purchases, loading, error } = usePurchase()

const hasAccess = useMemo(() => {
  if (!productRef && !planRef) {
    return purchases.some(p => p.status === 'active')
  }
  return purchases.some(
    p =>
      p.status === 'active' &&
      (!productRef || p.productRef === productRef) &&
      (!planRef || p.planRef === planRef),
  )
}, [purchases, productRef, planRef])
```

This sidesteps the helper indirection for the Gate itself; `hasProductRef` / `hasPlanRef` on the context remain the public API for ad-hoc checks.

### 4. Tests

[packages/react/src/primitives/PurchaseGate.test.tsx](packages/react/src/primitives/PurchaseGate.test.tsx):

- Rename `requireProduct` → `productRef` in existing cases
- Update the `active` fixture to include `productRef: 'prd_widget'` and `planRef: 'pln_monthly'`
- `ctxWith` signature changes from `hasProduct` to `hasProductRef` + `hasPlanRef`
- Drop the `hasPlan: () => false` field
- Add new cases:
  - `planRef` matches → `allowed`
  - `planRef` does not match → `blocked`
  - `productRef` + `planRef` both match same purchase → `allowed`
  - `productRef` matches but `planRef` does not (different plan in same product) → `blocked`

All SolvaPayContext mocks need the same treatment. Grep results show ~30 sites that currently set `hasProduct` / `hasPlan`:

- `packages/react/src/__tests__/TopupForm.test.tsx`
- `packages/react/src/components/CancelPlanButton.test.tsx`
- `packages/react/src/components/CancelledPlanNotice.test.tsx`
- `packages/react/src/components/CreditGate.test.tsx`
- `packages/react/src/hooks/__tests__/usePurchase.test.tsx` (includes `hasProduct function` describe block at line 354 — rename to `hasProductRef function`)
- `packages/react/src/hooks/__tests__/usePurchaseStatus.test.tsx` (many)
- `packages/react/src/hooks/__tests__/useBalance.test.tsx`
- `packages/react/src/primitives/BalanceBadge.test.tsx`
- `packages/react/src/primitives/ProductBadge.test.tsx`
- `packages/react/src/primitives/TopupForm.test.tsx`
- `packages/react/src/__tests__/useTopup.test.ts`

Check `packages/react/src/__tests__/` for a shared test helper first — if one exists, fix it there; otherwise do the mechanical rename.

### 5. Docs and examples

- [packages/react/README.md](packages/react/README.md) line 402: document both `productRef` and `planRef` props (with an example of plan-level gating)
- [docs/guides/react.mdx](docs/guides/react.mdx) line 239: swap `requireProduct="pln_premium"` for `planRef="pln_premium"` (since the existing example was clearly aiming at plan-level gating)
- [examples/checkout-demo/README.md](examples/checkout-demo/README.md) line 244 and [examples/hosted-checkout-demo/README.md](examples/hosted-checkout-demo/README.md) line 332: replace `requirePlan="Pro Plan"` with `planRef="pln_..."`
- [packages/react/CONTRIBUTING.md](packages/react/CONTRIBUTING.md): audit for any `requireProduct` / `requirePlan` references

### 6. i18n key rename (optional cleanup)

[packages/react/src/i18n/en.ts](packages/react/src/i18n/en.ts) line 162: the error message `'PaymentForm: either planRef or productRef is required'` stays as-is (unrelated to PurchaseGate). No change.

### 7. Other callers

Search outside tests for any production consumer of `hasProduct` / `hasPlan` / `requireProduct` / `requirePlan` and update them. Primary suspects:

- `packages/react/src/hooks/usePurchase.ts` — if it proxies these fields, update
- `packages/react/__tests__/types-surface.test-d.ts` — update type assertions
- `packages/react/src/index.tsx` — re-exports

## Non-goals

- Backend, `/check-purchase`, and the protected payment services remain untouched — `productRef` is already present on purchases.
- Not touching `skills/lovable-checkout` (separate repo, already uses `productRef`).

## Verification

- `npm test` in `packages/react`
- `npm run build` in `packages/react` (types)
- Grep for residual `requireProduct`, `requirePlan`, `hasProduct`, `hasPlan` in `packages/react/src` — should only match inside `CHANGELOG.md`
- Manual sanity: `<PurchaseGate.Root planRef="pln_x">` blocks when only a different-plan purchase exists even under the same product
