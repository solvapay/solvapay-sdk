# Step 3: Payments Setup

This guide covers setting up SolvaPay hosted checkout for subscription payments.

## Overview

We'll implement:

1. API route to create checkout sessions
2. API route to check subscription status
3. API route to create customer sessions (for subscription management)
4. API route to sync customers
5. Frontend integration for checkout flow

## Step 1: Create Checkout Session API Route

Create `src/app/api/create-checkout-session/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createCheckoutSession } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { planRef, agentRef } = await request.json()

  const result = await createCheckoutSession(request, { agentRef, planRef })
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
```

**What this does:**

- Uses the `createCheckoutSession` helper from `@solvapay/next`
- Automatically extracts user ID from request (set by middleware)
- Gets user email and name from Supabase token
- Creates or updates customer in SolvaPay
- Creates checkout session
- Returns checkout URL for redirect

## Step 2: Create Check Subscription API Route

Create `src/app/api/check-subscription/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { checkSubscription } from '@solvapay/next'

export async function GET(request: NextRequest) {
  const result = await checkSubscription(request)
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
```

**What this does:**

- Uses the `checkSubscription` helper from `@solvapay/next`
- Automatically extracts user ID from request (set by middleware)
- Gets user email and name from Supabase token
- Ensures customer exists in SolvaPay
- Checks subscription status with SolvaPay API
- Returns subscription data

## Step 3: Create Customer Session API Route

Create `src/app/api/create-customer-session/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createCustomerSession } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const result = await createCustomerSession(request)
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
```

**What this does:**

- Uses the `createCustomerSession` helper from `@solvapay/next`
- Automatically extracts user ID from request (set by middleware)
- Gets user email and name from Supabase token
- Ensures customer exists in SolvaPay
- Creates a customer portal session
- Allows users to manage subscriptions, payment methods, and billing history
- Returns URL to redirect user to hosted customer portal

## Step 4: Create Sync Customer API Route

Create `src/app/api/sync-customer/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { syncCustomer } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const customerRef = await syncCustomer(request)

  if (customerRef instanceof NextResponse) {
    return customerRef
  }

  return NextResponse.json({
    customerRef,
    success: true,
  })
}
```

**What this does:**

- Uses the `syncCustomer` helper from `@solvapay/next`
- Automatically extracts user ID from request (set by middleware)
- Gets user email and name from Supabase token
- Ensures customer exists in SolvaPay
- Called after sign-up to create customer immediately
- Syncs user email and name to SolvaPay customer record

## Step 5: Update Root Layout

The layout is already set up correctly from Step 2. The `SolvaPayProvider` with the Supabase adapter automatically handles subscription checking - no additional configuration needed!

**Important:** The Supabase adapter automatically:

- Gets the access token from Supabase session using `supabase.auth.getSession()`
- Calls `/api/check-subscription` with the Authorization header
- Updates subscription state in the provider
- You can use `useSubscription()` hook anywhere in your app to access subscription data

**You don't need to pass a `checkSubscription` prop** - it's handled automatically by the adapter. The adapter uses the token from Supabase to authenticate with your API routes.

## Step 6: Create Home Page with Checkout Flow

Update `src/app/page.tsx`:

