# Architecture

**Goal:** Clean runtime boundaries, great DX, and focused packages. Core types are universal, server SDK works everywhere (Node + Edge), and React provides payment flow components.

## Monorepo Layout

```
solvapay-sdk/
├─ examples/
│  ├─ checkout-demo/       # Full checkout with plan selection
│  ├─ express-basic/       # Paywall protection for CRUD APIs
│  ├─ nextjs-openai-custom-gpt-actions/  # Payment flow with React and OpenAI integration
│  └─ mcp-basic/           # MCP server integration
├─ packages/
│  ├─ core/                # @solvapay/core (types & schemas)
│  ├─ server/              # @solvapay/server (Node + Edge)
│  ├─ react/               # @solvapay/react (payment components)
│  ├─ auth/                # @solvapay/auth (authentication adapters)
│  ├─ next/                # @solvapay/next (Next.js utilities)
│  ├─ demo-services/       # Demo services for examples (private)
│  ├─ test-utils/          # Testing utilities (private)
│  └─ tsconfig/            # Shared TypeScript config (private)
├─ docs/                   # Documentation
├─ pnpm-workspace.yaml
├─ turbo.json
├─ package.json
└─ README.md
```

## Package Summary

The SDK consists of **6 published packages** focused on clear use cases:

| Package | Version | Purpose | Published |
|---------|---------|---------|-----------|
| `@solvapay/core` | 1.0.0-preview.18 | Types, schemas, shared utilities | ✅ Yes |
| `@solvapay/server` | 1.0.0-preview.18 | Node + Edge runtime SDK with unified API | ✅ Yes |
| `@solvapay/react` | 1.0.0-preview.18 | Payment flow components (Stripe integration) | ✅ Yes |
| `@solvapay/react-supabase` | 1.0.0-preview.18 | Supabase auth adapter for React Provider | ✅ Yes |
| `@solvapay/auth` | 1.0.0-preview.18 | Authentication adapters for extracting user IDs | ✅ Yes |
| `@solvapay/next` | 1.0.0-preview.18 | Next.js-specific utilities and helpers | ✅ Yes |
| `@solvapay/demo-services` | 0.0.0 | Demo services for examples | 🔒 Private |
| `@solvapay/test-utils` | 0.0.0 | Testing utilities | 🔒 Private |
| `@solvapay/tsconfig` | 0.0.0 | Shared TypeScript config | 🔒 Private |


## Packages

### `@solvapay/core` (pure/agnostic)

* Types and schemas (zod), shared errors, version, tiny utilities.
* No Node/browser globals; `"sideEffects": false`.

### `@solvapay/server` (Node + Edge runtime)

* Secret API client (works everywhere - uses `fetch` API), webhook verification, paywall protection.
* Automatic runtime detection via export conditions:
  - **Node.js**: Uses Node `crypto` for webhook verification
  - **Edge runtimes**: Uses `crypto.subtle` for webhook verification
* Works in: Express, Fastify, Next.js API routes, Vercel Edge, Cloudflare Workers, Deno, Supabase Edge Functions
* Export conditions (`edge-light`, `worker`, `deno`) ensure correct module is loaded
* Includes unified API: `createSolvaPay()`, `payable.http()`, `payable.next()`, `payable.mcp()`

### `@solvapay/react` (payment components)

* **SolvaPayProvider**: Headless context provider that manages subscription state, payment methods, and customer references.
  - Zero-config with sensible defaults (uses `/api/check-subscription` and `/api/create-payment-intent`)
  - Supports custom API routes via config
  - Auto-fetches subscriptions on mount
  - Built-in localStorage caching with user validation
  - Supports auth adapters for extracting user IDs and tokens
* **PaymentForm**: Stripe payment form component for checkout flows.
* **Hooks**: `useSubscription`, `useCheckout`, `usePlans`, `useSubscriptionStatus`, `useSolvaPay`
* **Headless Components**: `PlanBadge`, `SubscriptionGate`, `PlanSelector`, `StripePaymentFormWrapper`
* Handles Stripe integration for payment processing.
* Includes default styling for payment forms.
* Peer deps: `react`, `react-dom`.

### `@solvapay/react-supabase` (Supabase React adapter)

* Provides `createSupabaseAuthAdapter` for use with `SolvaPayProvider`.
* Integrates with Supabase client-side authentication.
* Extracts user IDs and tokens from Supabase sessions.
* Peer deps: `@solvapay/react`, `@supabase/supabase-js`.

### `@solvapay/auth` (authentication adapters)

* **Server-side adapters**: `SupabaseAuthAdapter` for Supabase JWT token validation, `MockAuthAdapter` for testing.
* **Next.js utilities**: Helper functions for extracting user information from requests:
  - `getUserIdFromRequest(request)` - Extract user ID from `x-user-id` header
  - `requireUserId(request)` - Require user ID or return error response
  - `getUserEmailFromRequest(request)` - Extract email from Supabase JWT token
  - `getUserNameFromRequest(request)` - Extract name from Supabase JWT token
