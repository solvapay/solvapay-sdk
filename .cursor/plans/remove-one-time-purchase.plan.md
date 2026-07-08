---
name: remove-one-time-purchase
overview: "Builds on the lifetime-badge fix. Collapses `ProcessPaymentResult`'s `{ type, purchase } | { type, oneTimePurchase }` discriminated union back into a single `{ status, purchase: PurchaseInfo }` by having the backend return a unified `PurchaseInfo` for one-time purchases (with `planSnapshot.planType: 'one-time'` as the existing data-layer discriminator). Removes `OneTimePurchaseInfo`, the `normalizeOneTimePurchase` shim, and the `type` discriminator. As a side benefit, removes the backend's 2-second `setTimeout` workaround."
todos:
  - id: backend-unify-response
    content: "Backend: in `processPaymentIntent` controller/service, construct a full `PurchaseInfo` (with `planSnapshot.planType: 'one-time'`) for one-time purchases and return it under `purchase` alongside the existing `oneTimePurchase` (dual-write). Update `@ApiOkResponse` schema. Regenerate SDK types."
    status: pending
  - id: sdk-collapse-type
    content: 'SDK: collapse `ProcessPaymentResult` to `{ status, purchase: PurchaseInfo, oneTimePurchase?: deprecated, type?: deprecated }`. Mark `OneTimePurchaseInfo` and the legacy fields `@deprecated`.'
    status: pending
  - id: sdk-converge-consumers
    content: "SDK: replace the `if (type === 'recurring')` branch in `PaymentForm.PaidInner` with an unconditional `upsertPurchase(reconcile.result.purchase)`. Delete `normalizeOneTimePurchase` and its tests. Drop the `type` field from `examples/shared/stub-api-client.ts`."
    status: pending
  - id: sdk-hard-remove
    content: 'SDK (follow-up release): delete `OneTimePurchaseInfo`, the `oneTimePurchase` field, the `type` field, and their re-exports. Backend stops dual-writing `oneTimePurchase`. Add changeset entry flagging the breaking type change.'
    status: pending
  - id: backend-drop-2s-wait
    content: 'Backend: remove the `await new Promise(r => setTimeout(r, 2000))` in `payment-intent.sdk.controller.ts` — the controller now constructs the `PurchaseInfo` synchronously, so the blind wait compensates for nothing.'
    status: pending
  - id: verify-end-to-end
    content: 'Manual + automated verify: chat-checkout-demo subscription→lifetime flips badge in one render with no setTimeout in the success path; `rg -n "OneTimePurchaseInfo|oneTimePurchase" packages/react/src` clean of non-test references.'
    status: pending
isProject: false
---

# Remove need for `oneTimePurchase` — incremental cleanup

## Premise

The `fix-lifetime-badge-stale` plan has landed: `upsertPurchase` exists, `PaymentForm.PaidInner` is loop-free, and `ProcessPaymentResult` is a discriminated union with a `normalizeOneTimePurchase` shim bridging `OneTimePurchaseInfo` into `PurchaseInfo` shape before calling `upsertPurchase`. The shim was a known wart in that plan's open-question section. This plan kills it.

## Why two fields exist today (the answer to "why?")

- `purchase: PurchaseInfo` — rich row shape, `productName`/`status`/`startDate`/`planSnapshot`/`endDate`/`cancelledAt`/`planRef`. Same shape stored in the provider's `purchases` array.
- `oneTimePurchase: OneTimePurchaseInfo` — lean receipt shape, only `reference`/`productRef`/`amount`/`currency`/`creditsAdded`/`completedAt`.

The lean shape is historical (a "topup receipt" projection from before one-time purchases were modelled as first-class `Purchase` rows). It carries no information the rich shape can't carry, and no SDK consumer reads any field off `oneTimePurchase` other than as a parameter to `normalizeOneTimePurchase`. Confirmed via `rg -n "oneTimePurchase\." packages/` → zero hits. `creditsAdded` is the only `OneTimePurchaseInfo`-specific field, and `useCheckoutFlow.recordPaygSuccess` computes it locally from balance state — it does not pull from `OneTimePurchaseInfo`.

