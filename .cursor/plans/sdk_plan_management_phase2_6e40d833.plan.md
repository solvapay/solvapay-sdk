---
name: sdk plan management (phase 2) — MCP account-management slice
overview: 'Phase 2 scoped to what ships the MCP account-management UI without gating on any protected-file work. Ships `<CurrentPlanCard>`, `<LaunchCustomerPortalButton>`, `<UpdatePaymentMethodButton mode="portal">`, the `usePaymentMethod` hook, a new `getPaymentMethod` transport method, and MCP demo extension. Backend `GET /v1/sdk/payment-method` already landed 2026-04-20. Change-plan (`<PlanSwitcher>`, `changePlan` transport + endpoint) and setup-intent (`<PaymentMethodForm>`, `createSetupIntent` transport + endpoint) are deferred to separate PRs — see "Deferred" below. Depends on Phase 1 ([sdk_plan_selector](.cursor/plans/sdk_plan_selector_3646143f.plan.md)) + the MCP-adapter transport refactor ([react-mcp-app-adapter](.cursor/plans/react-mcp-app-adapter_e5a04f19.plan.md)) landing first — both done.'
todos:
  - id: backend-payment-method
    content: 'Backend: GET /v1/sdk/payment-method returning { kind: ''card'', brand, last4, expMonth, expYear } | { kind: ''none'' }. **Shipped 2026-04-20** — Mongo-only projection from `Customer.paymentMethods[providerId]`, no stripe.service.ts edit needed. Files: `src/customers/services/flows/customer-payment-method.flow.ts` (+ spec, 8 tests), `src/customers/types/payment-method.schemas.ts`, `src/customers/controllers/payment-method.sdk.controller.ts` (+ spec, 4 tests), CustomerService `getDefaultPaymentMethod`, `CustomerModule` registered. 12 new tests green, 41 customer tests green, full backend build clean.'
    status: completed
  - id: transport-getpaymentmethod
    content: '`SolvaPayTransport.getPaymentMethod` is already defined on the transport (landed with the adapter refactor). No change to the transport interface needed for this slice. `createHttpTransport` already wires `config.api.getPaymentMethod` (default `/api/payment-method`). `createMcpAppAdapter` already wires `MCP_TOOL_NAMES.getPaymentMethod` → `get_payment_method` tool. **Verified**.'
    status: completed
  - id: server-core-getpaymentmethod
    content: 'Add `getPaymentMethodCore(request, options)` helper to `@solvapay/server/src/helpers/payment-method.ts` following the `activation.ts` pattern (extract customerRef via `syncCustomerCore`, call `solvaPay.apiClient.getPaymentMethod`, return payload or `ErrorResult`). Add `getPaymentMethod` to the `SolvaPayClient` interface in `packages/server/src/types/client.ts`. Also add `PaymentMethodInfo` type export.'
    status: pending
  - id: next-wrappers-paymentmethod
    content: 'Add Next.js route wrapper `getPaymentMethod` to `packages/next/src/helpers/payment-method.ts` following `renewal.ts` pattern. Export from `packages/next/src/helpers/index.ts`.'
    status: pending
  - id: supabase-wrappers-paymentmethod
    content: 'Add `getPaymentMethod` handler to `@solvapay/supabase/src/handlers.ts` (+ export from index). Add `get-payment-method` Deno.serve Edge Function to `examples/supabase-edge/supabase/functions/`.'
    status: pending
  - id: use-payment-method-hook
    content: 'Add `usePaymentMethod` hook at `packages/react/src/hooks/usePaymentMethod.ts` — mirrors `useMerchant`: transport-keyed module-level single-flight cache, returns `{ paymentMethod: PaymentMethodInfo | null, loading, error, refetch }`. Reads through `config.transport.getPaymentMethod()` so MCP and HTTP share one path. Graceful `null` return when the transport method throws (so `<CurrentPlanCard>` can hide the section).'
    status: pending
  - id: current-plan-card
    content: 'Implement `<CurrentPlanCard>` at `packages/react/src/components/CurrentPlanCard.tsx`. Plan-type-aware rendering: recurring shows next billing date, one-time shows expiration or "valid indefinitely", usage-based embeds `<BalanceBadge>`. Payment-method line via `usePaymentMethod` — hidden on `{ kind: ''none'' }` OR when the hook errors. Action slots compose existing Phase 1 `<CancelPlanButton>` plus new `<UpdatePaymentMethodButton>`. Returns `null` when `usePurchase().activePurchase` is null. Primitive + default-tree shim pattern matching `PlanSelector.tsx` / `ActivationFlow.tsx`. Out of scope in this slice: `<ChangePlanButton>` slot (gated on `<PlanSwitcher>` landing in a later PR).'
    status: pending
  - id: launch-customer-portal-button
    content: '`<LaunchCustomerPortalButton>` at `packages/react/src/components/LaunchCustomerPortalButton.tsx`. Pre-fetches `transport.createCustomerSession()` on first render (lazy — not on mount), renders `<a href={customerUrl} target="_blank" rel="noopener noreferrer">` with the provided `children` / copy default. While loading the URL, renders a disabled button with the loading label. Works identically in MCP and HTTP because `createCustomerSession` is already on `SolvaPayTransport`. Minimal API: `classNames`, `children` (render-prop or ReactNode), `onLaunch(href)` callback, copy slots.'
    status: pending
  - id: update-payment-method-button
    content: '`<UpdatePaymentMethodButton>` at `packages/react/src/components/UpdatePaymentMethodButton.tsx`. **Portal-only for this slice** — composes `<LaunchCustomerPortalButton>` under the hood with SDK-standard copy ("Update card"). The `mode="inline"` (drawer with `<PaymentMethodForm>`) path is deferred to the Lovable-stack PR — we add the `mode` prop with a type of `''portal''` only and reserve the union for the future variant. Keeps the API stable when inline mode lands.'
    status: pending
  - id: i18n-slice
    content: 'Add `currentPlan` (9 keys: heading, nextBilling, renewsOn, expiresOn, paymentMethod, paymentMethodExpires, noPaymentMethod, updatePaymentButton, changePlanButton-stub), `customerPortal` (2 keys: launchButton, loadingLabel) slices to `SolvaPayCopy` types and `en.ts`. `paymentMethod` (4 keys) and `planSwitcher` (11 keys) i18n deferred with their owning components.'
    status: pending
  - id: types-exports
    content: 'Export `CurrentPlanCard`, `LaunchCustomerPortalButton`, `UpdatePaymentMethodButton`, `usePaymentMethod`, `PaymentMethodInfo`, all `*Props` types from `packages/react/src/index.tsx`. Defer `<PlanSwitcher>` / `<PaymentMethodForm>` / `ChangePlanResult` / `ChangePlanStatus` exports — they land with their components.'
    status: pending
  - id: tests
    content: 'Unit tests: `CurrentPlanCard.test.tsx` (plan-type variants recurring/one-time/usage-based; payment method present vs none vs endpoint error; slot overrides; returns null on no active purchase), `LaunchCustomerPortalButton.test.tsx` (lazy fetch, loading state, click-through, error handling), `UpdatePaymentMethodButton.test.tsx` (portal mode renders the portal button), `usePaymentMethod.test.tsx` (cached fetch, error-returns-null, refetch invalidation, transport-keyed cache isolation across providers).'
    status: pending
  - id: readme
    content: 'Add "Managing plans in an MCP App" section to `packages/react/README.md` showing the `<SolvaPayProvider config={{ transport }}>` + `<CurrentPlanCard>` + `<UpdatePaymentMethodButton>` one-liner. Note the deferred `<PlanSwitcher>` / `<PaymentMethodForm>` components with a link to the follow-up plans. Add `get_payment_method` to the "MCP App" tool-name table.'
    status: pending
  - id: demo-mcp-account-card
    content: 'Extend `examples/mcp-checkout-app/src/mcp-app.tsx`: when `hasPaidPurchase`, render `<CurrentPlanCard>` + `<LaunchCustomerPortalButton>` inside the Manage body (replaces the current `<HostedLinkButton state={customer} readyLabel="Manage purchase" />` chunk). Prove the full MCP account-management surface works inside the basic-host sandbox. Add `get_payment_method` tool registration to `examples/mcp-checkout-app/src/server.ts` wrapping `getPaymentMethodCore`.'
    status: pending
  - id: demo-readme
    content: 'Update `examples/mcp-checkout-app/README.md` — extend the tool table with `get_payment_method`, add a "What the card shows" paragraph under Flow, and note the two deferred plans (change-plan, setup-intent) so readers know what''s next.'
    status: pending
