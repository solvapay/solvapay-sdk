# Refactor Proposal: Moving `hasPaidSubscription` to `useSubscription()`

## Proposed Changes

1. **Move `hasPaidSubscription` to `useSubscription()` hook**
   - More convenient - single hook call for basic paid status check
   - Logical fit - basic subscription status belongs in base hook
   - No dependencies - only needs `subscriptions` array

2. **Keep `activePaidSubscription` in `useSubscriptionStatus()`**
   - Still needed for plan name display
   - Required for subscription operations (cancellation, etc.)
   - Provides the full subscription object, not just a boolean

## Current Usage Analysis

### `hasPaidSubscription` Usage (Move to `useSubscription()`)
- Feature gating: `locked={!hasPaidSubscription}`
- Conditional rendering: `hasPaidSubscription ? ... : ...`
- Navigation buttons: `showUpgradeButton = !hasPaidSubscription`

**All simple boolean checks** - perfect candidate for base hook.

### `activePaidSubscription` Usage (Keep in `useSubscriptionStatus()`)
- Plan name display: `activePaidSubscription?.planName` (10+ locations)
- Subscription operations: `activePaidSubscription.reference` (cancellation)
- Status validation: `activePaidSubscription.status !== 'active'`

**Requires full subscription object** - should stay in status hook.

## Implementation Impact

### ✅ Benefits
1. **Simpler API**: One hook call for basic paid check
   ```typescript
   // Before
   const { subscriptions } = useSubscription();
   const { hasPaidSubscription } = useSubscriptionStatus([]);
   
   // After
   const { subscriptions, hasPaidSubscription } = useSubscription();
   ```

2. **Better separation of concerns**:
   - `useSubscription()` = Basic subscription data + paid status
   - `useSubscriptionStatus()` = Advanced status helpers + full objects

3. **Less dependency on plans array**: `hasPaidSubscription` doesn't need plans

### ⚠️ Breaking Changes
- Type signature changes (minor)
- Migration needed in all files using `hasPaidSubscription`
- Documentation updates required

### 📝 Migration Path
1. Update `SubscriptionStatus` interface to include `hasPaidSubscription`
2. Add logic to `useSubscription()` hook
3. Remove `hasPaidSubscription` from `SubscriptionStatusReturn`
4. Update all usage sites (examples + guides)

## Recommendation

**✅ Recommended:** Move `hasPaidSubscription` to `useSubscription()`

**❌ Not Recommended:** Remove `activePaidSubscription` - it's needed for operations and display

## Alternative Consideration

If you want to reduce redundancy, consider:
- Keep `activePaidSubscription` in `useSubscriptionStatus()`
- Also add `activePaidSubscription` to `useSubscription()` but only if `hasPaidSubscription === true`
- This way both hooks provide it, but users can choose based on their needs

