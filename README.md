# SolvaPay SDK

A modern TypeScript SDK for monetizing APIs, AI agents, and MCP servers with paywall protection and purchase management.

**Key Features:**

- **One-line paywall protection** for Express, Next.js, Supabase Edge Functions, and MCP servers
- **Headless React components** for purchase checkout flows
- **Works out of the box** with stub mode (no API key needed for testing)
- **Secure by default** - API keys never exposed to the browser
- **Edge runtime support** for global low-latency deployments

[![npm version](https://img.shields.io/npm/v/@solvapay/server.svg)](https://www.npmjs.com/package/@solvapay/server)
[![preview](https://img.shields.io/npm/v/@solvapay/server/preview?label=preview)](https://www.npmjs.com/package/@solvapay/server?activeTab=versions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Quick Start

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

# For Web-standards runtimes (Deno / Supabase Edge / Cloudflare Workers / Bun)
npm install @solvapay/fetch

# For authentication adapters
npm install @solvapay/auth
```

## Packages

The SDK consists of **8 published packages**:

- **`@solvapay/core`** - Types, schemas, and shared utilities
- **`@solvapay/server`** - Universal server SDK (Node + Edge runtime)
- **`@solvapay/react`** - Headless payment components and hooks
- **`@solvapay/react-supabase`** - Supabase auth adapter for React Provider
- **`@solvapay/auth`** - Authentication adapters and utilities for extracting user IDs from requests
- **`@solvapay/next`** - Next.js-specific utilities and helpers
- **`@solvapay/fetch`** - Fetch-first adapter for Web-standards runtimes (Deno / Supabase Edge / Cloudflare Workers / Bun / Next edge / Vercel Functions). Renamed from `@solvapay/supabase` — API surface is unchanged.
- **`solvapay`** - CLI for auth bootstrap (`npx solvapay init`)

See [`docs/contributing/architecture.md`](./docs/contributing/architecture.md) for contributor
architecture notes and package boundaries.

## Usage

### Server-Side: Paywall Protection

Products are created in the SolvaPay UI, and are available for SDK integration by default.

```typescript
import { createSolvaPay } from '@solvapay/server'

// Create SolvaPay instance
const solvaPay = createSolvaPay({
  apiKey: process.env.SOLVAPAY_SECRET_KEY,
})

// Create payable handlers for your product
const payable = solvaPay.payable({
  product: 'prd_YOUR_PRODUCT',
})

// Protect endpoints with framework-specific adapters:
app.post('/tasks', payable.http(createTask)) // Express/Fastify
export const POST = payable.next(createTask) // Next.js App Router
const handler = payable.mcp(createTask) // MCP servers
```

### Client-Side: Payment Flow

Wrap your app with `SolvaPayProvider` and use `PaymentForm` for checkout:

```tsx
import { SolvaPayProvider, PaymentForm, usePurchase } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'
import { supabase } from './lib/supabase'

function RootLayout({ children }) {
  // Optional: Use Supabase auth adapter
  const supabaseAdapter = createSupabaseAuthAdapter({ client: supabase })

  return (
    <SolvaPayProvider
      config={{
        // Optional: Custom API routes (defaults to /api/check-purchase and /api/create-payment-intent)
        api: {
          checkPurchase: '/api/check-purchase',
          createPayment: '/api/create-payment-intent',
          processPayment: '/api/process-payment',
        },
        // Optional: Supabase auth adapter (auto-extracts user ID and token)
        auth: { adapter: supabaseAdapter },
      }}
    >
      {children}
    </SolvaPayProvider>
  )
}

function CheckoutPage() {
  const { purchases, hasPaidPurchase } = usePurchase()

  return (
    <PaymentForm
      planRef="pln_YOUR_PLAN"
      productRef="prd_YOUR_PRODUCT"
      onSuccess={() => console.log('Payment successful!')}
    />
  )
}
```

**Backend API routes** using Next.js helpers (recommended):

```typescript
// /api/check-purchase/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { checkPurchase } from '@solvapay/next'

export async function GET(request: NextRequest) {
  const result = await checkPurchase(request)
  return result instanceof NextResponse ? result : NextResponse.json(result)
}

// /api/create-payment-intent/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createPaymentIntent } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { planRef, productRef } = await request.json()

  if (!planRef || !productRef) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
  }

  const result = await createPaymentIntent(request, { planRef, productRef })
  return result instanceof NextResponse ? result : NextResponse.json(result)
}

// /api/process-payment/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { processPayment } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { paymentIntentId, productRef, planRef } = await request.json()

  if (!paymentIntentId || !productRef) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
  }

  const result = await processPayment(request, { paymentIntentId, productRef, planRef })
  return result instanceof NextResponse ? result : NextResponse.json(result)
}