isProject: false
---

## Scope reduction: what shipped vs what deferred

User direction on 2026-04-20 cut this plan to the MVP slice that unblocks the **MCP account-management UI** without gating on any protected-file work.

### In scope (this slice)

- `GET /v1/sdk/payment-method` (already shipped, Mongo-only) ✓
- `getPaymentMethodCore` / next / supabase / edge-function wrappers
- `usePaymentMethod` React hook
- `<CurrentPlanCard>` — view-only, reads purchase + balance + payment-method
- `<LaunchCustomerPortalButton>` — works in MCP + HTTP via `createCustomerSession`
- `<UpdatePaymentMethodButton mode="portal">` — thin wrapper around the portal button
- i18n for the above (`currentPlan` + `customerPortal` copy slices)
- Tests + README + MCP demo extension

### Deferred — separate PRs

- **`<PlanSwitcher>` + change-plan backend endpoint** → new plan `sdk_plan_change_phase2b_<tbd>.plan.md`.
  - Moves the proration flow (backend PR editing `payment.service.ts` + `PurchaseProrationCalculator` wiring, new SDK transport method, React state machine with `onRequiresPayment` extension point, MCP hosted-checkout fallback) into its own deliverable.
  - Non-trivial business logic (money movement) deserves focused review and should not block the read-only account-management surface.
  - Prior exploration findings kept in the plan backlog: no Stripe Subscription in this backend, proration via `PurchaseProrationCalculator`, no `stripePriceId` on plans.

