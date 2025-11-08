# SolvaPay SDK

A modern TypeScript SDK for monetizing APIs, AI agents, and MCP servers with paywall protection and subscription management.

**✨ Key Features:**
- 🛡️ **One-line paywall protection** for Express, Next.js, and MCP servers
- 💳 **Headless React components** for subscription checkout flows
- 🚀 **Works out of the box** with stub mode (no API key needed for testing)
- 🔒 **Secure by default** - API keys never exposed to the browser
- ⚡ **Edge runtime support** for global low-latency deployments

[![npm version](https://img.shields.io/npm/v/@solvapay/server.svg)](https://www.npmjs.com/package/@solvapay/server)
[![preview](https://img.shields.io/npm/v/@solvapay/server/preview?label=preview)](https://www.npmjs.com/package/@solvapay/server?activeTab=versions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🚀 Quick Start

### Try an Example (No API Key Required)

```bash
# Clone and setup
git clone https://github.com/solvapay/solvapay-sdk
cd solvapay-sdk
pnpm install && pnpm build

# Run Express example with stub mode
cd examples/express-basic
pnpm dev
```

The Express example runs in **stub mode** by default - perfect for testing without an API key!

### Add to Your Project

```bash
# For server-side paywall protection
npm install @solvapay/server

# For client-side payment flows
npm install @solvapay/react

# For Supabase authentication (optional, if using Supabase)
npm install @solvapay/react-supabase @supabase/supabase-js

# For Next.js integration
npm install @solvapay/next

# For authentication adapters
npm install @solvapay/auth
```

## 📦 Packages

The SDK consists of **6 published packages**:

- **`@solvapay/core`** - Types, schemas, and shared utilities
- **`@solvapay/server`** - Universal server SDK (Node + Edge runtime)
- **`@solvapay/react`** - Headless payment components and hooks
- **`@solvapay/react-supabase`** - Supabase auth adapter for React Provider
- **`@solvapay/auth`** - Authentication adapters and utilities for extracting user IDs from requests
- **`@solvapay/next`** - Next.js-specific utilities and helpers

See [`docs/guides/architecture.md`](./docs/guides/architecture.md) for detailed package design and boundaries.

## 🎯 Usage

### Server-Side: Paywall Protection

```typescript
import { createSolvaPay } from '@solvapay/server';

// Create SolvaPay instance
const solvaPay = createSolvaPay({ 
  apiKey: process.env.SOLVAPAY_SECRET_KEY 
});

// Create payable handlers for your agent
const payable = solvaPay.payable({ 
  agent: 'agt_YOUR_AGENT', 
  plan: 'pln_YOUR_PLAN' 
});

// Protect endpoints with framework-specific adapters:
app.post('/tasks', payable.http(createTask));      // Express/Fastify
export const POST = payable.next(createTask);      // Next.js App Router
const handler = payable.mcp(createTask);           // MCP servers
```

### Client-Side: Payment Flow

Wrap your app with `SolvaPayProvider` and use `PaymentForm` for checkout:

```tsx
import { SolvaPayProvider, PaymentForm, useSubscription } from '@solvapay/react';
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase';

function RootLayout({ children }) {
  // Optional: Use Supabase auth adapter
  const supabaseAdapter = createSupabaseAuthAdapter({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  });

  return (
    <SolvaPayProvider 
      config={{
        // Optional: Custom API routes (defaults to /api/check-subscription and /api/create-payment-intent)
        api: {
          checkSubscription: '/api/check-subscription',
          createPayment: '/api/create-payment-intent',
          processPayment: '/api/process-payment',
        },
        // Optional: Supabase auth adapter (auto-extracts user ID and token)
        auth: { adapter: supabaseAdapter }
      }}
    >
      {children}
    </SolvaPayProvider>
  );
}

function CheckoutPage() {
  const { subscriptions, hasPaidSubscription } = useSubscription();
  
  return (
    <PaymentForm
      planRef="pln_YOUR_PLAN"
      agentRef="agt_YOUR_AGENT"
      onSuccess={() => console.log('Payment successful!')}
    />
  );
}
```

**Backend API routes** using Next.js helpers (recommended):

```typescript
// /api/check-subscription/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { checkSubscription } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await checkSubscription(request);
  return result instanceof NextResponse ? result : NextResponse.json(result);
}

// /api/create-payment-intent/route.ts
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

// /api/process-payment/route.ts
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

// /api/list-plans/route.ts (public route)
import { NextRequest, NextResponse } from 'next/server';
import { listPlans } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await listPlans(request);
  return result instanceof NextResponse ? result : NextResponse.json(result);
}

// /api/sync-customer/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { syncCustomer } from '@solvapay/next';

export async function POST(request: NextRequest) {
  const result = await syncCustomer(request);
  return result instanceof NextResponse ? result : NextResponse.json({ customerRef: result });
}
```

**Alternative: Using server SDK directly** (if you need more control):

```typescript
// /api/create-payment-intent/route.ts
import { createSolvaPay } from '@solvapay/server';
import { requireUserId } from '@solvapay/auth';

const solvaPay = createSolvaPay({ 
  apiKey: process.env.SOLVAPAY_SECRET_KEY 
});

export async function POST(req: Request) {
  const userIdOrError = requireUserId(req);
  if (userIdOrError instanceof Response) {
    return userIdOrError;
  }
  
  const { planRef, agentRef } = await req.json();
  const paymentIntent = await solvaPay.createPaymentIntent({
    planRef,
    customerRef: userIdOrError, // Use userId as customerRef
    agentRef
  });
  
  return Response.json(paymentIntent);
}
```

### Next.js Helpers Reference

The `@solvapay/next` package provides helper functions for common API route patterns:

**Subscription Helpers:**
- `checkSubscription(request, options?)` - Check user subscription (with deduplication & caching)
- `cancelSubscription(request, body, options?)` - Cancel a subscription

**Customer Helpers:**
- `syncCustomer(request, options?)` - Sync customer with SolvaPay backend

**Payment Helpers:**
- `createPaymentIntent(request, body, options?)` - Create Stripe payment intent
- `processPayment(request, body, options?)` - Process payment after Stripe confirmation

**Checkout Helpers:**
- `createCheckoutSession(request, body, options?)` - Create hosted checkout session
- `createCustomerSession(request, options?)` - Create customer portal session

**Plans Helpers:**
- `listPlans(request)` - List available plans (public route)

**Cache Management:**
- `clearSubscriptionCache(userId)` - Clear cache for specific user
- `clearAllSubscriptionCache()` - Clear all cache entries
- `getSubscriptionCacheStats()` - Get cache statistics

**Authentication Helpers:**
- `getAuthenticatedUser(request, options?)` - Get authenticated user info (userId, email, name)

### Auth Utilities Reference

The `@solvapay/auth` package provides utilities for extracting user information:

**Next.js Route Utilities:**
- `getUserIdFromRequest(request, options?)` - Extract user ID from `x-user-id` header
- `requireUserId(request, options?)` - Require user ID or return error response
- `getUserEmailFromRequest(request, options?)` - Extract email from Supabase JWT token
- `getUserNameFromRequest(request, options?)` - Extract name from Supabase JWT token

**Server-Side Adapters:**
- `SupabaseAuthAdapter` - For Supabase JWT token validation (server-side)
- `MockAuthAdapter` - For testing and development

See [`packages/next/README.md`](./packages/next/README.md) and [`packages/auth/README.md`](./packages/auth/README.md) for detailed documentation.

## 📚 Examples

The [`examples/`](./examples) directory contains working demonstrations:

### 🚀 [express-basic](./examples/express-basic)
Simple Express.js API with paywall protection:
- Protect CRUD endpoints with `.http()` adapter
- Customer identification via headers
- Free tier limits with automatic checkout URLs
- Works out of the box with stub mode (no API key needed)

```bash
cd examples/express-basic && pnpm dev
```

### 💳 [checkout-demo](./examples/checkout-demo)
Full-featured Next.js checkout flow:
- Complete subscription management using `SolvaPayProvider`
- Plan selection UI with `PaymentForm` and `usePlans` hook
- Customer session management
- Subscription status checking with `useSubscription` and `useSubscriptionStatus` hooks
- Supabase authentication integration
- API routes using Next.js helpers (`checkSubscription`, `createPaymentIntent`, `processPayment`, `listPlans`, `syncCustomer`)

```bash
cd examples/checkout-demo && pnpm dev
```

### 🤖 [nextjs-openai-custom-gpt-actions](./examples/nextjs-openai-custom-gpt-actions)
OpenAI Custom GPT Actions integration:
- OAuth 2.0 authentication flow
- Paywall-protected API endpoints
- OpenAPI schema generation
- Payment flow for GPT Actions

```bash
cd examples/nextjs-openai-custom-gpt-actions && pnpm dev
```

### 🔌 [mcp-basic](./examples/mcp-basic)
Model Context Protocol server with paywall:
- Protect MCP tools with `.mcp()` adapter
- Integration with Claude Desktop and other MCP clients
- Pay-per-use pricing model

```bash
cd examples/mcp-basic && pnpm dev
```

See [`examples/README.md`](./examples/README.md) for detailed setup instructions.

## 🏗️ Architecture

This is a **monorepo** with 5 published packages built using Turborepo, tsup, and pnpm workspaces.

See [`docs/guides/architecture.md`](./docs/guides/architecture.md) for:
- Detailed package design and boundaries
- Runtime detection strategy (Node vs Edge)
- Build system and testing approach
- Security considerations

## 🧪 Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Branching & Publishing

- **`dev`** - Main development branch for daily work
- **`main`** - Production branch that triggers automated npm publishing

When you push to `main`, a new patch version is automatically published. For minor/major versions:

```bash
pnpm version:bump:minor  # 0.1.x → 0.2.0
pnpm version:bump:major  # 0.x.x → 1.0.0
```

See [`docs/publishing.md`](./docs/publishing.md) for complete publishing workflow and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for development guidelines.

## 📖 Documentation

- **[Architecture](./docs/guides/architecture.md)** - Package design and structure
- **[Contributing](./CONTRIBUTING.md)** - Development guidelines
- **[Publishing](./docs/publishing.md)** - Publishing and release process

## 🔒 Security

- API keys are **never** exposed to the browser
- Payment flows initiated by backend API routes only
- Webhook signature verification included
- Automatic runtime detection prevents environment mismatches

## 📝 License

MIT License - see [LICENSE.md](./LICENSE.md) for details.

## 🤝 Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Email**: support@solvapay.com
