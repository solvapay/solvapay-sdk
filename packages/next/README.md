# @solvapay/next

Next.js-specific utilities and helpers for SolvaPay SDK.

This package provides framework-specific helpers for Next.js API routes with built-in optimizations like request deduplication and caching.

## Installation

```bash
npm install @solvapay/next @solvapay/server next
```

## Usage

All helpers return either a success result or a `NextResponse` error, making them easy to use in Next.js API routes.

### Check Subscription

Check user subscription status with built-in request deduplication and caching:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { checkSubscription } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await checkSubscription(request);
  
  // If result is a NextResponse, it's an error response - return it
  if (result instanceof NextResponse) {
    return result;
  }
  
  // Otherwise, return the subscription data
  return NextResponse.json(result);
}
```

**Features:**
- **Automatic Deduplication**: Prevents duplicate API calls by deduplicating concurrent requests
- **Caching**: Caches results for 2 seconds to prevent duplicate sequential requests
- **Automatic Cleanup**: Expired cache entries are automatically cleaned up
- **Memory Safe**: Maximum cache size limits prevent memory issues

### Sync Customer

Sync customer with SolvaPay backend (ensures customer exists and returns customer reference):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { syncCustomer } from '@solvapay/next';

export async function POST(request: NextRequest) {
  const result = await syncCustomer(request);
  
  if (result instanceof NextResponse) {
    return result;
  }
  
  return NextResponse.json({ customerRef: result });
}
```

### Create Payment Intent

Create a Stripe payment intent for checkout:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createPaymentIntent } from '@solvapay/next';

export async function POST(request: NextRequest) {
  const { planRef, agentRef } = await request.json();
  
  if (!planRef || !agentRef) {
    return NextResponse.json(
      { error: 'Missing required parameters' },
      { status: 400 }
    );
  }
  
  const result = await createPaymentIntent(request, { planRef, agentRef });
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

### Process Payment

Process payment after Stripe confirmation:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { processPayment } from '@solvapay/next';

export async function POST(request: NextRequest) {
  const { paymentIntentId, agentRef, planRef } = await request.json();
  
  if (!paymentIntentId || !agentRef) {
    return NextResponse.json(
      { error: 'Missing required parameters' },
      { status: 400 }
    );
  }
  
  const result = await processPayment(request, { paymentIntentId, agentRef, planRef });
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

### List Plans

List available plans (public route, no authentication required):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { listPlans } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await listPlans(request);
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

### Cancel Subscription

Cancel a user's subscription:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cancelSubscription } from '@solvapay/next';

export async function POST(request: NextRequest) {
  const { subscriptionRef, reason } = await request.json();
  
  if (!subscriptionRef) {
    return NextResponse.json(
      { error: 'Missing subscriptionRef' },
      { status: 400 }
    );
  }
  
  const result = await cancelSubscription(request, { subscriptionRef, reason });
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

### Create Checkout Session

Create a hosted checkout session:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession } from '@solvapay/next';

export async function POST(request: NextRequest) {
  const { agentRef, planRef } = await request.json();
  
  if (!agentRef) {
    return NextResponse.json(
      { error: 'Missing agentRef' },
      { status: 400 }
    );
  }
  
  const result = await createCheckoutSession(request, { agentRef, planRef });
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

### Create Customer Session

Create a customer portal session:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createCustomerSession } from '@solvapay/next';

export async function POST(request: NextRequest) {
  const result = await createCustomerSession(request);
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

### Get Authenticated User

Get authenticated user information (userId, email, name):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await getAuthenticatedUser(request, {
    includeEmail: true,
    includeName: true,
  });
  
  if (result instanceof NextResponse) {
    return result;
  }
  
  return NextResponse.json(result);
}
```

### Cache Management

```typescript
import { 
  clearSubscriptionCache, 
  clearAllSubscriptionCache,
  getSubscriptionCacheStats 
} from '@solvapay/next';

// Clear cache for a specific user
clearSubscriptionCache(userId);

// Clear all cache entries
clearAllSubscriptionCache();

// Get cache statistics
const stats = getSubscriptionCacheStats();
console.log(`In-flight: ${stats.inFlight}, Cached: ${stats.cached}`);
```

## Helper Functions Reference

All helper functions follow the same pattern:
- Take a `Request` or `NextRequest` as the first parameter
- Return either the success result or a `NextResponse` error
- Automatically extract user information from request headers (set by middleware)
- Support optional configuration options

**Available Helpers:**
- `checkSubscription(request, options?)` - Check subscription with caching
- `syncCustomer(request, options?)` - Sync customer with backend
- `createPaymentIntent(request, body, options?)` - Create payment intent
- `processPayment(request, body, options?)` - Process payment
- `listPlans(request)` - List available plans (public)
- `cancelSubscription(request, body, options?)` - Cancel subscription
- `createCheckoutSession(request, body, options?)` - Create hosted checkout
- `createCustomerSession(request, options?)` - Create customer portal
- `getAuthenticatedUser(request, options?)` - Get user info

**Common Options:**
- `solvaPay?: SolvaPay` - Custom SolvaPay instance
- `includeEmail?: boolean` - Include user email (default: true)
- `includeName?: boolean` - Include user name (default: true)

## Requirements

- Next.js >= 13.0.0
- Node.js >= 18.17

## Why a Separate Package?

This package is separate from `@solvapay/server` to keep the server package framework-agnostic. Users who use Express, Fastify, or other frameworks don't need Next.js as a dependency.

## Middleware Setup

These helpers expect the user ID to be set in the `x-user-id` header by your Next.js middleware/proxy.

### Quick Setup with Supabase

The easiest way is to use `createSupabaseAuthMiddleware`:

**For Next.js 15:**
```typescript
// middleware.ts (at project root)
import { createSupabaseAuthMiddleware } from '@solvapay/next';

export const middleware = createSupabaseAuthMiddleware({
  publicRoutes: ['/api/list-plans'],
});

export const config = {
  matcher: ['/api/:path*'],
};
```

**For Next.js 16 with `src/` folder:**
```typescript
// src/proxy.ts (in src/ folder, not project root)
import { createSupabaseAuthMiddleware } from '@solvapay/next';

// Use 'proxy' export for Next.js 16 (no deprecation warning)
export const proxy = createSupabaseAuthMiddleware({
  publicRoutes: ['/api/list-plans'],
});

export const config = {
  matcher: ['/api/:path*'],
};
```

**File Location Notes:**
- **Next.js 15**: Place `middleware.ts` at project root
- **Next.js 16 without `src/` folder**: Place `middleware.ts` or `proxy.ts` at project root
- **Next.js 16 with `src/` folder**: Place `src/proxy.ts` or `src/middleware.ts` (in `src/` folder, not root)

> **Note:** Next.js 16 renamed "middleware" to "proxy". You can use either export name, but `proxy` is recommended to avoid deprecation warnings.

### Custom Middleware

Alternatively, you can create your own middleware:

```typescript
// middleware.ts (or src/proxy.ts for Next.js 16)
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // Extract user ID from your auth system
  const userId = await getUserIdFromAuth(request);
  
  // Clone request and add user ID header
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', userId);
  
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}
```

You can also use the `requireUserId` utility from `@solvapay/auth` in your middleware.