- **`<PaymentMethodForm>` + create-setup-intent backend endpoint** → new plan `sdk_setup_intent_phase2c_<tbd>.plan.md`.
  - Stripe Elements SetupIntent flow is HTTP-only (blocked in MCP iframes). MCP users update cards via `<LaunchCustomerPortalButton>` today.
  - Requires `stripe.processor.ts` edit (add `createSetupIntent`) — approved in principle but cleaner as a focused PR alongside `<PaymentMethodForm>` + `useUpdatePaymentMethod` hook + Lovable demo extension.
  - `<UpdatePaymentMethodButton>` ships now with `mode="portal"` only; `mode="inline"` added when this lands. Single prop keeps the API stable across the two PRs.

### Why this split works cleanly

Every deferred piece has a **graceful current path**: MCP users already launch hosted checkout / portal for plan changes and card updates — the hosted flows are production-ready and what the plan explicitly calls out as the sandbox-safe fallback. Landing the view-only surface first means an MCP App can show "current plan + card + manage billing" TODAY, without waiting on money-moving code review.

When `<PlanSwitcher>` lands later, the existing `<CurrentPlanCard>` grows a `<ChangePlanButton>` slot (additive change, no signature break). When `<PaymentMethodForm>` lands later, `<UpdatePaymentMethodButton mode="inline">` starts working (additive prop value).

---

