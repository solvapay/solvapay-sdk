# Subscription Paid Status Review

## Executive Summary

This document reviews the current implementation of subscription status checking, specifically focusing on how the SDK determines if a user has a paid subscription. The review identifies current patterns, inconsistencies, and recommendations for standardizing on `hasPaidSubscription` based on `subscription.amount > 0`.

## Key Finding

**The SDK already uses `amount > 0` as the criteria for paid subscriptions**, which aligns with the requirement. The architecture intentionally focuses on paid subscriptions only - `hasActiveSubscription` was recently removed since the application only cares if the active subscription is paid, not just whether it's active. However, some documentation still references the removed `hasActiveSubscription` property.

---

## Current Implementation

### 1. Core Logic: `isPaidSubscription` Utility

**Location:** `packages/react/src/utils/subscriptions.ts`

```typescript
export function isPaidSubscription(sub: SubscriptionInfo): boolean {
  return (sub.amount ?? 0) > 0;
}
```

✅ **Status:** Correct - Already uses `amount > 0` as the criteria for paid subscriptions.

### 2. Hook: `useSubscriptionStatus`

**Location:** `packages/react/src/utils/hooks/useSubscriptionStatus.ts`

The hook provides:
- `hasPaidSubscription: boolean` - Checks if user has any active paid subscriptions
- `activePaidSubscription: SubscriptionInfo | null` - Most recent active paid subscription
- `isPaidSubscription(sub: SubscriptionInfo): boolean` - Helper function (internal)

**Current Logic:**
```typescript
const isPaidSubscription = useCallback((sub: SubscriptionInfo): boolean => {
  return (sub.amount ?? 0) > 0;
}, []);

const activePaidSubscriptions = subscriptions.filter(
  sub => sub.status === 'active' && isPaidSubscription(sub)
);

hasPaidSubscription: activePaidSubscriptions.length > 0
```

✅ **Status:** Correct - Uses `amount > 0` to determine paid subscriptions.

### 3. Hook: `useSubscription`

**Location:** `packages/react/src/hooks/useSubscription.ts`

Returns:
- `subscriptions: SubscriptionInfo[]` - All subscriptions
- `loading: boolean` - Loading state
- `hasPlan: (planName: string) => boolean` - Check if user has a specific plan
- `refetch: () => Promise<void>` - Refetch subscriptions

✅ **Note:** `hasActiveSubscription` was intentionally removed - the SDK only tracks paid subscriptions via `hasPaidSubscription`. Users always have an active subscription (either free or paid), so checking for "active" status is unnecessary.

---

## Usage Patterns Across Codebase

### ✅ Correct Usage (Using `hasPaidSubscription`)

#### Example 1: Feature Gating
**Files:**
- `examples/checkout-demo/app/page.tsx` (lines 175, 180)
- `examples/hosted-checkout-demo/app/page.tsx` (lines 261, 266)

```typescript
const { hasPaidSubscription } = useSubscriptionStatus([]);

<FeatureCard
  title="Advanced Analytics"
  locked={!hasPaidSubscription}
/>
```

#### Example 2: Navigation Components
**Files:**
- `examples/checkout-demo/app/components/Navigation.tsx` (line 16, 20)
- `examples/hosted-checkout-demo/app/components/Navigation.tsx` (line 16, 23)

```typescript
const { hasPaidSubscription } = useSubscriptionStatus([]);
const showUpgradeButton = !subscriptionsLoading && !hasPaidSubscription;
```

#### Example 3: Checkout Actions
**File:** `examples/checkout-demo/app/checkout/components/CheckoutActions.tsx` (line 25)

```typescript
const showCancelButton = hasPaidSubscription && !shouldShowCancelledNotice;
```

#### Example 4: Conditional Rendering
**Files:**
- `examples/checkout-demo/app/page.tsx` (line 109)
- `examples/hosted-checkout-demo/app/page.tsx` (line 195)
- `examples/nextjs-openai-custom-gpt-actions/src/app/page.tsx` (line 194)

```typescript
{hasPaidSubscription ? (
  <p>You're on the {activePaidSubscription?.planName} plan</p>
) : (
  // Show upgrade prompt
)}
```

