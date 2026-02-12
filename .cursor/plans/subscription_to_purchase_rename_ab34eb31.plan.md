---
name: Subscription to Purchase Rename
overview: Rename all "subscription" terminology to "purchase" across the SDK's React, Next.js, and server packages -- covering types, hooks, components, utilities, tests, exports, and examples -- to align with the backend data model change.
todos:
  - id: phase1-server-types
    content: 'Phase 1: Server package -- rename types in client.ts, update client.ts, factory.ts, payment.ts, paywall.ts, index.ts'
    status: pending
  - id: phase2-react-types
    content: 'Phase 2: React types/index.ts -- rename all Subscription* types to Purchase* equivalents'
    status: pending
  - id: phase3-react-utils
    content: 'Phase 3: Rename utils/subscriptions.ts to purchases.ts, rename all 6 utility functions'
    status: pending
  - id: phase4-react-hooks
    content: 'Phase 4: Rename useSubscription.ts to usePurchase.ts, useSubscriptionStatus.ts to usePurchaseStatus.ts, update useSolvaPay/useCustomer/useCheckout'
    status: pending
  - id: phase5-react-components
    content: 'Phase 5: Rename SubscriptionGate to PurchaseGate, update PlanBadge, PlanSelector, PaymentForm'
    status: pending
  - id: phase6-react-provider
    content: 'Phase 6: Update SolvaPayProvider.tsx -- all internal state, refs, callbacks, context value'
    status: pending
  - id: phase7-react-exports
    content: 'Phase 7: Update packages/react/src/index.tsx barrel exports'
    status: pending
  - id: phase8-next-package
    content: 'Phase 8: Update @solvapay/next -- cache.ts, index.ts, helpers/renewal.ts'
    status: pending
  - id: phase9-tests
    content: 'Phase 9: Rename and update all 3 test files, update vitest.config.ts, update integration test'
    status: pending
  - id: phase10-examples
    content: 'Phase 10: Update checkout-demo, openai example, shared stub'
    status: pending
  - id: phase11-docs
    content: 'Phase 11: Update guides, docs, and READMEs'
    status: pending
  - id: validation
    content: Run vitest, tsc --noEmit, and grep for remaining 'subscription' references
    status: pending
isProject: false
---

# Subscription to Purchase Rename

## Context

The backend data model has already migrated from "subscription" to "purchase". The generated OpenAPI types in `packages/server/src/types/generated.ts` already use `PurchaseInfo` and `PurchaseResponse`. The React, Next.js, and server client packages still use "subscription" terminology throughout.

This is a **breaking change** for SDK consumers.

## Naming Collision

There is an existing `PurchaseInfo` interface in `packages/server/src/types/client.ts` (lines 44-54) for one-time purchases that will collide with the rename of `SubscriptionInfo` to `PurchaseInfo`. Resolution:

- Rename the existing one-time `PurchaseInfo` to `OneTimePurchaseInfo`
- `ProcessPaymentResult.type` changes from `'subscription' | 'purchase'` to `'recurring' | 'one-time'`
- The `subscription?` field on `ProcessPaymentResult` becomes `purchase?` using the generated schema type

## Execution Order

Changes applied bottom-up (dependencies first): server types, react types, react utils, react hooks, react components, provider, exports, next.js, tests, examples.

---

## Phase 1: Server Package Types

### 1.1 `packages/server/src/types/client.ts`

- `CustomerResponseMapped.subscriptions` --> `CustomerResponseMapped.purchases`
- Rename custom `PurchaseInfo` (one-time, lines 44-54) to `OneTimePurchaseInfo`
- `ProcessPaymentResult.type: 'subscription' | 'purchase'` --> `type: 'recurring' | 'one-time'`
- `ProcessPaymentResult.subscription?` --> `ProcessPaymentResult.purchase?` (typed as `components['schemas']['PurchaseInfo']`)
- Update JSDoc comments

### 1.2 `packages/server/src/index.ts`

- Update re-export: `PurchaseInfo` --> `OneTimePurchaseInfo`

### 1.3 `packages/server/src/client.ts`

- `getCustomer()` return: rename `subscriptions` field to `purchases` (around line 183)
- Update variable names and comments

