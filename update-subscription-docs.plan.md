<!-- 44c20492-876a-444e-af15-d6737960e42f 2a4581ad-e730-4fd4-b5d2-16bf6550c08e -->
# Update SolvaPay Subscription Documentation

## Overview

Update `/Users/tommy/projects/solvapay/solvapay-sdk/secrets/lovable-integration.md` to match the current SDK implementation and reflect a Free + Pro ($20/month) subscription model for Vite React apps with Supabase edge functions.

**IMPORTANT UPDATE (Oct 29, 2025):** A comprehensive proposal for headless React components has been created that will dramatically improve the developer experience. This documentation update should now also reflect the new component architecture once implemented.

## Recent Findings (from React Components Proposal)

### New SDK Components (Proposed)

The `@solvapay/react` package will include new headless, backend-agnostic components:

1. **Enhanced `<SolvaPayProvider>`** - Context provider with subscription management
   - Accepts `createPayment` and `checkSubscription` callback functions
   - Backend-agnostic design (works with Supabase, Next.js, Express, etc.)
   - Manages subscription state globally

2. **`<UpgradeButton>`** - Headless upgrade button component
   - Handles complete checkout flow
   - Render prop pattern for styling flexibility
   - Built-in loading/error states

3. **`<PlanBadge>`** - Headless plan display component
   - Shows current subscription status
   - Multiple styling patterns supported
   - Automatic refresh on plan changes

4. **`<SubscriptionGate>`** - Headless access control component
   - Conditional rendering based on plan
   - Custom paywall support
   - Loading states built-in

### New SDK Hooks (Proposed)

1. **`useSubscription()`** - Returns current subscription status
   - `{ plan, isPro, loading, customerRef, email, name, refetch }`
   - Auto-refresh capability
   - Type-safe

2. **`useCheckout(planRef)`** - Manages checkout flow
   - Creates payment intent
   - Returns Stripe promise and client secret
   - Handles loading/error states

3. **`useSolvaPay()`** - Access to SolvaPay context
   - Low-level access for custom implementations

### Developer Experience Impact

- **97% code reduction**: From ~365 lines to ~31 lines for typical implementation
- **Backend agnostic**: Examples work with any backend
- **Styling agnostic**: Works with Tailwind, shadcn/ui, Material UI, etc.
- **Zero breaking changes**: All additions, existing components unchanged

## Key Changes Required

### 1. Update Subscription Model

- Change from "14-day trial + $20/month" to "Free (default) + Pro ($20/month)"
- Update all references throughout the document
- Clarify that Free plan is assigned by default on signup

### 2. Fix React Component Names

Current doc shows:
- `StripeProvider` and `CheckoutForm` (INCORRECT)

Should be:
- `SolvaPayProvider` and `PaymentForm` (from actual SDK exports in `packages/react/src/index.tsx`)

**NEW (Proposed):** Once headless components are implemented, showcase:
- Enhanced `SolvaPayProvider` with subscription callbacks
- `UpgradeButton` with render props
- `PlanBadge` for status display
- `SubscriptionGate` for feature gating

### 3. Update Supabase Edge Function Examples

**`create-payment` function:**
- Already correctly uses `createSolvaPayClient` 
- Already correctly uses `createPaymentIntent` method
- Ensure proper error handling
- Returns `{ clientSecret, publishableKey, accountId? }`

**`check-subscription` function:**
- Replace `checkLimits` with `getCustomer` method
- `getCustomer` returns `{ customerRef, email?, name?, plan? }`
- The `plan` field indicates subscription status (e.g., "free", "pro")
- Much simpler API for checking subscription status
- Should return: `{ plan: string, isPro: boolean, customerRef?, email?, name? }`

### 4. Update React Hook Implementation

**`useSubscription` hook (Current Custom Implementation):**
- Adjust to work with Free/Pro model instead of trial model
- Parse subscription status from edge function response
- Handle cases: Free plan (default) vs Pro plan (paid)

**NEW (Proposed SDK Hook):** Once implemented, replace custom hook with:
```typescript
import { useSubscription } from '@solvapay/react';

function MyComponent() {
  const { plan, isPro, loading, refetch } = useSubscription();
  // ... use subscription state
}
```

### 5. Update CheckoutButton Component

**Current Approach:**
- Change from `StripeProvider` to `SolvaPayProvider`
- Change from `CheckoutForm` to `PaymentForm`
- Update button text from "Start 14-Day Free Trial..." to "Upgrade to Pro - $20/month"
- Use Supabase Auth user ID as `customerRef`

**NEW (Proposed Approach):** Once implemented, showcase:
```typescript
<UpgradeButton planRef="pro">
  {({ onClick, loading, disabled }) => (
    <button 
      onClick={onClick}
      disabled={disabled}
      className="your-custom-styles"
    >
      {loading ? 'Processing...' : 'Upgrade to Pro - $20/month'}
    </button>
  )}
</UpgradeButton>
```

### 6. Update Code Examples

- Ensure all imports match actual SDK exports
- Update test card instructions
- Fix component prop names to match actual SDK types
- **NEW:** Add examples using headless components once available
- **NEW:** Show backend-agnostic patterns (not just Supabase)
- **NEW:** Demonstrate render prop patterns for styling flexibility

### 7. Update Features Section

- Remove "14-Day Free Trial" feature
- Add "Free Plan (default on signup)"
- Update billing description to reflect Free/Pro model
- **NEW:** Add "Headless UI Components" feature
- **NEW:** Add "Backend Agnostic" feature
- **NEW:** Add "Styling Framework Agnostic" feature

