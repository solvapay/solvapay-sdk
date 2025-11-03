# Hosted Checkout Migration Plan

This document outlines all changes needed to migrate from the embedded checkout flow to hosted checkout on `app.solvapay.com`.

## Overview

The hosted checkout demo will:
- Remove all embedded checkout UI components and payment processing
- Redirect users to `app.solvapay.com` for checkout and subscription management
- Use backend API routes to generate tokens for secure access to hosted pages
- Maintain subscription status checking and display on the home page

## Architecture Changes

### Current Flow (checkout-demo)
1. User clicks "View Plans" → Navigates to `/checkout`
2. User selects plan → Shows payment form
3. User enters payment details → Creates payment intent → Processes payment
4. User stays on same domain throughout

### New Flow (hosted-checkout-demo)
1. User clicks "View Plans" → Redirects to `app.solvapay.com/checkout?token=<checkout-token>`
2. User completes checkout on hosted page → Redirects back to app
3. For subscription management → Redirects to `app.solvapay.com/customer?token=<manage-token>`

## Files to Remove

### Complete Directory Removals
- `/app/checkout/` - Entire checkout directory including:
  - `page.tsx` - Main checkout page
  - `components/` - All checkout components:
    - `CheckoutActions.tsx`
    - `PaymentFormSection.tsx`
    - `PaymentSummary.tsx`
    - `PlanSelectionSection.tsx` (if not used elsewhere)
    - `SubscriptionNotices.tsx` (if not used elsewhere)
    - `SuccessMessage.tsx`
  - `utils/` - Checkout utilities:
    - `dateHelpers.ts` (if not used elsewhere)
    - `planHelpers.ts` (if not used elsewhere)

### API Routes to Remove
- `/app/api/create-payment-intent/route.ts` - Replaced by create-checkout-token
- `/app/api/process-payment/route.ts` - Not needed for hosted checkout
- `/app/api/cancel-subscription/route.ts` - Removed (cancellation handled on hosted page)
- `/app/api/list-plans/route.ts` - Removed (plan listing handled on hosted checkout page)

### API Routes to Keep
- `/app/api/check-subscription/route.ts` - Still needed for subscription status
- `/app/api/sync-customer/route.ts` - Keep for ensuring customer exists before redirecting

## Files to Create

### New API Routes

#### `/app/api/create-checkout-token/route.ts`
**Purpose**: Generate a secure token for accessing hosted checkout page

**Expected Backend Endpoint**: `POST /api/create-checkout-token`

**Request Body**:
```typescript
{
  agentRef: string;      // Required
  customerRef: string;   // Required (from userId)
  planRef?: string;      // Optional - if user selected a specific plan
}
```

**Response**:
```typescript
{
  token: string;  // Token to append to checkout URL
}
```

**Implementation Notes**:
- Extract `userId` from middleware (like existing routes)
- Use `solvaPay.ensureCustomer()` to ensure customer exists (or use sync-customer route first)
- Call backend endpoint to create checkout token
- Return token to client
- Add comment explaining this replaces create-payment-intent for hosted checkout

#### `/app/api/create-manage-customer-token/route.ts`
**Purpose**: Generate a secure token for accessing hosted customer management page

**Expected Backend Endpoint**: `POST /api/create-manage-customer-token`

**Request Body**:
```typescript
{
  customerRef: string;   // Required (from userId)
}
```

**Response**:
```typescript
{
  token: string;  // Token to append to customer management URL
}
```

**Implementation Notes**:
- Extract `userId` from middleware
- Ensure customer exists (or use sync-customer route first)
- Call backend endpoint to create manage token
- Return token to client
- Add comment explaining this enables Stripe-like customer portal functionality

## Files to Modify

### `/app/page.tsx`

**Changes Needed**:
1. Remove all `<Link href="/checkout">` references
2. Replace checkout navigation with hosted checkout redirects:
   - Add function to handle "View Plans" click:
     ```typescript
     const handleViewPlans = async () => {
       // Call /api/create-checkout-token
       // Redirect to app.solvapay.com/checkout?token=<token>
     }
     ```
   - Add function to handle "Manage Subscription" click:
     ```typescript
     const handleManageSubscription = async () => {
       // Call /api/create-manage-customer-token
       // Redirect to app.solvapay.com/customer?token=<token>
     }
     ```
3. Replace all checkout Links with buttons that call these functions
4. Handle loading states during token generation
5. Handle errors gracefully (show error message if token generation fails)

**Key Sections to Update**:
- Line 188: "Manage Subscription" button
- Line 219: "Resubscribe" button  
- Line 229: "View Plans" button

### `/app/layout.tsx`

**Changes Needed**:
1. Remove `handleCreatePayment` callback (lines 63-86)
2. Remove `handleProcessPayment` callback (lines 113-142)
3. Remove `createPayment` and `processPayment` props from `SolvaPayProvider`
4. Keep subscription-related functionality
5. Update title/meta description if needed

### `/app/components/Navigation.tsx`

**Changes Needed**:
1. Remove or update checkout link (line 107)
2. Replace with hosted checkout redirect or remove entirely

### `/app/lib/customer.ts`

**No Changes Needed** - Keep as is for customer reference management

### Middleware (`/middleware.ts`)

**Changes Needed**:
1. Add new routes to public routes if needed:
   - `/api/create-checkout-token` - Should require auth (protected)
   - `/api/create-manage-customer-token` - Should require auth (protected)
2. Both routes should require authentication (not public)

### `package.json`

**Changes Needed**:
1. Update name from "checkout-demo" to "hosted-checkout-demo" (if not already done)
2. Update description if needed

### `README.md`