### ⚠️ Documentation Issues

#### Issue 1: Stale Documentation References to Removed `hasActiveSubscription`

**Context:** `hasActiveSubscription` was intentionally removed from the SDK because the application architecture assumes users always have an active subscription. The SDK only needs to distinguish between paid (`amount > 0`) and free (`amount === 0`) subscriptions.

**Files with Stale References:**
- `packages/react/README.md` (line 138)
- `examples/checkout-demo/README.md` (line 389)
- `examples/hosted-checkout-demo/README.md` (line 415)
- `guides/SUBSCRIPTION_STATUS_TRACKING.md` (lines 172, 237, 297, 334, 433)
- `guides/ADDING_SIGN_IN_SIGN_UP.md` (line 451)
- `guides/ADDING_SUBSCRIPTIONS.md` (line 535)
- `guides/SDK_IMPROVEMENTS_PROPOSAL.md` (line 584)

**Example from docs (outdated):**
```typescript
// ❌ Outdated - hasActiveSubscription was removed
const { subscriptions, loading, hasActiveSubscription, refetch } = useSubscription();
```

**Correct Pattern:**
```typescript
// ✅ Correct - Use hasPaidSubscription instead
const { subscriptions, loading, refetch } = useSubscription();
const { hasPaidSubscription, activePaidSubscription } = useSubscriptionStatus(plans);
```

#### Issue 2: Inconsistent Pattern Documentation

Some guides show outdated patterns using `hasActiveSubscription`, which causes confusion. All documentation should be updated to use `hasPaidSubscription` exclusively.

---

## Current Subscription Status Logic

### Subscription Status Interface

**Location:** `packages/react/src/types/index.ts`

```typescript
export interface SubscriptionStatus {
  loading: boolean;
  customerRef?: string;
  email?: string;
  name?: string;
  subscriptions: SubscriptionInfo[];
  hasPlan: (planName: string) => boolean;  // Checks if user has specific plan
}
```

**Note:** `hasActiveSubscription` was intentionally removed - the SDK focuses only on paid subscriptions since users always have an active subscription (free or paid).

### Subscription Status Return Interface

**Location:** `packages/react/src/types/index.ts`

```typescript
export interface SubscriptionStatusReturn {
  isPaidPlan: (planName: string) => boolean;
  activePaidSubscription: SubscriptionInfo | null;
  cancelledSubscription: SubscriptionInfo | null;
  hasPaidSubscription: boolean;  // ✅ This is the correct property
  shouldShowCancelledNotice: boolean;
  activePlanName: string | null;
  formatDate: (dateString?: string) => string | null;
  getDaysUntilExpiration: (endDate?: string) => number | null;
}
```

---

## Summary of Findings

### ✅ What's Working Well

1. **Core Logic is Correct:**
   - `isPaidSubscription()` utility correctly uses `(sub.amount ?? 0) > 0`
   - `useSubscriptionStatus()` hook correctly implements `hasPaidSubscription` based on amount
   - All example code uses `hasPaidSubscription` correctly

2. **Consistent Usage in Examples:**
   - All three example apps (`checkout-demo`, `hosted-checkout-demo`, `nextjs-openai-custom-gpt-actions`) use `hasPaidSubscription` consistently
   - Navigation components use `hasPaidSubscription` for upgrade button logic
   - Feature gating uses `hasPaidSubscription` correctly

3. **Clear Definition:**
   - Paid subscription = `subscription.amount > 0`
   - Free subscription = `subscription.amount === 0` or `undefined`

### ⚠️ Issues to Address

1. **Stale Documentation References:**
   - Multiple documentation files still reference `hasActiveSubscription` which was intentionally removed
   - Should be updated to use `hasPaidSubscription` pattern exclusively
   - Need to clarify that users always have an active subscription, so only paid status matters

2. **Architectural Assumption Not Documented:**
   - **Assumption:** Users always have an active subscription (free or paid)
   - **Implication:** No need to check "is active" - only need to check "is paid" (`amount > 0`)
   - **Action:** Document this assumption clearly in guides and README files