### 8. Verify Technical Accuracy

- Component props match `SolvaPayProviderProps` and `PaymentFormProps`
- Edge function uses correct `createPaymentIntent` parameters
- Type definitions are accurate
- Import paths are correct
- **NEW:** Verify new component props match proposal specifications
- **NEW:** Ensure callback function signatures are correct
- **NEW:** Validate render prop patterns

### 9. Add Feature Gating Examples (NEW)

While feature gating was originally out of scope, the new `<SubscriptionGate>` component makes this trivial:

```typescript
<SubscriptionGate requirePlan="pro">
  {({ hasAccess, loading }) => {
    if (loading) return <Skeleton />;
    
    if (!hasAccess) {
      return (
        <div>
          <p>Upgrade to access this feature</p>
          <UpgradeButton planRef="pro">
            {({ onClick }) => <button onClick={onClick}>Upgrade</button>}
          </UpgradeButton>
        </div>
      );
    }
    
    return <ProFeature />;
  }}
</SubscriptionGate>
```

### 10. Add Provider Setup Section (NEW)

Document the one-time setup of `SolvaPayProvider` at app root:

```typescript
<SolvaPayProvider
  customerRef={user?.id}
  createPayment={async ({ planRef, customerRef }) => {
    const { data } = await supabase.functions.invoke('create-payment', {
      body: { userId: customerRef, planRef }
    });
    return data;
  }}
  checkSubscription={async (customerRef) => {
    const { data } = await supabase.functions.invoke('check-subscription', {
      body: { userId: customerRef }
    });
    return data;
  }}
>
  <App />
</SolvaPayProvider>
```

## Files to Update

- `/Users/tommy/projects/solvapay/solvapay-sdk/secrets/lovable-integration.md` (main file)

## Implementation Notes

- Use Supabase Auth user ID as `customerRef` throughout examples
- Embedded checkout (inline form) as specified
- OAuth integration assumed when user account is created
- **NEW:** Examples should demonstrate headless component flexibility
- **NEW:** Show both current implementation and proposed new components
- **NEW:** Include migration path from custom hooks to SDK hooks

## Phased Documentation Approach

### Phase 1: Current SDK (Immediate)
Update documentation to reflect:
- Free/Pro pricing model
- Correct component names (SolvaPayProvider, PaymentForm)
- Correct API methods (getCustomer instead of checkLimits)
- Proper TypeScript types

### Phase 2: Proposed Components (After Implementation)
Once new components are implemented, add:
- Headless component examples
- useSubscription hook documentation
- useCheckout hook documentation
- UpgradeButton usage patterns
- PlanBadge usage patterns
- SubscriptionGate usage patterns
- Migration guide from custom implementations

### Phase 3: Advanced Patterns (Optional)
- Multiple styling framework examples (Tailwind, shadcn/ui, Material UI)
- Multiple backend examples (Supabase, Next.js, Express)
- Advanced feature gating patterns
- Custom payment form in modal examples

## To-dos

### Phase 1: Immediate Updates (Current SDK)
- [ ] Update all references from 14-day trial model to Free + Pro ($20/month) model throughout document
- [ ] Replace StripeProvider/CheckoutForm with SolvaPayProvider/PaymentForm in all examples
- [ ] Update Supabase edge function examples to use `getCustomer` method
- [ ] Fix edge function response types to match proposed hook interfaces
- [ ] Update React hook examples with correct SDK props and behavior
- [ ] Update version info, features list, and description sections to match new model
- [ ] Review all code examples for technical accuracy against actual SDK exports
- [ ] Add note about upcoming headless components

### Phase 2: New Components Documentation (After Implementation)
- [ ] Document enhanced SolvaPayProvider with callback props
- [ ] Add comprehensive UpgradeButton examples with multiple styling approaches
- [ ] Add PlanBadge examples showing render prop patterns
- [ ] Add SubscriptionGate examples with custom paywalls
- [ ] Document useSubscription hook with all return properties
- [ ] Document useCheckout hook with checkout flow examples
- [ ] Create migration guide from custom hooks to SDK hooks
- [ ] Add "Before/After" code comparison showing 97% reduction
- [ ] Update features list to highlight new components
- [ ] Add troubleshooting section for common issues

### Phase 3: Advanced Documentation (Optional)
- [ ] Add Tailwind CSS styling examples
- [ ] Add shadcn/ui integration examples
- [ ] Add Material UI integration examples
- [ ] Add Next.js App Router example
- [ ] Add Express + React SPA example
- [ ] Add advanced feature gating patterns
- [ ] Add custom modal checkout examples
- [ ] Add performance optimization tips

## Success Metrics

### Documentation Quality
- Clear examples for both current and proposed implementations
- Copy-paste ready code snippets
- TypeScript types fully documented
- All imports and paths verified

### Developer Experience
- Reduce implementation time from hours to minutes
- Eliminate common integration mistakes
- Provide clear migration path when new components are ready
- Support multiple styling frameworks and backends

## References

- **React Components Proposal:** `/Users/tommy/projects/solvapay/solvapay-sdk/docs/react-components-proposal.md`
- **Current SDK Source:** `packages/react/src/`
- **Server SDK Source:** `packages/server/src/`
- **Integration Examples:** `examples/` directory

---

**Document Version:** 2.0  
**Last Updated:** October 29, 2025  
**Status:** Updated with React Components Proposal findings

