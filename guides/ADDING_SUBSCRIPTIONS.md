# Adding Subscription Functionality to Next.js with Supabase

## Overview

This guide provides step-by-step instructions for adding subscription functionality to a Next.js React application using Supabase for authentication and SolvaPay for payment processing. The implementation follows a hosted checkout pattern where users are redirected to SolvaPay's hosted checkout page.

## Prerequisites

### Required Accounts

1. **SolvaPay Account**
   - Sign up at https://solvapay.com
   - Get your secret API key from the dashboard
   - Create at least one agent and plan in your dashboard

2. **Supabase Account**
   - Sign up at https://supabase.com
   - Create a new project
   - Get your project URL and anon key from Settings → API
   - Get your JWT secret from Settings → API → JWT Secret

### Required Packages

Install the following packages:

```bash
npm install @solvapay/auth@preview @solvapay/server@preview @solvapay/next@preview @solvapay/react@preview @supabase/supabase-js next react react-dom
```

**Note:** The SolvaPay packages use the `@preview` tag to ensure you get the latest preview versions. Without this tag, npm will install the `latest` tag which may point to older versions.

## Implementation Steps

### Step 1: Environment Variables Setup

Create a `.env.local` file in your project root with the following variables:

```env
# SolvaPay Configuration
SOLVAPAY_SECRET_KEY=sp_sandbox_your_secret_key_here
SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com
NEXT_PUBLIC_AGENT_REF=agt_your_agent_ref

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_JWT_SECRET=your_supabase_jwt_secret_here
```

**Action Items:**
- Copy `.env.local` from `env.example` (if exists)
- Fill in all required values from your SolvaPay and Supabase dashboards

### Step 2: Create Supabase Client Utility

Create `app/lib/supabase.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables not configured.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function getUserId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id || null;
}

export async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

export async function getUserEmail(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.email || null;
}

export async function signUp(email: string, password: string) {
  return await supabase.auth.signUp({ email, password });
}

export async function signIn(email: string, password: string) {
  return await supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return await supabase.auth.signOut();
}

export function onAuthStateChange(callback: (event: string, session: any) => void) {
  return supabase.auth.onAuthStateChange(callback);
}
```

**Action Items:**
- Create the `app/lib` directory if it doesn't exist
- Create `supabase.ts` with the above code

### Step 3: Create Customer Management Utility

Create `app/lib/customer.ts`:

```typescript
import { getUserId } from './supabase';

export async function getOrCreateCustomerId(): Promise<string> {
  const userId = await getUserId();
  return userId || '';
}

export function updateCustomerId(_newCustomerId: string): void {
  // No-op: customer ID is managed by Supabase auth
}

export async function clearCustomerId(): Promise<void> {
  const { supabase } = await import('./supabase');
  await supabase.auth.signOut();
}
```

**Action Items:**
- Create `customer.ts` in `app/lib/`

### Step 4: Setup Authentication Middleware

Create `middleware.ts` in the project root:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';

let auth: SupabaseAuthAdapter | null = null;

function getAuthAdapter(): SupabaseAuthAdapter {
  if (!auth) {
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('SUPABASE_JWT_SECRET environment variable is required.');
    }
    auth = new SupabaseAuthAdapter({ jwtSecret });
  }
  return auth;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  const publicRoutes: string[] = [];
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

  let authAdapter: SupabaseAuthAdapter;
  try {
    authAdapter = getAuthAdapter();
  } catch (error) {
    return NextResponse.json(
      { error: 'Server configuration error', details: error instanceof Error ? error.message : 'Authentication not configured' },
      { status: 500 }
    );
  }

  const userId = await authAdapter.getUserIdFromRequest(request);

  if (isPublicRoute) {
    const requestHeaders = new Headers(request.headers);
    if (userId) {
      requestHeaders.set('x-user-id', userId);
    }
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized', details: 'Valid authentication required' },
      { status: 401 }
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', userId);
  
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/api/:path*'],
};
```

**Action Items:**
- Create `middleware.ts` in the project root
- Ensure `SUPABASE_JWT_SECRET` is set in `.env.local`

### Step 5: Create Check Subscription API Route

Create `app/api/check-subscription/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { checkSubscription } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await checkSubscription(request);
  
  if (result instanceof NextResponse) {
    return result;
  }
  
  return NextResponse.json(result);
}
```

**Action Items:**
- Create `app/api/check-subscription/` directory
- Create `route.ts` with the above code

### Step 6: Create Checkout Session API Route

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
      checkoutSessionId: session.checkoutSessionId,
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

**Action Items:**
- Create `app/api/create-checkout-session/` directory
- Create `route.ts` with the above code

### Step 7: Create Sync Customer API Route (Optional)

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

    return NextResponse.json({ customerRef, success: true });
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

**Action Items:**
- Create `app/api/sync-customer/` directory
- Create `route.ts` with the above code

### Step 8: Setup Root Layout with SolvaPayProvider

Update `app/layout.tsx`:

```typescript
'use client';