3. **Inconsistent Helper Function Names:**
   - `isPaidSubscription(sub)` - utility function (not exported in hook return)
   - `hasPaidSubscription` - boolean from hook
   - `isPaidPlan(planName)` - checks plan name against plans array
   - Consider if `isPaidSubscription` should be exported from hook for consistency

---

## Recommendations

### 1. Standardize on `hasPaidSubscription`

✅ **Already implemented correctly** - All code uses `hasPaidSubscription` from `useSubscriptionStatus()`.

### 2. Remove Stale References to `hasActiveSubscription`

**Context:** `hasActiveSubscription` was intentionally removed because:
- Users always have an active subscription (architectural assumption)
- Only distinction needed is paid vs free (`amount > 0` vs `amount === 0`)
- `hasPaidSubscription` provides the necessary functionality

**Action Items:**
- Update all documentation files to remove references to `hasActiveSubscription`
- Replace with `hasPaidSubscription` pattern
- Update README files in examples
- Add note explaining why `hasActiveSubscription` doesn't exist

### 3. Export `isPaidSubscription` Helper

**Consideration:** Should the `isPaidSubscription(sub)` helper be exported from `useSubscriptionStatus()` return value for consistency?

**Current:** Only available internally in the hook
**Proposed:** Add to `SubscriptionStatusReturn` interface

```typescript
export interface SubscriptionStatusReturn {
  // ... existing properties
  isPaidSubscription: (sub: SubscriptionInfo) => boolean;  // New
}
```

### 4. Document "Always Active Subscription" Assumption

**Architectural Decision:** `hasActiveSubscription` was removed because:
- **Assumption in place:** Users always have an active subscription (free or paid)
- **What matters:** Only whether the subscription is paid (`amount > 0`)
- **Result:** `hasPaidSubscription` is the only subscription status check needed

**Action:** Add clarification in documentation that:
- Users always have an active subscription (architectural assumption)
- `hasPaidSubscription` checks if the active subscription is paid (`amount > 0`)
- No `hasActiveSubscription` exists because active status is always true

### 5. Standardize Usage Pattern

**Recommended Pattern:**
```typescript
// ✅ Correct - Use this pattern everywhere
const { hasPaidSubscription, activePaidSubscription } = useSubscriptionStatus(plans);

// For feature gating
{hasPaidSubscription ? <PremiumFeature /> : <UpgradePrompt />}

// For conditional rendering
{hasPaidSubscription ? (
  <p>Plan: {activePaidSubscription?.planName}</p>
) : (
  <UpgradeButton />
)}
```

---

## Files Requiring Updates

### Documentation Files (Remove `hasActiveSubscription` references):

1. `packages/react/README.md`
2. `examples/checkout-demo/README.md`
3. `examples/hosted-checkout-demo/README.md`
4. `guides/SUBSCRIPTION_STATUS_TRACKING.md`
5. `guides/ADDING_SIGN_IN_SIGN_UP.md`
6. `guides/ADDING_SUBSCRIPTIONS.md`
7. `guides/SDK_IMPROVEMENTS_PROPOSAL.md`
8. `guides/COMPLETE_IMPLEMENTATION_GUIDE.md` (if applicable)

### Code Files (No changes needed - already correct):

✅ All example code files already use `hasPaidSubscription` correctly
✅ Core SDK implementation is correct
✅ Utility functions are correct

---

## Conclusion

The SDK implementation is **already correct** and uses `amount > 0` as the criteria for paid subscriptions. The architecture intentionally focuses on paid subscriptions only - `hasActiveSubscription` was removed because users always have an active subscription, so only the paid status matters.

**Primary Action:** Update all documentation to:
1. Remove stale references to `hasActiveSubscription`
2. Document the architectural assumption that users always have an active subscription
3. Standardize on `hasPaidSubscription` pattern throughout all documentation

**Secondary Consideration:** Export `isPaidSubscription` helper function from hook for consistency.

**Key Takeaway:** The SDK is designed around the assumption that users always have an active subscription. The only distinction needed is whether it's paid (`amount > 0`) or free (`amount === 0`), which is why `hasPaidSubscription` is the sole subscription status check provided.