So: `oneTimePurchase` is a separate field today purely because the backend constructs a separate shape. Unify that and the field collapses out for free.

## Publication status — does deprecation matter?

`@solvapay/server@1.0.12` (latest) ships both `OneTimePurchaseInfo` and `oneTimePurchase` in `dist/index.d.ts` and the public export list — verified by inspecting the published tarball:

- `interface OneTimePurchaseInfo` at line 2659
- `oneTimePurchase?: OneTimePurchaseInfo` on `ProcessPaymentResult` at line 2673
- Both in the `export { type ... }` block at line 4646

But the field has **never been populated on the wire** — the backend's `processPaymentIntent` only ever returned `{ status, message? }`, so any integrator who typed against `oneTimePurchase` was reading `undefined` at runtime. Type-only consumers (variable/function-signature annotations) are theoretically possible but provably useless.

This means:

- The hard removal in Step 4 IS a breaking type change semver-wise (next major release, e.g. `2.0.0`).
- Practical runtime impact on integrators is zero — nothing depended on it working because it never worked.
- A deprecation cycle (Step 2) is the polite path; a same-major hard removal is justifiable on the grounds that no functional code can possibly depend on the field. Pick based on release cadence preference.

## Target end state

```ts
// packages/server/src/types/client.ts
export interface ProcessPaymentResult {
  status: 'completed'
  purchase: components['schemas']['PurchaseInfo']
}
```

- No `type` discriminator (read `purchase.planSnapshot?.planType` if needed — matches how `App.tsx` already discriminates today).
- No `oneTimePurchase` field.
- `OneTimePurchaseInfo` type deleted from public exports.
- `normalizeOneTimePurchase` deleted from SDK.
- Backend's `await new Promise(r => setTimeout(r, 2000))` in `processPaymentIntent` controller — gone, because the controller now constructs the `PurchaseInfo` synchronously in the response path.

## Incremental sequence

Each step is an atomic, mergeable change that leaves the system green.

### Step 1 — Backend constructs unified `PurchaseInfo` for one-time purchases