> **Reading this file**: the frontmatter above defines what this PR delivers (MCP account-management MVP slice). The detailed design sections below describe the **original** Phase 2 scope — now split across this slice + two deferred follow-up plans (`<PlanSwitcher>` / change-plan, `<PaymentMethodForm>` / setup-intent). Kept as reference; do not treat the deferred content as scope.

---

## Relationship to Phase 1

Phase 1 ([sdk_plan_selector_3646143f.plan.md](.cursor/plans/sdk_plan_selector_3646143f.plan.md)) ships the full checkout loop: `<PlanSelector>`, `<PaymentForm>`, `<ActivationFlow>`, `<CheckoutLayout>`, `<CancelPlanButton>`, `<CancelledPlanNotice>`, `<CreditGate>`. A Lovable app after Phase 1 can: sign up → pick plan → pay/activate → cancel → reactivate.

**Gap**: no way to view the currently active plan, switch to a different tier mid-cycle, or update the card on file. Phase 2 closes this loop.

```mermaid
flowchart LR
  subgraph Phase1[Phase 1 shipped]
    CL[CheckoutLayout]
    CPB[CancelPlanButton]
    CPN[CancelledPlanNotice]
  end
  subgraph Phase2[Phase 2 this plan]
    CPC[CurrentPlanCard]
    PS[PlanSwitcher]
    PMF[PaymentMethodForm]
    UPM[UpdatePaymentMethodButton]
  end
  CPC --> PS
  CPC --> CPB
  CPC --> UPM
  UPM --> PMF
  PS --> CL
```

## Prerequisite: backend endpoints

Three endpoints needed on [solvapay-backend](../solvapay-backend). **Verify existence before starting SDK work**; add any that are missing as a separate backend PR. None should be novel — all follow existing `activatePlan` / `cancelRenewal` patterns:

### `POST /v1/sdk/change-plan`

```ts
Request:  { purchaseRef: string; newPlanRef: string }
Response:
  | { status: 'changed'; purchase: Purchase }            // immediate swap (downgrade scheduled, free→paid with no charge, etc.)
  | { status: 'requires_payment'; clientSecret: string } // proration charge needed; integrator confirms via PaymentElement
  | { status: 'invalid'; message: string }               // cross-product switch not allowed, no-op, etc.
```

Proration semantics live entirely backend-side. The SDK just routes the response.

### `POST /v1/sdk/create-setup-intent`

```ts
Request: {
}
Response: {
  clientSecret: string
} // Stripe SetupIntent for attaching a new card without charge
```

### `GET /v1/sdk/payment-method`

```ts
Response:
  | { kind: 'card'; brand: string; last4: string; expMonth: number; expYear: number }
  | { kind: 'none' }
```

Used by `<CurrentPlanCard>` to render "Visa •••• 4242" line. Optional for phase 2; degrade gracefully if not available.

## 1. `@solvapay/server` core helpers

Add three helpers in [packages/server/src/helpers/](packages/server/src/helpers/) following the `activation.ts` / `renewal.ts` pattern:

- [packages/server/src/helpers/change-plan.ts](packages/server/src/helpers/change-plan.ts) → `changePlanCore(req, { purchaseRef, newPlanRef })`
- [packages/server/src/helpers/payment-method.ts](packages/server/src/helpers/payment-method.ts) → `createSetupIntentCore(req)` and `getPaymentMethodCore(req)`

Wire `changePlan` and equivalents into the typed client interface in [packages/server/src/types/client.ts](packages/server/src/types/client.ts).

## 2. `@solvapay/next` and `@solvapay/supabase` wrappers

Mirror the new handlers in both runtime adapters (three-line wrappers in both):

- [packages/next/src/helpers/change-plan.ts](packages/next/src/helpers/change-plan.ts), [packages/next/src/helpers/payment-method.ts](packages/next/src/helpers/payment-method.ts)
- [packages/supabase/src/handlers.ts](packages/supabase/src/handlers.ts) — add `changePlan`, `createSetupIntent`, `getPaymentMethod` handlers + export from index.
- [examples/supabase-edge/supabase/functions/](examples/supabase-edge/supabase/functions/) — add three 3-line Deno.serve files.

