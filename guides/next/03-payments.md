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

Create `app/api/create-checkout-session/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { requireUserId, getUserEmailFromRequest, getUserNameFromRequest } from '@solvapay/auth';

export async function POST(request: NextRequest) {
  try {
    const userIdOrError = requireUserId(request);
    if (userIdOrError instanceof Response) {
      return userIdOrError;
    }
    const userId = userIdOrError;

    const email = await getUserEmailFromRequest(request);
    const name = await getUserNameFromRequest(request);

    const { planRef, agentRef } = await request.json();

    if (!agentRef) {
      return NextResponse.json(
        { error: 'Missing required parameter: agentRef is required' },
        { status: 400 }
      );
    }

    const solvaPay = createSolvaPay();

    const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    });

    const session = await solvaPay.createCheckoutSession({
      agentRef,
      customerRef: ensuredCustomerRef,
      planRef: planRef || undefined,
    });

    return NextResponse.json({
      sessionId: session.sessionId,
      checkoutUrl: session.checkoutUrl,
    });

  } catch (error) {
    console.error('Checkout session creation failed:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Checkout session creation failed', details: errorMessage },
      { status: 500 }
    );
  }
}
```

**What this does:**
- Extracts user ID from request (set by middleware)
- Gets user email and name from Supabase token
- Creates or updates customer in SolvaPay
- Creates checkout session
- Returns checkout URL for redirect

## Step 2: Create Check Subscription API Route

Create `app/api/check-subscription/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { checkSubscription, type SubscriptionCheckResult } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await checkSubscription(request);
  
  if (result instanceof NextResponse) {
    return result;
  }
  
  const subscriptionData = result as SubscriptionCheckResult;
  
  return NextResponse.json(subscriptionData);
}
```

**What this does:**
- Uses the `checkSubscription` helper from `@solvapay/next`
- Automatically extracts user ID from request
- Checks subscription status with SolvaPay API
- Returns subscription data

## Step 3: Create Customer Session API Route

Create `app/api/create-customer-session/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { requireUserId, getUserEmailFromRequest, getUserNameFromRequest } from '@solvapay/auth';

export async function POST(request: NextRequest) {
  try {
    const userIdOrError = requireUserId(request);
    if (userIdOrError instanceof Response) {
      return userIdOrError;
    }
    const userId = userIdOrError;

    const email = await getUserEmailFromRequest(request);
    const name = await getUserNameFromRequest(request);

    const solvaPay = createSolvaPay();

    const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    });

    const session = await solvaPay.createCustomerSession({
      customerRef: ensuredCustomerRef,
    });

    return NextResponse.json(session);

  } catch (error) {
    console.error('Customer session creation failed:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Customer session creation failed', details: errorMessage },
      { status: 500 }
    );
  }
}
```

**What this does:**
- Creates a customer portal session
- Allows users to manage subscriptions, payment methods, and billing history
- Returns URL to redirect user to hosted customer portal

## Step 4: Create Sync Customer API Route

Create `app/api/sync-customer/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { requireUserId, getUserEmailFromRequest, getUserNameFromRequest } from '@solvapay/auth';

export async function POST(request: NextRequest) {
  try {
    const userIdOrError = requireUserId(request);
    if (userIdOrError instanceof Response) {
      return userIdOrError;
    }
    const userId = userIdOrError;

    const email = await getUserEmailFromRequest(request);
    const name = await getUserNameFromRequest(request);

    const solvaPay = createSolvaPay();

    const customerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    });

    return NextResponse.json({
      customerRef,
      success: true,
    });
  } catch (error) {
    console.error('Sync customer failed:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Failed to sync customer', details: errorMessage },
      { status: 500 }
    );
  }
}
```

**What this does:**
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

Update `app/page.tsx`:

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
  
  // Refetch subscriptions on mount to ensure we have latest data
  useEffect(() => {
    refetch().catch((error) => {
      console.error('[HomePage] Refetch failed:', error);
    });
  }, [refetch]);
  
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
   - User completes payment on `app.solvapay.com`
   - After payment, user is redirected back to your app

3. **Subscription status updates**
   - Provider automatically checks subscription
   - UI updates to show active subscription
   - "Manage Subscription" button appears

## Testing Payments

Use these test card numbers on the hosted checkout page:

| Card Number | Result |
|------------|--------|
| 4242 4242 4242 4242 | ✅ Payment succeeds |
| 4000 0000 0000 0002 | ❌ Payment declined |
| 4000 0000 0000 9995 | ❌ Insufficient funds |

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

### "Missing required parameter: agentRef"
- Ensure `NEXT_PUBLIC_AGENT_REF` is set in `.env.local`
- Restart dev server after adding environment variables

### "Failed to create checkout session"
- Check your `SOLVAPAY_SECRET_KEY` is correct
- Verify agent reference exists in SolvaPay dashboard
- Check network tab for API errors

### Subscription not updating after checkout
- Ensure `refetch()` is called after returning from checkout
- Check that `/api/check-subscription` returns correct format
- Verify customerRef matches between checkout and subscription check

### "Unauthorized" errors
- Verify middleware is properly extracting user ID
- Check that Authorization header is being sent
- Ensure user is authenticated before calling checkout

## Next Steps

Now that payments are set up, proceed to:
- **[Step 4: Styling](./04-styling.md)** - Create UI components and styling system