import { SolvaPayProvider } from '@solvapay/react';
import { useState, useEffect, useCallback } from 'react';
import { getOrCreateCustomerId, updateCustomerId } from './lib/customer';
import { getAccessToken, onAuthStateChange } from './lib/supabase';
import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [customerId, setCustomerId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const userId = await getOrCreateCustomerId();
        setCustomerId(userId);
      } catch (error) {
        console.error('Failed to initialize auth:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, []);

  useEffect(() => {
    const authStateChange = onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        const userId = session?.user?.id || '';
        setCustomerId(prev => prev !== userId ? userId : prev);
      } else if (event === 'SIGNED_OUT') {
        setCustomerId('');
      }
    });

    return () => {
      if (authStateChange?.data?.subscription) {
        authStateChange.data.subscription.unsubscribe();
      }
    };
  }, []);

  const handleCustomerRefUpdate = useCallback((newCustomerRef: string) => {
    setCustomerId(newCustomerRef);
    updateCustomerId(newCustomerRef);
  }, []);

  const handleCreatePayment = useCallback(async ({ planRef, customerRef }: { planRef: string; customerRef: string }) => {
    throw new Error('Hosted checkout: Use redirect to app.solvapay.com/checkout instead of createPayment');
  }, []);

  const handleCheckSubscription = useCallback(async (customerRef: string) => {
    const accessToken = await getAccessToken();
    
    const headers: HeadersInit = {};
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const res = await fetch('/api/check-subscription', { headers });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMessage = errorData.error || 'Failed to check subscription';
      throw new Error(errorMessage);
    }
    
    return res.json();
  }, []);

  return (
    <html lang="en">
      <body>
        {isLoading ? (
          <div>Initializing...</div>
        ) : customerId ? (
          <SolvaPayProvider
            customerRef={customerId}
            onCustomerRefUpdate={handleCustomerRefUpdate}
            createPayment={handleCreatePayment}
            checkSubscription={handleCheckSubscription}
          >
            {children}
          </SolvaPayProvider>
        ) : (
          <div>Please sign in</div>
        )}
      </body>
    </html>
  );
}
```

**Action Items:**
- Update `app/layout.tsx` with the provider setup
- Ensure all imports are correct

### Step 9: Create Authentication Component

Create `app/components/Auth.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { signUp, signIn, getAccessToken } from '../lib/supabase';