Default API routes in `SolvaPayConfig.api`:

```ts
api?: {
  changePlan?: string           // '/api/change-plan'
  createSetupIntent?: string    // '/api/create-setup-intent'
  getPaymentMethod?: string     // '/api/payment-method'
}
```

## 3. React SDK primitives

### `<CurrentPlanCard>`

New file [packages/react/src/components/CurrentPlanCard.tsx](packages/react/src/components/CurrentPlanCard.tsx). Styled card showing the customer's active plan with inline management actions.

```tsx
<CurrentPlanCard
  showCancelButton?: boolean        // default true
  showChangeButton?: boolean        // default true
  showPaymentMethod?: boolean       // default true
  onChangePlan?: () => void          // override default behaviour (open PlanSwitcher inline)
  classNames?: CurrentPlanCardClassNames
  children?: (args: CurrentPlanCardRenderArgs) => ReactNode
/>
```

Default rendered tree:

- Plan name + amount + interval (via `usePurchase` + `usePlan` + `formatPrice`)
- Next billing date (recurring) / expiration (cancelled but active) / usage meter (usage-based via `useBalance`)
- Payment method: "Visa •••• 4242, expires 12/26" (from `getPaymentMethod` endpoint; hidden if unavailable)
- Action row: `<ChangePlanButton />`, `<UpdatePaymentMethodButton />`, `<CancelPlanButton />` (reuses Phase 1 component)
- Renders nothing when `usePurchase` reports no active purchase.

Plan-type-aware rendering:

- `recurring` → next billing date, "{n} days until next charge"
- `one-time` → "Expires {date}" or "Valid indefinitely"
- `usage-based` → `<BalanceBadge>` + "Top up" CTA (inline `<TopupForm>` opens on click)

### `<PlanSwitcher>`

New file [packages/react/src/components/PlanSwitcher.tsx](packages/react/src/components/PlanSwitcher.tsx). Orchestrates plan selection → change API call → optional proration payment → success. Reuses Phase 1 primitives.

```tsx
<PlanSwitcher
  productRef?: string                 // default: from active purchase
  currentPlanRef?: string              // default: from active purchase (excluded from selector)
  onSwitched?: (result) => void
  onCancelled?: () => void              // user backs out
  planSelector?: PlanSelectorFilterProps
  classNames?: PlanSwitcherClassNames
/>
```

Internal step machine:

```mermaid
stateDiagram-v2
  [*] --> select
  select --> confirming: pick new plan
  confirming --> changing: confirm
  confirming --> select: back
  changing --> switched: status=changed
  changing --> payment: status=requires_payment
  changing --> errorState: status=invalid
  payment --> switched: PaymentElement.confirm success
  payment --> errorState: payment fails
  switched --> [*]
  errorState --> select: reset
```

Slot subcomponents (matching Phase 1 patterns): `<PlanSwitcher.Selector />`, `<PlanSwitcher.ConfirmStep />`, `<PlanSwitcher.PaymentStep />`.

Confirmation step shows diff: "You're switching from {currentPlan.name} ({currentPrice}) to {newPlan.name} ({newPrice})" + proration note when recurring. Plan-type transitions (e.g. recurring → usage-based) either: (a) backend rejects as `invalid`, or (b) SDK displays "You'll cancel your current subscription and activate the new plan" and routes through `<CheckoutLayout>` for activation instead.

### `<PaymentMethodForm>`

New file [packages/react/src/components/PaymentMethodForm.tsx](packages/react/src/components/PaymentMethodForm.tsx). Variant of `<PaymentForm>` that uses SetupIntent instead of PaymentIntent — no charge, just attaches a new card.

```tsx
<PaymentMethodForm
  onSuccess?: (paymentMethodId: string) => void
  onError?: (err: Error) => void
  classNames?: PaymentMethodFormClassNames
/>
```