```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSubscription, useSubscriptionStatus } from '@solvapay/react';
import { getAccessToken } from './lib/supabase';

export default function HomePage() {
  const agentRef = process.env.NEXT_PUBLIC_AGENT_REF;
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get subscription helpers from SDK
  const { subscriptions, loading: subscriptionsLoading, refetch, hasPaidSubscription, activeSubscription } = useSubscription();

  // Refetch subscriptions on mount to ensure we have latest data after navigation
  // This is especially important when creating a new account or after account changes
  // Empty dependency array ensures this only runs once on mount, preventing stale data
  useEffect(() => {
    // Immediately refetch on mount to bypass any cached data
    refetch().catch((error) => {
      console.error('[HomePage] Refetch failed:', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run on mount to ensure fresh data on page load

  // Get advanced subscription status helpers
  const {
    cancelledSubscription,
    shouldShowCancelledNotice,
    formatDate,
    getDaysUntilExpiration,
  } = useSubscriptionStatus();

  // Handle redirect to hosted checkout page
  const handleViewPlans = useCallback(async (planRef?: string) => {
    if (!agentRef) {
      setError('Agent reference is not configured');
      return;
    }

    setIsRedirecting(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const requestBody: { agentRef: string; planRef?: string } = {
        agentRef,
      };

      if (planRef) {
        requestBody.planRef = planRef;
      }

      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.details || 'Failed to create checkout session';
        throw new Error(errorMessage);
      }

      const { checkoutUrl } = await response.json();

      if (!checkoutUrl) {
        throw new Error('No checkout URL returned');
      }

      // Redirect to hosted checkout page
      window.location.href = checkoutUrl;
    } catch (err) {
      console.error('Failed to redirect to checkout:', err);
      setError(err instanceof Error ? err.message : 'Failed to redirect to checkout');
      setIsRedirecting(false);
    }
  }, [agentRef]);

  // Handle redirect to hosted customer management page
  const handleManageSubscription = useCallback(async () => {
    setIsRedirecting(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch('/api/create-customer-session', {
        method: 'POST',
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.details || 'Failed to create customer session';
        throw new Error(errorMessage);
      }

      const { customerUrl } = await response.json();

      if (!customerUrl) {
        throw new Error('No customer URL returned');
      }

      // Redirect to hosted customer management page
      window.location.href = customerUrl;
    } catch (err) {
      console.error('Failed to redirect to customer management:', err);
      setError(err instanceof Error ? err.message : 'Failed to redirect to customer management');
      setIsRedirecting(false);
    }
  }, []);

  const isLoading = subscriptionsLoading;

  return (
    <div className="min-h-screen bg-white">
      <main className="max-w-4xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-semibold text-slate-900 mb-3">
            Welcome to Your Dashboard
          </h1>
          {isLoading ? (
            <p className="text-slate-600">Loading subscription...</p>
          ) : activeSubscription ? (
            <p className="text-slate-600">
              You're on the <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                {activeSubscription.planName}
              </span> plan
            </p>
          ) : (
            <p className="text-slate-600">You don't have an active subscription</p>
          )}
        </div>

        {/* CTA Section */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          {isLoading ? (
            <div className="text-center py-4">
              <p className="text-slate-600">Loading...</p>
            </div>
          ) : hasPaidSubscription ? (
            <div className="text-center py-4">
              <p className="text-slate-900 mb-4">Manage your subscription and billing</p>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
              <button
                onClick={handleManageSubscription}
                disabled={isRedirecting}
                className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRedirecting ? 'Redirecting...' : 'Manage Subscription'}
              </button>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-slate-900 mb-2 font-medium">Upgrade your plan</p>
              <p className="text-slate-600 text-sm mb-6">Get access to advanced features and more</p>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
              <button
                onClick={() => handleViewPlans()}
                disabled={isRedirecting}
                className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRedirecting ? 'Redirecting...' : 'Upgrade'}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
```

**What this does:**

- Displays subscription status
- Shows "Upgrade" button if no subscription
- Shows "Manage Subscription" button if subscribed
- Handles redirects to hosted checkout and customer portal

## How Hosted Checkout Works

1. **User clicks "Upgrade"**
   - Frontend calls `/api/create-checkout-session`
   - Server creates SolvaPay checkout session
   - Returns `checkoutUrl`

2. **User is redirected**
   - `window.location.href = checkoutUrl`
   - User completes payment on `solvapay.com`
   - After payment, user is redirected back to your app

3. **Subscription status updates**
   - Provider automatically checks subscription
   - UI updates to show active subscription
   - "Manage Subscription" button appears

## Testing Payments

Use these test card numbers on the hosted checkout page:

| Card Number         | Result             |
| ------------------- | ------------------ |
| 4242 4242 4242 4242 | Payment succeeds   |
| 4000 0000 0000 0002 | Payment declined   |
| 4000 0000 0000 9995 | Insufficient funds |

- Use any future expiry date
- Use any 3-digit CVC
- Use any billing ZIP code

## Verification

Test your payment setup:

1. **Start dev server:**

   ```bash
   npm run dev
   ```

2. **Test checkout flow:**
   - Sign in to your app
   - Click "Upgrade" button
   - You should be redirected to hosted checkout
   - Complete test payment (use card: 4242 4242 4242 4242)
   - You should be redirected back to app
   - Subscription status should update