// /api/list-plans/route.ts (public route)
import { NextRequest, NextResponse } from 'next/server'
import { listPlans } from '@solvapay/next'

export async function GET(request: NextRequest) {
  const result = await listPlans(request)
  return result instanceof NextResponse ? result : NextResponse.json(result)
}

// /api/sync-customer/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { syncCustomer } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const result = await syncCustomer(request)
  return result instanceof NextResponse ? result : NextResponse.json({ customerRef: result })
}
```

**Supabase Edge Functions** using `@solvapay/fetch` (one-liner per endpoint):

```typescript
// supabase/functions/check-purchase/index.ts
import { checkPurchase } from '@solvapay/fetch'

Deno.serve(checkPurchase)
```

All 10 endpoints follow the same pattern. See the [supabase-edge example](./examples/supabase-edge) for the complete setup.

**Alternative: Using server SDK directly** (if you need more control):

```typescript
// /api/create-payment-intent/route.ts
import { createSolvaPay } from '@solvapay/server'
import { requireUserId } from '@solvapay/auth'

const solvaPay = createSolvaPay({
  apiKey: process.env.SOLVAPAY_SECRET_KEY,
})

export async function POST(req: Request) {
  const userIdOrError = requireUserId(req)
  if (userIdOrError instanceof Response) {
    return userIdOrError
  }

  const { planRef, productRef } = await req.json()
  const paymentIntent = await solvaPay.createPaymentIntent({
    planRef,
    customerRef: userIdOrError, // Use userId as customerRef
    productRef,
  })

  return Response.json(paymentIntent)
}
```

### Next.js Helpers Reference

The `@solvapay/next` package provides helper functions for common API route patterns:

**Purchase Helpers:**

- `checkPurchase(request, options?)` - Check user purchase (with deduplication & caching)
- `cancelRenewal(request, body, options?)` - Cancel a renewal

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

- `clearPurchaseCache(userId)` - Clear cache for specific user
- `clearAllPurchaseCache()` - Clear all cache entries
- `getPurchaseCacheStats()` - Get cache statistics

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

## Examples

The [`examples/`](./examples) directory contains working demonstrations:

### [express-basic](./examples/express-basic)

Simple Express.js API with paywall protection:

- Protect CRUD endpoints with `.http()` adapter
- Customer identification via headers
- Free tier limits with automatic checkout URLs
- Works out of the box with stub mode (no API key needed)

```bash
cd examples/express-basic && pnpm dev
```

### [checkout-demo](./examples/checkout-demo)

Full-featured Next.js checkout flow:

- Complete purchase management using `SolvaPayProvider`
- Plan selection UI with `PaymentForm` and `usePlans` hook
- Customer session management
- Purchase status checking with `usePurchase` and `usePurchaseStatus` hooks
- Supabase authentication integration
- API routes using Next.js helpers (`checkPurchase`, `createPaymentIntent`, `processPayment`, `listPlans`, `syncCustomer`)

```bash
cd examples/checkout-demo && pnpm dev
```

### [hosted-checkout-demo](./examples/hosted-checkout-demo)

Hosted checkout flow using redirect-based payments:

- Hosted checkout on solvapay.com (similar to Stripe Checkout)
- Customer portal for purchase management
- Token-based access control
- Supabase authentication integration

```bash
cd examples/hosted-checkout-demo && pnpm dev
```

### [supabase-edge](./examples/supabase-edge)

Supabase Edge Functions with `@solvapay/fetch` adapter:

- One-liner per Edge Function (10 endpoints)
- CORS utility with configurable origins
- Deno import map for npm packages
- Reference project for React + Supabase architectures

See the [supabase-edge README](./examples/supabase-edge/README.md) for setup and a side-by-side comparison with Next.js API routes.

### [mcp-oauth-bridge](./examples/mcp-oauth-bridge)

Model Context Protocol server with OAuth bridge and paywall:

- Local OAuth discovery metadata endpoints
- Bearer token protected `/mcp` endpoint
- Dynamic client registration and OAuth flow support
- `payable.mcp()` with customer identity from OAuth context

```bash
cd examples/mcp-oauth-bridge && pnpm dev
```

### [mcp-time-app](./examples/mcp-time-app)

Model Context Protocol app with UI resource and paywall:

- MCP app resource integration via `@modelcontextprotocol/ext-apps`
- Tool + app resource registration on a single server
- OAuth bridge integration for secure MCP access
- `payable.mcp()` with product-level paywall protection

```bash
cd examples/mcp-time-app && pnpm dev
```

See [`examples/README.md`](./examples/README.md) for detailed setup instructions.

## Architecture

This is a **monorepo** with 8 published packages built using Turborepo, tsup, and pnpm workspaces.

See [`docs/contributing/architecture.md`](./docs/contributing/architecture.md) for:

- Detailed package design and boundaries
- Runtime detection strategy (Node vs Edge)
- Build system and testing approach
- Security considerations

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Branching, Changesets & Publishing

The monorepo uses [**Changesets**](https://github.com/changesets/changesets) for independent, per-package versioning. Packages move on their own semver tracks — you'll see legitimately mixed lockfiles like `@solvapay/core@1.0.7` next to `@solvapay/mcp@0.1.0`.

**Branches**

- **`dev`** — primary development branch. Every push auto-publishes a
  snapshot to the `@preview` npm dist-tag via
  [`.github/workflows/publish-preview.yml`](./.github/workflows/publish-preview.yml).
- **`main`** — stable release branch. Every push either (a) opens or updates
  a "Version Packages" PR enumerating accumulated changesets, or — when
  that PR merges — (b) publishes bumped packages to the `@latest` npm
  dist-tag and creates matching git tags via
  [`.github/workflows/publish.yml`](./.github/workflows/publish.yml).

**Workflow per PR**

1. Make your code change on a feature branch off `dev`.
2. Run `pnpm changeset` and pick the right bump level (patch / minor / major) for every affected package. Commit the generated `.changeset/*.md`.
3. Open a PR to `dev`. On merge, a preview snapshot ships.
4. When ready for a stable release, merge `dev` → `main`. The "Version Packages" PR accumulates every changeset since the last release; merging it publishes.

**Pre-publish gates** (run by both workflows):

- `pnpm test` — full monorepo test suite.
- `pnpm build:packages` — every publishable package builds to `dist/`.
- `pnpm validate:fetch-runtime` — asserts `@solvapay/fetch` and
  `@solvapay/mcp-fetch` load cleanly in a bare Web-standards environment
  and don't leak forbidden Node built-ins. Blocks publish on any
  regression in the Web-standards runtime surface.

**Installing preview vs stable**

```bash
pnpm add @solvapay/core           # stable / @latest
pnpm add @solvapay/core@preview   # latest snapshot from `dev`
pnpm add @solvapay/core@1.0.7     # exact pin
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full development workflow.

## Documentation

- **[Architecture](./docs/contributing/architecture.md)** - Package design and structure
- **[Contributing](./CONTRIBUTING.md)** - Development guidelines
- **[Changesets config](./.changeset/README.md)** - How to write a changeset

## Security

- API keys are **never** exposed to the browser
- Payment flows initiated by backend API routes only
- Webhook signature verification included
- Automatic runtime detection prevents environment mismatches

**Found a security vulnerability?** Please report it responsibly - see our [Security Policy](./SECURITY.md) for details.

## License

MIT License - see [LICENSE.md](./LICENSE.md) for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Email**: contact@solvapay.com

## Additional Resources

- **[Contributing Guide](./CONTRIBUTING.md)** - How to contribute to the project
- **[Code of Conduct](./CODE_OF_CONDUCT.md)** - Community guidelines
- **[Security Policy](./SECURITY.md)** - How to report security vulnerabilities