`solvapay-backend/src/payments/services/payment-intent.service.ts` and the SDK controller [src/payments/controllers/payment-intent.sdk.controller.ts](solvapay-backend/src/payments/controllers/payment-intent.sdk.controller.ts#L422).

Today's flow: webhook handler creates the Purchase row asynchronously; controller waits 2s and returns `{ status: 'succeeded' }`. The lifetime-badge plan (assumed landed) augmented this to return either `purchase` or `oneTimePurchase` depending on plan type.

Change the one-time branch to construct a full `PurchaseInfo` (same shape that `GET /v1/sdk/customers/.../purchases` returns) instead of `OneTimePurchaseInfo`. Set `planSnapshot.planType = 'one-time'`. The discriminator now lives where consumers already read it.

This step keeps `oneTimePurchase` populated in parallel during the transition (dual-write) so existing SDK code on older versions doesn't break.

Update the OpenAPI schema (`@ApiOkResponse`) to declare the unified `purchase: PurchaseInfo` field. Regenerate SDK types: `cd packages/server && npm run generate:types`.

### Step 2 — SDK type collapses the union

`packages/server/src/types/client.ts`:

```ts
export interface ProcessPaymentResult {
  status: 'completed'
  purchase: components['schemas']['PurchaseInfo']
  /** @deprecated removed in next major; read `purchase` directly */
  oneTimePurchase?: OneTimePurchaseInfo
  /** @deprecated removed in next major; read `purchase.planSnapshot?.planType` */
  type?: 'recurring' | 'one-time'
}

/** @deprecated removed in next major */
export interface OneTimePurchaseInfo {
  /* unchanged */
}
```

The discriminated union becomes a single shape; the legacy fields stay optional + deprecated for one minor release.

### Step 3 — SDK consumers converge on `purchase`

[packages/react/src/primitives/PaymentForm.tsx](packages/react/src/primitives/PaymentForm.tsx) — the lifetime-badge plan left this as:

```ts
if (reconcile.result.type === 'recurring') {
  upsertPurchase(reconcile.result.purchase)
} else {
  upsertPurchase(normalizeOneTimePurchase(reconcile.result.oneTimePurchase))
}
```

Collapses to:

```ts
upsertPurchase(reconcile.result.purchase)
```

Delete `normalizeOneTimePurchase` (and its tests). The `reconcilePayment` success variant in [packages/react/src/utils/processPaymentResult.ts](packages/react/src/utils/processPaymentResult.ts) simplifies from `{ status: 'success'; result: ProcessPaymentResult }` to the same shape — no caller code changes needed beyond dropping the discriminator branch.

Audit `examples/shared/stub-api-client.ts` line 582 — the local stub already returns `{ type: 'recurring', purchase, status: 'completed' }`. Drop `type`; the rest stays.

### Step 4 — Hard remove `OneTimePurchaseInfo` + legacy fields

Semver-wise this is a breaking type change (`@solvapay/server` next major). Practical runtime impact on integrators is zero — see "Publication status" above. Two acceptable variants:

- **Deprecation-then-major** (default): ship Step 2's deprecated fields in a minor, then remove in the next major. Cleanest signalling.
- **Same-major hard removal**: skip the deprecation window, jump straight to the next major release. Justifiable because no integrator can have a working runtime dependency on a never-populated field.

Whichever variant ships:

- Delete `OneTimePurchaseInfo` from `packages/server/src/types/client.ts`.
- Delete `oneTimePurchase` and `type` fields from `ProcessPaymentResult`.
- Remove `OneTimePurchaseInfo` re-exports from `packages/server/src/index.ts` and `edge.ts`.
- Stop dual-writing `oneTimePurchase` in the backend's response.
- Changeset entry: `breaking — removed deprecated OneTimePurchaseInfo type and oneTimePurchase/type fields on ProcessPaymentResult; use purchase + purchase.planSnapshot.planType instead`.

### Step 5 — Drop the backend 2s `setTimeout`

[solvapay-backend/src/payments/controllers/payment-intent.sdk.controller.ts:438-442](solvapay-backend/src/payments/controllers/payment-intent.sdk.controller.ts#L438):

```ts
// Wait 2 seconds to ensure purchase is created before returning
// This is a workaround needed to ensure the purchase is created before
// navigation from checkout page is done to reflect the purchase in the UI
// consider replacing with actual purchase creation check
await new Promise(resolve => setTimeout(resolve, 2000))
```

Step 1 made the controller actively construct the `PurchaseInfo` it returns, so this blind wait is no longer compensating for anything — the row either exists at response time or the response would have failed. Delete the `await`, delete the comment. End-to-end test verifies the chat-checkout-demo still flips badges within one render after a real Stripe confirmation.

## Sequencing notes

- Steps 1–3 are coordinated across `solvapay-backend` and `solvapay-sdk`. Backend deploys first (Step 1) so the SDK can rely on `purchase` being populated. Then SDK ships Steps 2+3 in one release.
- Step 4 is a separate SDK major (or signposted minor). Doesn't require coordination with backend beyond stopping the dual-write.
- Step 5 is backend-only and can ship any time after Step 1.

## Verification

- After Step 1: hit `POST /v1/sdk/payment-intents/.../process` with a one-time plan; response includes `purchase` with `planSnapshot.planType: 'one-time'`. Old `oneTimePurchase` field still present.
- After Step 3: `rg -n "OneTimePurchaseInfo|oneTimePurchase|normalizeOneTimePurchase" packages/react/src` returns no hits in non-test source. `pnpm --filter @solvapay/react test:unit` clean.
- After Step 5: chat-checkout-demo subscription→lifetime flow completes faster (no 2s artificial wait). `rg -n "setTimeout" packages/server/src` and the backend controller file return no workaround-style hits.

## Out of scope

- The `OneTimePurchaseInfo.creditsAdded` field doesn't need a home on `PurchaseInfo` because no SDK consumer reads it from the response — `useCheckoutFlow.recordPaygSuccess` derives `creditsAdded` locally from balance state. If a future feature needs server-truth `creditsAdded`, add it as an optional field on `PurchaseInfo` then.
- Webhook idempotency between the controller's synchronous purchase-row write and the async webhook handler. Out of scope here; flag as a backend-side review item if Step 1 reveals the row isn't already written synchronously by the time `processPaymentIntent` returns.