3. **Test subscription management:**
   - With an active subscription, click "Manage Subscription"
   - You should be redirected to customer portal
   - Can manage subscription, payment methods, billing history

## Troubleshooting

### Subscription not updating after checkout

- Ensure `refetch()` is called after returning from checkout
- Check that `/api/check-subscription` returns correct format
- Verify customerRef matches between checkout and subscription check

### "Unauthorized" errors

- Verify middleware is properly extracting user ID
- Check that Authorization header is being sent
- Ensure user is authenticated before calling checkout

## Understanding Subscription Status Tracking

### How It Works

The subscription tracking system follows this flow:

1. **Authentication** → User ID extracted from Supabase JWT token via middleware
2. **API Route** → Backend checks subscription status via SolvaPay API using `checkSubscription` helper
3. **React Hook** → Components access subscription data with automatic caching via `useSubscription()`
4. **UI Display** → Features shown/hidden based on subscription status

### Key Concepts

- **User ID Mapping**: The Supabase user ID is stored as `externalRef` on the SolvaPay backend
- **Customer Reference**: The `customerRef` returned from API calls is the SolvaPay backend customer reference (different from the Supabase user ID)
- **Automatic Subscription Checking**: The Supabase adapter automatically calls `/api/check-subscription` with the token - no manual setup needed
- **Request Deduplication**: The SDK automatically prevents duplicate concurrent requests for the same user
- **Caching**: Results are cached for 2 seconds to prevent rapid sequential requests

### Subscription States

- **Active**: `status === 'active'` and not cancelled
- **Cancelled**: `status === 'cancelled'` OR `cancelledAt` is set
- **Expired**: Cancelled subscription with `endDate` in the past
- **Active Cancelled**: Cancelled subscription with `endDate` in the future

### Using Subscription Hooks

```typescript
import { useSubscription, useSubscriptionStatus } from '@solvapay/react'

function MyComponent() {
  // Basic subscription data
  const {
    subscriptions, // Array of subscription objects
    loading, // Loading state
    hasActiveSubscription, // Boolean: has any active subscription
    refetch, // Function to force refresh
  } = useSubscription()

  // Helper utilities for subscription logic
  const {
    hasPaidSubscription, // Boolean: has active paid plan
    activePaidSubscription, // Most recent paid subscription
    cancelledSubscription, // Most recent cancelled subscription
    shouldShowCancelledNotice, // Should show cancellation notice
    formatDate, // Format dates for display
    getDaysUntilExpiration, // Calculate days until expiration
  } = useSubscriptionStatus([]) // Pass array of plan definitions

  // Use these values to control UI
}
```

### Subscription Filtering

The SDK automatically filters subscriptions:

- **Included**: Active subscriptions
- **Included**: Cancelled subscriptions with future `endDate`
- **Excluded**: Cancelled subscriptions without `endDate`
- **Excluded**: Cancelled subscriptions with past `endDate`

### Refetching Subscription Status

Force a refresh when subscription status might have changed:

```typescript
const { refetch } = useSubscription()

// After successful payment
const handlePaymentSuccess = async () => {
  await refetch()
}

// Auto-refetch on mount to ensure fresh data
useEffect(() => {
  refetch().catch(console.error)
}, [refetch])
```

### Common Patterns

**Feature Gating:**

```typescript
const { hasPaidSubscription } = useSubscriptionStatus([]);
if (!hasPaidSubscription) {
  return <UpgradePrompt />;
}
return <PremiumContent />;
```

**Status Display:**

```typescript
const { activePaidSubscription, cancelledSubscription, shouldShowCancelledNotice } = useSubscriptionStatus([]);

if (activePaidSubscription) {
  return <SuccessBanner>Active: {activePaidSubscription.planName}</SuccessBanner>;
}

if (shouldShowCancelledNotice && cancelledSubscription) {
  return <WarningBanner>Expires: {formatDate(cancelledSubscription.endDate)}</WarningBanner>;
}
```

For more details on subscription status tracking, see the complete example in [Step 5: Complete Example](./05-complete-example.md).

## Next Steps

Now that payments are set up, proceed to:

- **[Step 4: Styling](./04-styling.md)** - Create UI components and styling system
