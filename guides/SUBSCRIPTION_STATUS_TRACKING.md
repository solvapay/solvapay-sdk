# Subscription Status Tracking with SolvaPay SDK

## Overview

This guide explains how subscription status for customers is tracked and accessed in a Next.js application using the SolvaPay SDK. The system uses a combination of backend API routes, React hooks, and middleware to provide real-time subscription status throughout your application.

## Architecture Overview

The subscription tracking system follows this flow:

1. **Authentication** → User ID extracted from Supabase JWT token
2. **API Route** → Backend checks subscription status via SolvaPay API
3. **React Hook** → Components access subscription data with automatic caching
4. **UI Display** → Features shown/hidden based on subscription status

**Important:** The Supabase user ID is stored as `externalRef` on the SolvaPay backend. The `customerRef` returned from API calls is the SolvaPay backend customer reference (which is different from the Supabase user ID). The `customerRef` prop passed to `SolvaPayProvider` uses the Supabase user ID as a cache key, but the actual backend customer reference is returned from the `checkSubscription` API call.

## Component Breakdown

### 1. Middleware: Extracting User ID

The middleware extracts the user ID from the Supabase JWT token and adds it as a header for API routes:

```typescript
// middleware.ts
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';

export async function middleware(request: NextRequest) {
  const authAdapter = new SupabaseAuthAdapter({ 
    jwtSecret: process.env.SUPABASE_JWT_SECRET 
  });
  
  // Extract userId from Supabase JWT token
  const userId = await authAdapter.getUserIdFromRequest(request);
  
  // Add it as header for downstream API routes
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', userId);
  
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}
```

**Key Points:**
- Runs on all `/api/*` routes
- Extracts user ID from the `Authorization` header (Bearer token)
- Adds `x-user-id` header for backend routes to use

### 2. API Route: Checking Subscription Status

The API route uses the SDK's `checkSubscription` helper to fetch subscription data:

```typescript
// app/api/check-subscription/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { checkSubscription } from '@solvapay/next';

export async function GET(request: NextRequest) {
  // SDK helper automatically:
  // 1. Reads userId from x-user-id header (set by middleware)
  // 2. Gets user email/name from Supabase JWT token
  // 3. Ensures customer exists in SolvaPay (with deduplication)
  // 4. Returns customer info with subscriptions array
  const result = await checkSubscription(request);
  
  if (result instanceof NextResponse) {
    return result; // Error response
  }
  
  return NextResponse.json(result);
}
```

**What `checkSubscription` Does:**
- Extracts user ID from `x-user-id` header (Supabase user ID)
- Gets email and name from the Supabase JWT token
- Calls `solvaPay.ensureCustomer(userId, userId, ...)` where:
  - First `userId` parameter is used as a cache key (`customerRef`)
  - Second `userId` parameter is passed as `externalRef` to the SolvaPay backend
  - The Supabase user ID is stored as `externalRef` on the SolvaPay backend
- Returns the backend customer reference (different from the Supabase user ID)
- Calls `solvaPay.getCustomer()` to retrieve subscriptions using the backend customer reference
- Filters out expired cancelled subscriptions
- Handles request deduplication (prevents duplicate concurrent requests)
- Returns `SubscriptionCheckResult` with subscriptions array

**Important:** The `customerRef` returned from `checkSubscription` is the SolvaPay backend customer reference, NOT the Supabase user ID. The Supabase user ID is stored as `externalRef` on the SolvaPay backend.

**Response Format:**
```typescript
{
  customerRef: string;
  email?: string;
  name?: string;
  subscriptions: SubscriptionInfo[];
}
```

### 3. Layout: Setting Up Provider

The root layout sets up the `SolvaPayProvider` with the customer reference:

```typescript
// app/layout.tsx
'use client';

import { SolvaPayProvider } from '@solvapay/react';
import { getOrCreateCustomerId, getAccessToken } from './lib/supabase';

export default function RootLayout({ children }) {
  const [customerId, setCustomerId] = useState<string>('');
  
  // Initialize customer ID from Supabase session
  useEffect(() => {
    const initializeAuth = async () => {
      const userId = await getOrCreateCustomerId(); // Gets Supabase user ID
      setCustomerId(userId);
    };
    initializeAuth();
  }, []);
  
  // Handler for subscription checks
  const handleCheckSubscription = useCallback(async (customerRef: string) => {
    const accessToken = await getAccessToken();
    const headers: HeadersInit = {};
    
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    
    const res = await fetch('/api/check-subscription', { headers });
    if (!res.ok) {
      throw new Error('Failed to check subscription');
    }
    
    return res.json();
  }, []);
  
  return (
    <SolvaPayProvider
      customerRef={customerId}  // ← Pass user ID as customerRef
      checkSubscription={handleCheckSubscription}
    >
      {children}
    </SolvaPayProvider>
  );
}
```