* Works in Edge runtimes (Vercel Edge Functions, Cloudflare Workers, etc.).
* Peer deps: `jose` (for Supabase JWT verification).

### `@solvapay/next` (Next.js utilities)

* Next.js-specific route helpers that wrap server SDK functions with Next.js types and optimizations.
* **Subscription helpers**:
  - `checkSubscription(request, options?)` - Check user subscription with built-in deduplication and caching
  - `cancelSubscription(request, body, options?)` - Cancel a subscription
* **Authentication helpers**:
  - `getAuthenticatedUser(request, options?)` - Get authenticated user info (userId, email, name)
* **Customer helpers**:
  - `syncCustomer(request, options?)` - Sync customer with SolvaPay backend
* **Payment helpers**:
  - `createPaymentIntent(request, body, options?)` - Create Stripe payment intent
  - `processPayment(request, body, options?)` - Process payment after Stripe confirmation
* **Checkout helpers**:
  - `createCheckoutSession(request, body, options?)` - Create hosted checkout session
  - `createCustomerSession(request, options?)` - Create customer portal session
* **Plans helpers**:
  - `listPlans(request)` - List available plans (public route, no auth required)
* **Cache management**:
  - `clearSubscriptionCache(userId)` - Clear cache for specific user
  - `clearAllSubscriptionCache()` - Clear all cache entries
  - `getSubscriptionCacheStats()` - Get cache statistics
* All helpers return `NextResponse` for errors, making them easy to use in Next.js API routes.
* Built-in request deduplication and short-term caching (2 seconds) prevent duplicate API calls.
* Automatic cache clearing after payment operations.
* Peer deps: `next` (>=13.0.0).

## Build & Release

* `tsup` builds ESM+CJS+types for every package.
* `turbo` orchestrates `build/test/lint/dev`.
* Version independently with Changesets (add later), or keep in lockstep early on.
* Node engines: `>=18.17`; Edge builds avoid Node APIs.

## Security & Env Hygiene

* Secrets only in **server** package.
* API keys never exposed to the browser - payment flows initiated by backend API routes.
* Provide `Env` schemas in `core` for validation, parse on the server.

## Testing

* **Unit tests**: Vitest with mock backend (fast, deterministic)
* **Integration tests**: Optional real backend testing via `USE_REAL_BACKEND=true`
* **Test utilities**: Shared helpers in `@solvapay/test-utils` (private package)
* **Demo services**: Example service implementations in `@solvapay/demo-services` (private package)

See [testing guide](./testing.md) for comprehensive test examples.

## Example Imports

```ts
// Server code (Node.js, Edge, Deno, etc.):
import { createSolvaPayClient, verifyWebhook, createSolvaPay } from '@solvapay/server';
// Auto-selects correct implementation based on runtime!

// Unified API for paywall protection:
const solvaPay = createSolvaPay({ apiKey: 'sk_...' });
const payable = solvaPay.payable({ agent: 'my-api' });

// Use with different adapters:
app.post('/endpoint', payable.http(handler));           // Express/Fastify
export const POST = payable.next(handler);              // Next.js
const mcpHandler = payable.mcp(handler);                // MCP servers

// React payment components:
import { 
  SolvaPayProvider, 
  PaymentForm, 
  useSubscription, 
  usePlans 
} from '@solvapay/react';

// Supabase React adapter:
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase';

// Authentication adapters (server-side):
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';
import { MockAuthAdapter } from '@solvapay/auth/mock';

// Auth utilities (Next.js routes):
import { 
  getUserIdFromRequest, 
  requireUserId,
  getUserEmailFromRequest,
  getUserNameFromRequest 
} from '@solvapay/auth';

// Next.js utilities:
import { 
  checkSubscription, 
  syncCustomer,
  createPaymentIntent,
  processPayment,
  createCheckoutSession,
  createCustomerSession,
  cancelSubscription,
  listPlans,
  clearSubscriptionCache,
  getAuthenticatedUser
} from '@solvapay/next';
```

## Runtime Detection

The `@solvapay/server` package uses export conditions to automatically select the correct implementation:

```json
{
  "exports": {
    ".": {
      "edge-light": "./dist/edge.js",  // Vercel Edge Functions
      "worker": "./dist/edge.js",       // Cloudflare Workers
      "deno": "./dist/edge.js",         // Deno
      "import": "./dist/index.js",      // Node.js ESM
      "require": "./dist/index.cjs"     // Node.js CommonJS
    }
  }
}
```

This means developers use the same import everywhere:
- ✅ **Vercel Edge Functions** → Gets `edge.js` (uses `crypto.subtle`)
- ✅ **Cloudflare Workers** → Gets `edge.js` (uses `crypto.subtle`)
- ✅ **Supabase Edge Functions** → Gets `edge.js` (uses `crypto.subtle`)
- ✅ **Deno** → Gets `edge.js` (uses `crypto.subtle`)
- ✅ **Next.js API Routes** → Gets `index.js` (uses Node `crypto`)
- ✅ **Express** → Gets `index.js` (uses Node `crypto`)

