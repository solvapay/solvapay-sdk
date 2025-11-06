# Next.js Integration Guide

This guide shows you how to integrate SolvaPay SDK with Next.js App Router to protect your API routes and add payment flows to your application.

## Table of Contents

- [Installation](#installation)
- [Basic Setup](#basic-setup)
- [Protecting API Routes](#protecting-api-routes)
- [Server Components](#server-components)
- [Client Components](#client-components)
- [Middleware Setup](#middleware-setup)
- [Payment Flow Integration](#payment-flow-integration)
- [Complete Example](#complete-example)

## Installation

Install the required packages:

```bash
npm install @solvapay/server @solvapay/next @solvapay/react @solvapay/react-supabase
# or
pnpm add @solvapay/server @solvapay/next @solvapay/react @solvapay/react-supabase
```

## Basic Setup

### 1. Environment Variables

Create a `.env.local` file:

```env
SOLVAPAY_SECRET_KEY=sk_...
NEXT_PUBLIC_SOLVAPAY_AGENT=agt_YOUR_AGENT_ID
```

### 2. Initialize SolvaPay Client

Create a shared SolvaPay instance:

```typescript
// lib/solvapay.ts
import { createSolvaPay } from '@solvapay/server';

export const solvaPay = createSolvaPay({
  apiKey: process.env.SOLVAPAY_SECRET_KEY,
});
```

## Protecting API Routes

### Basic API Route Protection

Use the `payable.next()` adapter to protect Next.js App Router API routes:

```typescript
// app/api/tasks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { solvaPay } from '@/lib/solvapay';

const payable = solvaPay.payable({
  agent: process.env.NEXT_PUBLIC_SOLVAPAY_AGENT!,
  plan: 'pln_premium',
});

// Your business logic
async function createTask(req: NextRequest) {
  const body = await req.json();
  const { title } = body;
  
  return { success: true, task: { title } };
}

// Protect the route
export const POST = payable.next(createTask);
```

### Using Next.js Helpers

The `@solvapay/next` package provides helper functions that simplify common operations:

```typescript
// app/api/check-subscription/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { checkSubscription } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await checkSubscription(request);
  
  // checkSubscription returns NextResponse or data object
  if (result instanceof NextResponse) {
    return result;
  }
  
  return NextResponse.json(result);
}
```

### Available Helper Functions

#### Check Subscription

```typescript
// app/api/check-subscription/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { checkSubscription } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await checkSubscription(request);
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

#### Create Payment Intent

```typescript
// app/api/create-payment-intent/route.ts
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

#### Process Payment

```typescript
// app/api/process-payment/route.ts
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

#### Create Checkout Session

```typescript
// app/api/create-checkout-session/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession } from '@solvapay/next';

export async function POST(request: NextRequest) {
  const { planRef, agentRef } = await request.json();
  
  const result = await createCheckoutSession(request, { planRef, agentRef });
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

#### Sync Customer

```typescript
// app/api/sync-customer/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { syncCustomer } from '@solvapay/next';

export async function POST(request: NextRequest) {
  const result = await syncCustomer(request);
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

## Server Components

Use SolvaPay in Server Components to check subscription status:

```typescript
// app/dashboard/page.tsx
import { checkSubscription } from '@solvapay/next';
import { cookies } from 'next/headers';

export default async function DashboardPage() {
  // Create a request-like object for checkSubscription
  const cookieStore = await cookies();
  const headers = new Headers();
  
  // Add auth headers if needed
  const authToken = cookieStore.get('auth-token');
  if (authToken) {
    headers.set('authorization', `Bearer ${authToken.value}`);
  }
  
  const request = new Request('http://localhost', {
    headers,
  });
  
  const subscription = await checkSubscription(request);
  
  if (subscription instanceof Response) {
    // Handle error
    return <div>Error checking subscription</div>;
  }
  
  return (
    <div>
      <h1>Dashboard</h1>
      {subscription.hasPaidSubscription ? (
        <p>You have an active subscription!</p>
      ) : (
        <p>Please subscribe to access premium features.</p>
      )}
    </div>
  );
}
```

## Client Components

Use React hooks and components for client-side payment flows:

```typescript
// app/checkout/page.tsx
'use client';

import { PaymentForm } from '@solvapay/react';
import { useRouter } from 'next/navigation';

export default function CheckoutPage() {
  const router = useRouter();
  
  return (
    <PaymentForm
      planRef="pln_premium"
      agentRef={process.env.NEXT_PUBLIC_SOLVAPAY_AGENT!}
      onSuccess={() => {
        router.push('/dashboard');
      }}
      onError={(error) => {
        console.error('Payment error:', error);
      }}
    />
  );
}
```

## Middleware Setup

### Authentication Middleware

Set up middleware to extract user information and make it available to API routes:

```typescript
// middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@solvapay/auth';

export async function middleware(request: NextRequest) {
  // Extract user ID from auth token, session, etc.
  const authToken = request.headers.get('authorization')?.replace('Bearer ', '');
  
  if (authToken) {
    // Verify token and extract user ID
    // This is a simplified example - use your actual auth logic
    const userId = await extractUserIdFromToken(authToken);
    
    if (userId) {
      // Add user ID to request headers for SolvaPay
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('x-user-id', userId);
      
      return NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
    }
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
```

### Supabase Auth Middleware

If using Supabase, use the provided middleware helper:

```typescript
// middleware.ts
import { createSupabaseAuthMiddleware } from '@solvapay/next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const middleware = createSupabaseAuthMiddleware({
  supabase,
  // Optional: customize which routes to protect
  protectedPaths: ['/api/protected'],
});
```

## Payment Flow Integration

### 1. Set Up Provider

Wrap your app with `SolvaPayProvider`:

```typescript
// app/layout.tsx
import { SolvaPayProvider } from '@solvapay/react';
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Optional: Use Supabase auth adapter
  const supabaseAdapter = createSupabaseAuthAdapter({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  });
  
  return (
    <html>
      <body>
        <SolvaPayProvider
          config={{
            // Optional: Custom API routes (defaults work out of the box)
            api: {
              checkSubscription: '/api/check-subscription',
              createPayment: '/api/create-payment-intent',
              processPayment: '/api/process-payment',
            },
            // Optional: Supabase auth adapter
            auth: { adapter: supabaseAdapter },
          }}
        >
          {children}
        </SolvaPayProvider>
      </body>
    </html>
  );
}
```

### 2. Create API Routes

Set up the required API routes using Next.js helpers:

```typescript
// app/api/check-subscription/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { checkSubscription } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await checkSubscription(request);
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

```typescript
// app/api/create-payment-intent/route.ts
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

```typescript
// app/api/process-payment/route.ts
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

### 3. Use Payment Components

Use React components and hooks in your pages:

```typescript
// app/checkout/page.tsx
'use client';

import { PaymentForm, useSubscription } from '@solvapay/react';
import { useRouter } from 'next/navigation';

export default function CheckoutPage() {
  const router = useRouter();
  const { hasPaidSubscription, isLoading } = useSubscription();
  
  if (isLoading) {
    return <div>Loading...</div>;
  }
  
  if (hasPaidSubscription) {
    return <div>You already have an active subscription!</div>;
  }
  
  return (
    <div>
      <h1>Subscribe to Premium</h1>
      <PaymentForm
        planRef="pln_premium"
        agentRef={process.env.NEXT_PUBLIC_SOLVAPAY_AGENT!}
        onSuccess={() => {
          router.push('/dashboard');
        }}
      />
    </div>
  );
}
```

## Complete Example

Here's a complete Next.js application with SolvaPay integration:

### Project Structure

```
app/
├── layout.tsx
├── page.tsx
├── dashboard/
│   └── page.tsx
├── checkout/
│   └── page.tsx
└── api/
    ├── tasks/
    │   └── route.ts
    ├── check-subscription/
    │   └── route.ts
    ├── create-payment-intent/
    │   └── route.ts
    └── process-payment/
        └── route.ts
lib/
└── solvapay.ts
middleware.ts
```

### Root Layout

```typescript
// app/layout.tsx
import { SolvaPayProvider } from '@solvapay/react';
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const supabaseAdapter = createSupabaseAuthAdapter({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  });
  
  return (
    <html>
      <body>
        <SolvaPayProvider config={{ auth: { adapter: supabaseAdapter } }}>
          {children}
        </SolvaPayProvider>
      </body>
    </html>
  );
}
```

### Protected API Route

```typescript
// app/api/tasks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { solvaPay } from '@/lib/solvapay';

const payable = solvaPay.payable({
  agent: process.env.NEXT_PUBLIC_SOLVAPAY_AGENT!,
  plan: 'pln_premium',
});

async function createTask(req: NextRequest) {
  const body = await req.json();
  const { title } = body;
  
  return { success: true, task: { title, id: Date.now().toString() } };
}

export const POST = payable.next(createTask);
```

### Checkout Page

```typescript
// app/checkout/page.tsx
'use client';

import { PaymentForm } from '@solvapay/react';
import { useRouter } from 'next/navigation';

export default function CheckoutPage() {
  const router = useRouter();
  
  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">Subscribe to Premium</h1>
      <PaymentForm
        planRef="pln_premium"
        agentRef={process.env.NEXT_PUBLIC_SOLVAPAY_AGENT!}
        onSuccess={() => router.push('/dashboard')}
      />
    </div>
  );
}
```

### Dashboard Page

```typescript
// app/dashboard/page.tsx
'use client';

import { useSubscription } from '@solvapay/react';
import Link from 'next/link';

export default function DashboardPage() {
  const { hasPaidSubscription, isLoading, subscription } = useSubscription();
  
  if (isLoading) {
    return <div>Loading...</div>;
  }
  
  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
      
      {hasPaidSubscription ? (
        <div>
          <p className="text-green-600">You have an active subscription!</p>
          {subscription?.plan && (
            <p>Plan: {subscription.plan.name}</p>
          )}
        </div>
      ) : (
        <div>
          <p className="text-gray-600">Please subscribe to access premium features.</p>
          <Link href="/checkout" className="text-blue-600 underline">
            Go to Checkout
          </Link>
        </div>
      )}
    </div>
  );
}
```

## Cache Management

The `@solvapay/next` package includes subscription caching to reduce API calls:

```typescript
import { clearSubscriptionCache, getSubscriptionCacheStats } from '@solvapay/next';

// Clear cache for a specific user
await clearSubscriptionCache(userId);

// Clear all caches
await clearAllSubscriptionCache();

// Get cache statistics
const stats = await getSubscriptionCacheStats();
console.log(stats);
```

## Best Practices

1. **Use Environment Variables**: Store API keys and configuration in `.env.local`.

2. **Separate API Routes**: Keep API routes separate from page routes for better organization.

3. **Error Handling**: Always handle errors from helper functions (they may return `NextResponse`).

4. **Type Safety**: Use TypeScript for better type safety.

5. **Cache Management**: Use subscription caching to reduce API calls and improve performance.

6. **Middleware**: Set up authentication middleware to extract user information early.

## Next Steps

- [React Integration Guide](./react.md) - Learn about React components and hooks
- [Error Handling Strategies](./error-handling.md) - Advanced error handling patterns
- [Performance Optimization](./performance.md) - Optimize your Next.js app
- [API Reference](/api/next/) - Full API documentation