**Changes Needed**:
1. Update title and description
2. Remove references to embedded checkout flow
3. Add documentation for hosted checkout flow
4. Update setup instructions if needed
5. Document new environment variables (if any)
6. Document the hosted checkout URLs and token flow

### Environment Variables (`env.example`)

**Review Needed**:
- Ensure all required variables are documented
- Add any new variables needed for hosted checkout (if different from embedded checkout)

## Implementation Steps

### Phase 1: Create New API Routes
1. Create `/app/api/create-checkout-token/route.ts`
   - Implement token generation logic
   - Add error handling
   - Add comments explaining hosted checkout flow

2. Create `/app/api/create-manage-customer-token/route.ts`
   - Implement token generation logic
   - Add error handling
   - Add comments explaining customer portal flow

### Phase 2: Update Home Page
1. Add token generation functions
2. Replace checkout links with redirect buttons
3. Add loading states
4. Add error handling

### Phase 3: Clean Up Layout
1. Remove payment intent callbacks
2. Update SolvaPayProvider configuration
3. Test subscription hooks still work

### Phase 4: Remove Checkout Code
1. Delete `/app/checkout/` directory
2. Delete `/app/api/create-payment-intent/route.ts`
3. Delete `/app/api/process-payment/route.ts`
4. Remove unused imports from other files

### Phase 5: Update Navigation
1. Remove checkout links
2. Update navigation to reflect hosted flow

### Phase 6: Documentation & Testing
1. Update README.md
2. Test token generation flows
3. Test redirects to hosted pages
4. Verify subscription status still works
5. Test error scenarios

## Hosted Page URLs

### Checkout Page
- **URL Pattern**: `https://app.solvapay.com/checkout?token=<checkout-token>`
- **Usage**: When user wants to subscribe or change plans
- **Token Source**: `/api/create-checkout-token` endpoint

### Customer Management Page
- **URL Pattern**: `https://app.solvapay.com/customer?token=<manage-token>`
- **Usage**: When user wants to manage existing subscription
- **Token Source**: `/api/create-manage-customer-token` endpoint
- **Similar to**: Stripe Customer Portal

## Token Flow (Similar to Stripe)

### Checkout Token Flow
1. User clicks "View Plans" or "Resubscribe"
2. Frontend calls `POST /api/create-checkout-token` with:
   - `agentRef` (from env)
   - `customerRef` (from authenticated user)
   - `planRef` (optional, if user selected a plan)
3. Backend creates token using SolvaPay SDK
4. Frontend receives token
5. Frontend redirects to `app.solvapay.com/checkout?token=<token>`
6. User completes checkout on hosted page
7. Hosted page redirects back to app (success URL configured on backend)

### Manage Customer Token Flow
1. User clicks "Manage Subscription"
2. Frontend calls `POST /api/create-manage-customer-token` with:
   - `customerRef` (from authenticated user)
3. Backend creates token using SolvaPay SDK
4. Frontend receives token
5. Frontend redirects to `app.solvapay.com/customer?token=<token>`
6. User manages subscription on hosted page
7. Hosted page redirects back to app when done

## Success/Return URLs

**Note**: The return URLs (where users land after completing checkout/managing subscription) should be configured on the backend when creating tokens. The frontend should handle these return scenarios:

1. Check for success query parameters in URL
2. Refetch subscription status
3. Show success message if applicable
4. Handle errors gracefully

## Questions to Resolve

1. **Return URLs**: How should users return to the app after hosted checkout?
   - Query parameters? (`?checkout=success` or `?error=...`)
   - Should we add a success page component?

2. **Plan Selection**: Should users be able to select a plan before redirecting, or should the hosted page show all plans?
   - If selecting before redirect: Keep plan selection UI on home page
   - If selecting on hosted page: Remove plan selection UI entirely

3. **Cancellation**: Should cancellation be handled on the hosted page only, or can users cancel from the app?
   - ✅ **Resolved**: Cancellation is handled on the hosted page only - `/api/cancel-subscription` route has been removed

4. **Plan Display**: Should the home page still show available plans?
   - ✅ **Resolved**: Plans are displayed on the hosted checkout page only - `/api/list-plans` route has been removed

5. **Error Handling**: How should errors be displayed?
   - Toast notifications?
   - Inline error messages?
   - Error page redirect?

6. **Loading States**: Should we show loading indicators during token generation?
   - Yes: Add loading state to buttons
   - No: Instant redirect (if tokens are pre-generated)

## Backend Endpoint Expectations

### Create Checkout Token
```typescript
// Expected backend endpoint: POST /api/create-checkout-token
// Called from: /app/api/create-checkout-token/route.ts

Request:
{
  agentRef: string;
  customerRef: string;
  planRef?: string;
}

Response:
{
  token: string;
}
```

### Create Manage Customer Token
```typescript
// Expected backend endpoint: POST /api/create-manage-customer-token
// Called from: /app/api/create-manage-customer-token/route.ts

Request:
{
  customerRef: string;
}

Response:
{
  token: string;
}
```

## Testing Checklist

- [ ] Token generation works for checkout
- [ ] Token generation works for customer management
- [ ] Redirects to correct hosted URLs
- [ ] Subscription status still displays correctly
- [ ] Error handling works for failed token generation
- [ ] Loading states work during token generation
- [ ] Return from hosted page works correctly
- [ ] Authentication still works
- [ ] Customer sync still works
- [ ] All checkout-related code removed
- [ ] No broken imports or references

## Notes

- Customer reference (`customerRef`) comes from `userId` extracted from Supabase JWT token
- Agent reference (`agentRef`) comes from `NEXT_PUBLIC_AGENT_REF` environment variable
- The hosted checkout flow is similar to Stripe Checkout hosted pages
- The customer management flow is similar to Stripe Customer Portal
- Tokens should be single-use or time-limited (handled by backend)