**Key Points:**
- The `customerRef` prop passed to `SolvaPayProvider` uses the Supabase user ID as a cache key (not the actual SolvaPay backend customer reference)
- `checkSubscription` function wraps the API call with auth headers
- The API route internally maps the Supabase user ID (via `externalRef`) to the SolvaPay backend customer reference
- The `customerRef` returned from `checkSubscription` is the SolvaPay backend customer reference (not the Supabase user ID)
- Provider manages subscription state and caching

### 4. React Hook: Accessing Subscription Data

Components use the `useSubscription` hook to access subscription status:

```typescript
// In any component
import { useSubscription, useSubscriptionStatus } from '@solvapay/react';

export default function MyComponent() {
  // Hook automatically fetches from /api/check-subscription
  const { 
    subscriptions,           // Array of subscription objects
    loading,                // Loading state
    hasActiveSubscription,  // Boolean: has any active subscription
    refetch                 // Function to force refresh
  } = useSubscription();
  
  // Helper utilities for subscription logic
  const {
    hasPaidSubscription,      // Boolean: has active paid plan
    activePaidSubscription,   // Most recent paid subscription
    cancelledSubscription,    // Most recent cancelled subscription
    shouldShowCancelledNotice, // Should show cancellation notice
    formatDate,               // Format dates for display
    getDaysUntilExpiration    // Calculate days until expiration
  } = useSubscriptionStatus([]); // Pass array of plan definitions
  
  // ... component logic
}
```

**Hook Features:**
- Automatic fetching on mount
- Request deduplication (prevents duplicate calls)
- Caching (results cached for 2 seconds)
- Loading states
- Error handling

### 5. Subscription Status Helpers

The `useSubscriptionStatus` hook provides utilities for common subscription checks:

```typescript
const {
  // Check if user has a paid subscription
  hasPaidSubscription: boolean,
  
  // Get the most recent active paid subscription
  activePaidSubscription: SubscriptionInfo | null,
  
  // Get the most recent cancelled subscription
  cancelledSubscription: SubscriptionInfo | null,
  
  // Should show cancellation notice (cancelled but not expired)
  shouldShowCancelledNotice: boolean,
  
  // Format dates for display
  formatDate: (date: string | Date) => string,
  
  // Calculate days until expiration
  getDaysUntilExpiration: (endDate: string | Date) => number | null
} = useSubscriptionStatus(plans);
```

**Subscription States:**
- **Active**: `status === 'active'` and not cancelled
- **Cancelled**: `status === 'cancelled'` OR `cancelledAt` is set
- **Expired**: Cancelled subscription with `endDate` in the past
- **Active Cancelled**: Cancelled subscription with `endDate` in the future

### 6. Displaying Status in UI

Use subscription helpers to control UI behavior:

```typescript
// Display current plan
{hasPaidSubscription ? (
  <p>You're on the {activePaidSubscription?.planName} plan</p>
) : hasActiveSubscription ? (
  <p>You're on the {mostRecentActiveSubscription?.planName} plan</p>
) : (
  <p>You don't have an active subscription</p>
)}

// Lock features based on subscription
<FeatureCard
  title="Advanced Analytics"
  locked={!hasPaidSubscription}  // ← Gate feature access
/>

// Show cancelled subscription notice
{shouldShowCancelledNotice && cancelledSubscription && (
  <div className="alert">
    <p>Subscription expires on {formatDate(cancelledSubscription.endDate)}</p>
    <p>{getDaysUntilExpiration(cancelledSubscription.endDate)} days remaining</p>
    <p>Cancelled on {formatDate(cancelledSubscription.cancelledAt)}</p>
  </div>
)}

// Filter subscriptions manually
const mostRecentActive = useMemo(() => {
  const activeSubs = subscriptions.filter(sub => sub.status === 'active');
  return activeSubs.sort((a, b) => 
    new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
  )[0];
}, [subscriptions]);
```

### 7. Refetching Subscription Status

Force a refresh when subscription status might have changed:

```typescript
// Manual refetch
const { refetch } = useSubscription();

const handlePaymentSuccess = async () => {
  // After successful payment, refetch subscriptions
  await refetch();
};

// Auto-refetch on mount
useEffect(() => {
  refetch().catch(console.error);
}, [refetch]);
```

## Complete Example

Here's a complete example component that displays subscription status:

```typescript
'use client';

import { useMemo, useEffect } from 'react';
import { useSubscription, useSubscriptionStatus } from '@solvapay/react';

export default function SubscriptionDashboard() {
  const { subscriptions, loading, hasActiveSubscription, refetch } = useSubscription();
  const {
    hasPaidSubscription,
    activePaidSubscription,
    cancelledSubscription,
    shouldShowCancelledNotice,
    formatDate,
    getDaysUntilExpiration,
  } = useSubscriptionStatus([]);
  
  // Refetch on mount to ensure latest data
  useEffect(() => {
    refetch().catch(console.error);
  }, [refetch]);
  
  // Get most recent active subscription (includes free plans)
  const mostRecentActiveSubscription = useMemo(() => {
    const activeSubs = subscriptions.filter(sub => sub.status === 'active');
    return activeSubs.sort((a, b) => 
      new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    )[0];
  }, [subscriptions]);
  
  if (loading) {
    return <div>Loading subscription status...</div>;
  }
  
  return (
    <div>
      <h1>Subscription Status</h1>
      
      {/* Current Plan Display */}
      {hasPaidSubscription ? (
        <div>
          <p>Current Plan: {activePaidSubscription?.planName}</p>
          <p>Start Date: {formatDate(activePaidSubscription?.startDate)}</p>
        </div>
      ) : hasActiveSubscription ? (
        <div>
          <p>Current Plan: {mostRecentActiveSubscription?.planName}</p>
        </div>
      ) : shouldShowCancelledNotice && cancelledSubscription ? (
        <div className="alert">
          <p>Cancelled Plan: {cancelledSubscription.planName}</p>
          {cancelledSubscription.endDate && (
            <>
              <p>Expires: {formatDate(cancelledSubscription.endDate)}</p>
              <p>
                {getDaysUntilExpiration(cancelledSubscription.endDate)} days remaining
              </p>
            </>
          )}
        </div>
      ) : (
        <p>No active subscription</p>
      )}
      
      {/* Feature Gating */}
      <div>
        <FeatureCard
          title="Basic Feature"
          available={true}
        />
        <FeatureCard
          title="Premium Feature"
          available={hasPaidSubscription}
        />
      </div>
    </div>
  );
}
```

## Request Deduplication & Caching

The SDK automatically handles:

### Deduplication
- Prevents duplicate concurrent requests for the same user
- Multiple components calling `useSubscription` share the same request
- In-flight requests are reused

### Caching
- Results cached for 2 seconds (prevents rapid sequential requests)
- Automatic cleanup of expired cache entries
- Memory-safe with max cache size

**Note:** For multi-instance deployments, consider using Redis or a shared cache instead of the default in-memory cache.

## Subscription Filtering

The SDK automatically filters subscriptions:

- ✅ **Included**: Active subscriptions
- ✅ **Included**: Cancelled subscriptions with future `endDate`
- ❌ **Excluded**: Cancelled subscriptions without `endDate`
- ❌ **Excluded**: Cancelled subscriptions with past `endDate`

This ensures the UI only shows relevant subscription data.

## Subscription Data Structure

```typescript
interface SubscriptionInfo {
  subscriptionRef: string;
  planRef: string;
  planName: string;
  status: 'active' | 'cancelled' | 'past_due' | 'trialing';
  startDate: string;  // ISO date string
  endDate?: string;   // ISO date string (if cancelled)
  cancelledAt?: string; // ISO date string (when cancelled)
  cancellationReason?: string;
  // ... other fields
}
```

## Common Patterns

### Pattern 1: Feature Gating

```typescript
function PremiumFeature() {
  const { hasPaidSubscription } = useSubscriptionStatus([]);
  
  if (!hasPaidSubscription) {
    return <UpgradePrompt />;
  }
  
  return <PremiumContent />;
}
```

### Pattern 2: Conditional Rendering

```typescript
function Dashboard() {
  const { hasActiveSubscription } = useSubscription();
  
  return (
    <>
      {hasActiveSubscription ? (
        <SubscriptionDashboard />
      ) : (
        <PlansPage />
      )}
    </>
  );
}
```

### Pattern 3: Status Display

```typescript
function SubscriptionBanner() {
  const {
    hasPaidSubscription,
    activePaidSubscription,
    cancelledSubscription,
    shouldShowCancelledNotice,
    formatDate,
    getDaysUntilExpiration,
  } = useSubscriptionStatus([]);
  
  if (hasPaidSubscription) {
    return <SuccessBanner>Active: {activePaidSubscription.planName}</SuccessBanner>;
  }
  
  if (shouldShowCancelledNotice && cancelledSubscription) {
    return (
      <WarningBanner>
        Expires: {formatDate(cancelledSubscription.endDate)} 
        ({getDaysUntilExpiration(cancelledSubscription.endDate)} days left)
      </WarningBanner>
    );
  }
  
  return <InfoBanner>Choose a plan to get started</InfoBanner>;
}
```

## Troubleshooting

### Subscriptions Not Loading

1. **Check middleware**: Ensure `x-user-id` header is set in API routes
2. **Check auth**: Verify Supabase session is valid
3. **Check API route**: Ensure `/api/check-subscription` returns data
4. **Check console**: Look for errors in browser console and server logs

### Stale Subscription Data

- Call `refetch()` after subscription changes (checkout, cancellation, etc.)
- Check cache expiration (default 2 seconds)
- Verify customer exists in SolvaPay dashboard

### Wrong Subscription Status

- Verify `planName` matches your plan definitions
- Check subscription `status` field in SolvaPay dashboard
- Ensure `endDate` is set correctly for cancelled subscriptions

## Related Documentation

- [Complete Implementation Guide](./COMPLETE_IMPLEMENTATION_GUIDE.md)
- [Adding Subscriptions](./ADDING_SUBSCRIPTIONS.md)
- [Adding Sign In / Sign Up](./ADDING_SIGN_IN_SIGN_UP.md)