export function Auth() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      if (isSignUp) {
        const { data, error: signUpError } = await signUp(email, password);
        if (signUpError) throw signUpError;
        
        if (data.session) {
          const accessToken = await getAccessToken();
          if (accessToken) {
            await fetch('/api/sync-customer', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${accessToken}` },
            }).catch(() => {});
          }
        }
      } else {
        const { error: signInError } = await signIn(email, password);
        if (signInError) throw signInError;
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen">
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <div className="text-red-600">{error}</div>}
        <button type="submit" disabled={isLoading}>
          {isSignUp ? 'Sign Up' : 'Sign In'}
        </button>
        <button type="button" onClick={() => setIsSignUp(!isSignUp)}>
          {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
        </button>
      </form>
    </div>
  );
}
```

**Action Items:**
- Create `app/components/` directory if needed
- Create `Auth.tsx` with authentication UI

### Step 10: Create Home Page with Subscription Check

Update `app/page.tsx`:

```typescript
'use client';

import { useSubscription, useSubscriptionStatus } from '@solvapay/react';
import { getAccessToken } from './lib/supabase';
import { useState, useCallback } from 'react';

export default function HomePage() {
  const agentRef = process.env.NEXT_PUBLIC_AGENT_REF;
  const [isRedirecting, setIsRedirecting] = useState(false);
  const { subscriptions, loading, hasActiveSubscription, refetch } = useSubscription();
  const { hasPaidSubscription, activePaidSubscription } = useSubscriptionStatus([]);

  const handleViewPlans = useCallback(async () => {
    if (!agentRef) return;

    setIsRedirecting(true);
    try {
      const accessToken = await getAccessToken();
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers,
        body: JSON.stringify({ agentRef }),
      });

      if (!response.ok) {
        throw new Error('Failed to create checkout session');
      }

      const { checkoutUrl } = await response.json();
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      }
    } catch (err) {
      console.error('Failed to redirect to checkout:', err);
      setIsRedirecting(false);
    }
  }, [agentRef]);

  return (
    <div>
      <h1>Welcome</h1>
      {loading ? (
        <div>Loading subscription...</div>
      ) : hasPaidSubscription ? (
        <div>
          <p>You're on the {activePaidSubscription?.planName} plan</p>
          <div>Premium content unlocked!</div>
        </div>
      ) : (
        <div>
          <p>You don't have an active subscription</p>
          <button onClick={handleViewPlans} disabled={isRedirecting}>
            {isRedirecting ? 'Redirecting...' : 'View Plans'}
          </button>
        </div>
      )}
    </div>
  );
}
```

**Action Items:**
- Update `app/page.tsx` with subscription checking logic
- Add UI for subscription status and upgrade button

### Step 11: Update Layout to Include Auth Component

Update `app/layout.tsx` to show Auth component when not authenticated:

```typescript
// In the return statement, replace the "Please sign in" div with:
import { Auth } from './components/Auth';

// Then in the return:
{customerId ? (
  <SolvaPayProvider ...>
    {children}
  </SolvaPayProvider>
) : (
  <Auth />
)}
```

**Action Items:**
- Import Auth component in layout
- Replace placeholder div with Auth component

## Verification Steps

1. **Test Authentication:**
   - Start dev server: `npm run dev`
   - Navigate to `/`
   - Sign up with email/password
   - Verify you're redirected after signup

2. **Test Subscription Check:**
   - After signing in, check browser console for subscription API calls
   - Verify subscription status displays correctly

3. **Test Checkout Flow:**
   - Click "View Plans" button
   - Verify redirect to SolvaPay hosted checkout
   - Complete test payment (use card: 4242 4242 4242 4242)
   - Verify redirect back to app
   - Verify subscription status updates

## Common Issues and Solutions

### Issue: "Missing SUPABASE_JWT_SECRET"

**Solution:** Ensure `.env.local` has `SUPABASE_JWT_SECRET` set correctly

### Issue: "Unauthorized" errors

**Solution:**
- Verify middleware is running (`middleware.ts` exists)
- Check that Authorization header is being sent with requests
- Verify Supabase JWT secret matches your project

### Issue: Subscription not updating after checkout

**Solution:**
- Call `refetch()` after returning from checkout
- Check that `/api/check-subscription` returns correct format
- Verify customerRef matches between checkout and subscription check

### Issue: Customer not found errors

**Solution:**
- Ensure `sync-customer` API route is called after signup
- Verify `ensureCustomer` is being called with correct userId

### Issue: Installing older package versions

**Problem:** When running `npm install` without tags, npm uses the `latest` tag which may point to older preview versions (e.g., `preview.1` or `preview.7` instead of `preview.8`).

**Solution:**
- Use the `@preview` tag when installing: `npm install @solvapay/auth@preview @solvapay/server@preview @solvapay/next@preview @solvapay/react@preview`
- Or explicitly specify the version: `npm install @solvapay/auth@1.0.0-preview.8`
- To update existing installations: `npm install @solvapay/auth@preview @solvapay/server@preview @solvapay/next@preview @solvapay/react@preview`
- Check installed versions: `npm list @solvapay/auth @solvapay/server @solvapay/next @solvapay/react`
- Check latest available versions: `npm view @solvapay/auth dist-tags`

## Next Steps

- Add subscription management UI (cancel, upgrade, downgrade)
- Implement content gating with `SubscriptionGate` component
- Add plan badge to navigation
- Set up webhooks for subscription events
- Add subscription status to user profile

## Additional Resources

- SolvaPay Documentation: https://docs.solvapay.com
- Supabase Auth Documentation: https://supabase.com/docs/guides/auth
- Next.js Documentation: https://nextjs.org/docs