Reuses Stripe PaymentElement via the existing [packages/react/src/components/StripePaymentFormWrapper.tsx](packages/react/src/components/StripePaymentFormWrapper.tsx) — extract the "setup vs payment" branch into the already-planned [packages/react/src/utils/confirmPayment.ts](packages/react/src/utils/confirmPayment.ts) util so the same confirm path handles both `stripe.confirmPayment` and `stripe.confirmSetup`.

### `<UpdatePaymentMethodButton>`

Thin trigger component: opens a modal or inline drawer containing `<PaymentMethodForm>`. Default opens inline; render-prop override for custom modal styling.

### Hook additions

Extend [packages/react/src/hooks/usePurchaseActions.ts](packages/react/src/hooks/usePurchaseActions.ts) with two methods + loading flags:

```ts
changePlan: (params: { purchaseRef: string; newPlanRef: string }) => Promise<ChangePlanResult>
updatePaymentMethod: () => Promise<{ clientSecret: string }> // creates SetupIntent
isChangingPlan: boolean
isUpdatingPaymentMethod: boolean
```

Plus a new hook [packages/react/src/hooks/usePaymentMethod.ts](packages/react/src/hooks/usePaymentMethod.ts) that wraps `getPaymentMethod` with cache + loading state (mirrors `useMerchant`).

## 4. i18n additions

Three new tight slices in [packages/react/src/i18n/types.ts](packages/react/src/i18n/types.ts) + [packages/react/src/i18n/en.ts](packages/react/src/i18n/en.ts):

```ts
currentPlan: {
  heading: string // "Your plan"
  nextBilling: string // "Next billing: {date}"
  renewsOn: string // "Renews {date}"
  expiresOn: string // "Expires {date}"
  paymentMethod: string // "{brand} •••• {last4}"
  paymentMethodExpires: string // "expires {month}/{year}"
  noPaymentMethod: string // "No payment method on file"
  changePlanButton: string // "Change plan"
  updatePaymentButton: string // "Update card"
}

planSwitcher: {
  heading: string // "Switch your plan"
  confirmHeading: string // "Confirm plan change"
  currentLabel: string // "Currently on"
  newLabel: string // "Switching to"
  prorationNote: string // "You'll be charged a prorated amount for the remainder of this billing cycle."
  downgradeNote: string // "This change takes effect at the end of your current billing cycle."
  freeUpgradeNote: string // "No charge — your current credit balance will be used."
  confirmButton: string // "Confirm switch"
  switchingLabel: string // "Switching..."
  switchedHeading: string // "Plan switched"
  switchedSubheading: string // "You're now on {planName}."
}

paymentMethod: {
  heading: string // "Update payment method"
  saveButton: string // "Save card"
  savingLabel: string // "Saving..."
  savedLabel: string // "Card updated"
}
```

## 5. Types and exports

Add to [packages/react/src/types/index.ts](packages/react/src/types/index.ts) and root barrel:

- `<CurrentPlanCard>`, `<PlanSwitcher>` (+ `.Selector`, `.ConfirmStep`, `.PaymentStep`), `<PaymentMethodForm>`, `<UpdatePaymentMethodButton>`
- `ChangePlanResult`, `ChangePlanStatus`, `PaymentMethodInfo` types
- `CurrentPlanCardProps`, `PlanSwitcherProps`, `PaymentMethodFormProps`, all ClassNames/RenderArgs variants
- `usePaymentMethod` hook

No internal/public surface changes to Phase 1 primitives.

## 6. Tests

Following the Phase 1 test pattern:

- `CurrentPlanCard.test.tsx` — renders only with active purchase; plan-type variants (recurring/one-time/usage-based); payment method display with + without endpoint; slot overrides; render-prop.
- `PlanSwitcher.test.tsx` — full state machine: select → confirming → changing → switched; select → confirming → changing → payment → switched; error recovery; excludes current plan from selector; cross-type transition routes through activation path.
- `PaymentMethodForm.test.tsx` — SetupIntent flow; Stripe confirmSetup branch; success callback payload; error handling.
- `usePaymentMethod.test.tsx` — cached fetch, error state.
- `usePurchaseActions.test.ts` — add `changePlan` and `updatePaymentMethod` coverage.

## 7. Documentation

Add a fourth section to the SDK README after Phase 1's three-layer model:

- **Managing plans post-checkout** — `<CurrentPlanCard>` one-liner + `<PlanSwitcher>` composition. Show the drop-in for a typical `/account` page.
- Extend the Supabase Edge Functions section with the three new endpoints + Deno.serve files.

## 8. Demo integration

Add a new `/account` route to [examples/checkout-demo](examples/checkout-demo) that demonstrates the phase 2 primitives:

- [examples/checkout-demo/app/account/page.tsx](examples/checkout-demo/app/account/page.tsx): `<CurrentPlanCard />` as the entire page body. That's it.
- Add three API route wrappers: `/api/change-plan`, `/api/create-setup-intent`, `/api/payment-method`.
- Link from the home page nav: "Account" (only when authenticated + has active purchase).
- README update: new "Managing plans" section showing the drop-in.

The [examples/checkout-demo/app/checkout/page.tsx](examples/checkout-demo/app/checkout/page.tsx) from Phase 1 stays unchanged — checkout and account management are separate routes, and the `<CancelPlanButton>` in the checkout footer already covers inline cancellation.

## Out of scope (Phase 3)

- Invoice history / downloadable receipts / PDF generation
- Refund UI / dispute handling
- Billing address edit
- Payment failure retry flow / dunning
- Multi-product accounts (managing multiple active subscriptions in one UI)
- Tax ID / VAT number collection
- Coupons / promo codes
- Usage analytics / per-feature breakdown
- Team billing (seats, organization accounts)

## Backwards compatibility

- All additive. No changes to Phase 1 primitive signatures.
- New `api` config keys are optional; missing `getPaymentMethod` endpoint degrades `<CurrentPlanCard>` gracefully (payment method section hidden).
- New i18n slices follow the "English defaults preserve exactly" pattern.

## Dependency chain

1. Backend PR: three new endpoints (can ship independently)
2. `@solvapay/server` core helpers (depends on 1)
3. `@solvapay/next` + `@solvapay/supabase` wrappers (depends on 2)
4. `@solvapay/react` primitives + hooks (depends on 3)
5. Tests + docs + demo (depends on 4)

Each step is a separate PR. Phase 2 is not landable in a single PR.

## Related work

- [`react-mcp-app-adapter_e5a04f19.plan.md`](solvapay-sdk/.cursor/plans/react-mcp-app-adapter_e5a04f19.plan.md) — **`SolvaPayTransport` integration point**. That plan's `pick-shape` decision chooses between (a) broadening `SolvaPayProviderProps` with per-method overrides or (b) introducing a single `transport: SolvaPayTransport` prop covering every hook that currently routes through `config.fetch`. If (b) wins, the three new methods this plan adds to `SolvaPayProvider` (`changePlan`, `createSetupIntent`, `getPaymentMethod`) must land on the `SolvaPayTransport` surface rather than as new per-method `SolvaPayProviderProps` fields — otherwise Phase 2 grows a second overrides lane that has to be migrated again later.

  **Preferred sequencing**: let the adapter plan land first so `next-wrappers`, `supabase-wrappers`, and `current-plan-card` todos above target the stable `SolvaPayTransport` shape. If release cadence forces the reverse order, add a `transport-migration` follow-up todo here to fold the three Phase 2 methods back into the unified transport surface once the adapter ships. Either way, `api` config keys (`api.changePlan`, `api.createSetupIntent`, `api.paymentMethod`) stay as the HTTP-default routing and don't need to change.