### 1.4 `packages/server/src/factory.ts`

- Update JSDoc comments mentioning "subscription"

### 1.5 `packages/server/src/helpers/payment.ts`

- Update JSDoc/comments mentioning "subscription"

### 1.6 `packages/server/src/paywall.ts`

- Error message: "Plan subscription required" --> "Plan purchase required"

---

## Phase 2: React Package Types

### 2.1 `packages/react/src/types/index.ts`

Type renames:

- `SubscriptionInfo` --> `PurchaseInfo`
- `CustomerSubscriptionData` --> `CustomerPurchaseData`
- `SubscriptionStatus` --> `PurchaseStatus`
- `SubscriptionGateProps` --> `PurchaseGateProps`
- `SubscriptionStatusReturn` --> `PurchaseStatusReturn`

Field/prop renames:

- `SolvaPayConfig.api.checkSubscription` --> `checkPurchase`
- `SolvaPayContextValue.subscription` --> `purchase`
- `SolvaPayContextValue.refetchSubscription` --> `refetchPurchase`
- `SolvaPayProviderProps.checkSubscription` --> `checkPurchase`
- All `subscriptions: SubscriptionInfo[]` --> `purchases: PurchaseInfo[]`
- `activeSubscription` --> `activePurchase`
- `hasPaidSubscription` --> `hasPaidPurchase`
- `activePaidSubscription` --> `activePaidPurchase`

---

## Phase 3: React Utilities

### 3.1 Rename file: `packages/react/src/utils/subscriptions.ts` --> `purchases.ts`

Function renames:

- `filterSubscriptions()` --> `filterPurchases()`
- `getActiveSubscriptions()` --> `getActivePurchases()`
- `getCancelledSubscriptionsWithEndDate()` --> `getCancelledPurchasesWithEndDate()`
- `getMostRecentSubscription()` --> `getMostRecentPurchase()`
- `getPrimarySubscription()` --> `getPrimaryPurchase()`
- `isPaidSubscription()` --> `isPaidPurchase()`

All parameter names and JSDoc updated (e.g. `sub` --> `purchase`).

---

## Phase 4: React Hooks

### 4.1 Rename file: `useSubscription.ts` --> `usePurchase.ts`

- `useSubscription()` --> `usePurchase()`
- Return type: `PurchaseStatus & { refetch }`
- Reads `purchase` / `refetchPurchase` from context

### 4.2 Rename file: `useSubscriptionStatus.ts` --> `usePurchaseStatus.ts`

- `useSubscriptionStatus()` --> `usePurchaseStatus()`
- Return type: `PurchaseStatusReturn`
- Internal: `cancelledSubscription` --> `cancelledPurchase`, `isPaidSubscription` --> `isPaidPurchase`

### 4.3 `packages/react/src/hooks/useSolvaPay.ts`

- Update context destructuring: `subscription`/`refetchSubscription` --> `purchase`/`refetchPurchase`

### 4.4 `packages/react/src/hooks/useCustomer.ts`

- Update `subscription` from context to `purchase`

### 4.5 `packages/react/src/hooks/useCheckout.ts`

- Update JSDoc "subscribe to a plan" references

---

## Phase 5: React Components

### 5.1 Rename file: `SubscriptionGate.tsx` --> `PurchaseGate.tsx`

- Component: `SubscriptionGate` --> `PurchaseGate`
- Uses `usePurchase()`, render prop `purchases`

### 5.2 `packages/react/src/components/PlanBadge.tsx`

- `useSubscription` --> `usePurchase`, `subscriptions` --> `purchases`

### 5.3 `packages/react/src/components/PlanSelector.tsx`

- Same pattern as PlanBadge

### 5.4 `packages/react/src/PaymentForm.tsx`

- `useSubscription` --> `usePurchase`

---

## Phase 6: React Provider

### 6.1 `packages/react/src/SolvaPayProvider.tsx`

Internal state/variable renames:

- `subscriptionData` --> `purchaseData` (type `CustomerPurchaseData`)
- `fetchSubscription()` --> `fetchPurchase()`
- `refetchSubscription()` --> `refetchPurchase()`
- `checkSubscriptionRef` --> `checkPurchaseRef`
- `buildDefaultCheckSubscriptionRef` --> `buildDefaultCheckPurchaseRef`
- `customCheckSubscription` prop --> `customCheckPurchase`
- `subscription` computed variable --> `purchase` (type `PurchaseStatus`)
- Utility calls: `filterSubscriptions` --> `filterPurchases`, `getPrimarySubscription` --> `getPrimaryPurchase`, `isPaidSubscription` --> `isPaidPurchase`
- Default API route: `'/api/check-subscription'` --> `'/api/check-purchase'`
- Context value keys: `{ purchase, refetchPurchase, ... }`

---

## Phase 7: React Barrel Exports

### 7.1 `packages/react/src/index.tsx`

Update all exports to new names and import paths:

- Components: `PurchaseGate` from `./components/PurchaseGate`
- Hooks: `usePurchase` from `./hooks/usePurchase`, `usePurchaseStatus` from `./hooks/usePurchaseStatus`
- Types: `PurchaseStatus`, `PurchaseInfo`, `CustomerPurchaseData`, `PurchaseGateProps`, `PurchaseStatusReturn`
- Utils: `filterPurchases`, `getActivePurchases`, `getCancelledPurchasesWithEndDate`, `getMostRecentPurchase`, `getPrimaryPurchase`, `isPaidPurchase` from `./utils/purchases`

---

## Phase 8: Next.js Package

### 8.1 `packages/next/src/cache.ts`

- `SubscriptionCheckResult` --> `PurchaseCheckResult`
- `subscriptions` array field --> `purchases`
- `sharedSubscriptionDeduplicator` --> `sharedPurchaseDeduplicator`
- `clearSubscriptionCache()` --> `clearPurchaseCache()`
- `clearAllSubscriptionCache()` --> `clearAllPurchaseCache()`
- `getSubscriptionCacheStats()` --> `getPurchaseCacheStats()`

### 8.2 `packages/next/src/index.ts`

- `checkSubscription()` --> `checkPurchase()`
- `CheckSubscriptionOptions` --> `CheckPurchaseOptions`
- Update re-exports of cache functions
- Internal: `filteredSubscriptions` --> `filteredPurchases`

### 8.3 `packages/next/src/helpers/renewal.ts`

- Update `clearSubscriptionCache` import to `clearPurchaseCache`

---

## Phase 9: Tests

### 9.1 Rename: `utils/__tests__/subscriptions.test.ts` --> `purchases.test.ts`

- Update all imports, describe blocks, variable names (`mockSubscription` --> `mockPurchase`)

### 9.2 Rename: `hooks/__tests__/useSubscription.test.tsx` --> `usePurchase.test.tsx`

- Update all imports, mocks, assertions, describe/it blocks

### 9.3 Rename: `hooks/__tests__/useSubscriptionStatus.test.tsx` --> `usePurchaseStatus.test.tsx`

- Same pattern

### 9.4 `packages/react/vitest.config.ts`

- Coverage include: `src/hooks/useSubscription.ts` --> `src/hooks/usePurchase.ts`

### 9.5 `packages/server/__tests__/payment-stripe.integration.test.ts`

- Update "subscription" references in comments/test names

---

## Phase 10: Examples

### 10.1 `examples/checkout-demo/`

- Rename `SubscriptionNotices.tsx` component, update hook imports/types
- `app/checkout/page.tsx`: update `usePurchase`/`usePurchaseStatus` calls
- `app/api/cancel-renewal/route.ts`: update if needed

### 10.2 `examples/nextjs-openai-custom-gpt-actions/`

- Rename `check-subscription` route directory/file
- Update plan route, schemas, OpenAPI descriptions

### 10.3 `examples/shared/stub-api-client.ts`

- `subscriptions: []` --> `purchases: []`

---

## Phase 11: Docs and Guides

- Update `packages/create-solvapay-app/guides/03-payments.md` and any other guides
- Update `docs/` markdown files referencing subscription terminology
- Update README files in `packages/next/README.md` etc.

---

## Validation

After all changes:

- Run `npx vitest` in `packages/react` to verify all renamed tests pass
- Run `npx tsc --noEmit` in each package to verify type correctness
- Grep for any remaining "subscription" references (excluding `node_modules`, `.git`, `generated.ts`)
