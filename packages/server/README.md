# @solvapay/server

Universal server SDK for Node.js and edge runtimes. Includes API client, paywall protection, and webhook verification.

**Works in**: Node.js, Vercel Edge Functions, Cloudflare Workers, Deno, Supabase Edge Functions, and more.

## Install

```bash
pnpm add @solvapay/server
```

## Usage

### Basic Client

The same imports work in **Node.js and edge runtimes**. The correct implementation is automatically selected:

```ts
import { createSolvaPayClient, verifyWebhook } from '@solvapay/server'

// Works in Node.js, Edge Functions, Cloudflare Workers, Deno, etc.
const apiClient = createSolvaPayClient({
  apiKey: process.env.SOLVAPAY_SECRET_KEY!,
})

// Auto-selects Node crypto or Web Crypto based on runtime
const event = await verifyWebhook({
  body,
  signature,
  secret: process.env.SOLVAPAY_WEBHOOK_SECRET!,
})
```

**Edge Runtime Examples:**

```ts
// Supabase Edge Function
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createSolvaPayClient, verifyWebhook } from 'https://esm.sh/@solvapay/server@latest'

const solvapay = createSolvaPayClient({
  apiKey: Deno.env.get('SOLVAPAY_SECRET_KEY')!,
})

// Vercel Edge Function
import { createSolvaPayClient } from '@solvapay/server'

export const runtime = 'edge'
const solvapay = createSolvaPayClient({
  apiKey: process.env.SOLVAPAY_SECRET_KEY!,
})
```

### Paywall Protection

Use the unified payable API to protect your endpoints and functions with usage limits and metered billing:

```ts
import { createSolvaPay } from '@solvapay/server';

// Create SolvaPay instance with your API key
const solvaPay = createSolvaPay({
  apiKey: process.env.SOLVAPAY_SECRET_KEY!
});

// Create a payable with your product configuration
const payable = solvaPay.payable({ product: 'my-product' });

// Use the appropriate adapter for your context:

// For HTTP frameworks (Express, Fastify)
app.post('/tasks', payable.http(async (args) => {
  return { result: 'success' };
}));

// For Next.js App Router
export const POST = payable.next(async (args) => {
  return { result: 'success' };
});

// For MCP servers
server.setRequestHandler(ListToolsRequestSchema, payable.mcp(async (args) => {
  return { tools: [...] };
}));

// For direct function protection (testing, background jobs)
const protectedHandler = await payable.function(async (args) => {
  return { result: 'success' };
});

const result = await protectedHandler({
  auth: { customer_ref: 'customer_123' }
});
```

### Authentication Integration

You can integrate authentication adapters from `@solvapay/auth` with the `getCustomerRef` option:

```ts
import { createSolvaPay } from '@solvapay/server'
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase'

const auth = new SupabaseAuthAdapter({
  jwtSecret: process.env.SUPABASE_JWT_SECRET!,
})

const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY! })

// Use with Next.js adapter
export const POST = solvaPay.payable({ product: 'my-api' }).next(
  async args => {
    return { result: 'success' }
  },
  {
    getCustomerRef: async req => {
      const userId = await auth.getUserIdFromRequest(req)
      return userId ?? 'anonymous'
    },
  },
)
```

This automatically extracts the user ID from authentication tokens and uses it as the customer reference for paywall checks.

### When to Use Each Adapter

Choose the adapter based on your context:

- **`payable.http()`** - Use with Express, Fastify, or other traditional HTTP frameworks
  - Handles request/response objects automatically
  - Extracts args from body, params, query
  - Formats errors as HTTP responses

- **`payable.next()`** - Use with Next.js App Router API routes
  - Works with Web Request/Response APIs
  - Handles route parameters and context
  - Returns proper Response objects

- **`payable.mcp()`** - Use with Model Context Protocol servers
  - Wraps responses in MCP format
  - Handles MCP-specific error reporting
  - Provides structured content

- **`payable.function()`** - Use for direct function protection
  - No framework overhead
  - Perfect for testing
  - Use in background jobs, cron tasks, or non-HTTP contexts

## API Client Methods

The `createSolvaPayClient` returns an object implementing `SolvaPayClient`:

- `checkLimits(params)` - Check if customer is within usage limits
- `trackUsage(params)` - Track usage for metered billing
- `createCustomer(params)` - Create a new customer
- `getCustomer(params)` - Get customer details by reference

## Type Generation

This package supports automatic TypeScript type generation from the SolvaPay backend OpenAPI specification.

### Generating Types

To generate types from your locally running backend:

```bash
# Ensure your backend is running on http://localhost:3001
# Then run:
pnpm generate:types
```

This will fetch the OpenAPI spec from `http://localhost:3001/v1/openapi.json` and generate TypeScript types in `src/types/generated.ts`. Only `/v1/sdk/` routes are included in the generated types.

### Using Generated Types

```typescript
import type { paths, components } from './types/generated'

// Use path operation types
type CheckLimitsRequest =
  paths['/v1/sdk/limits']['post']['requestBody']['content']['application/json']
type CheckLimitsResponse =
  paths['/v1/sdk/limits']['post']['responses']['200']['content']['application/json']

// Use component schemas
type Agent = components['schemas']['Agent']
type Plan = components['schemas']['Plan']
```

**Note:** The generated types complement the existing hand-written types in `src/types.ts`. Run `pnpm generate:types` whenever the backend API changes to keep types in sync.

## Testing

This package includes comprehensive tests for SDK functionality, including unit tests and integration tests with real backend.

### Running Tests

```bash
# Run unit tests only (fast, uses mock backend)
pnpm test

# Run integration tests (requires real backend)
pnpm test:integration

# Run all tests
pnpm test:all

# Run all tests with real backend
pnpm test:all:integration

# Watch mode
pnpm test:watch
```

### Unit Tests

Unit tests (`__tests__/paywall.test.ts`) use a mock API client and test:

- Paywall protection logic
- Handler creation (HTTP, Next.js, MCP)
- Error handling
- Authentication flows
- Product resolution

**No backend required** - runs fast and deterministically.

### Integration Tests

Integration tests (`__tests__/backend.integration.test.ts`) connect to a real SolvaPay backend and test:

- SDK API methods with real responses
- Actual limit enforcement
- Real usage tracking
- Multi-framework handlers with backend
- Error handling with real backend responses

**Setup required:**

Set environment variables before running tests:

```bash
# Option 1: Export in your shell (persists in session)
export USE_REAL_BACKEND=true
export SOLVAPAY_SECRET_KEY=your_secret_key_here
export SOLVAPAY_API_BASE_URL=http://localhost:3001  # optional, defaults to dev API
pnpm test:integration

# Option 2: Inline with command (single use)
USE_REAL_BACKEND=true SOLVAPAY_SECRET_KEY=your_key pnpm test:integration
```

**Note:** Integration tests are automatically skipped if `USE_REAL_BACKEND` or `SOLVAPAY_SECRET_KEY` are not set. This allows CI/CD to run unit tests without backend credentials.

### Payment Integration Tests (Stripe)

Payment tests (`__tests__/payment-stripe.integration.test.ts`) verify the complete payment flow with Stripe:

- Creating payment intents
- Confirming payments with test cards
- Webhook processing (optional)
- Credit management and usage tracking

**Required Setup:**

```bash
export USE_REAL_BACKEND=true
export SOLVAPAY_SECRET_KEY=your_secret_key_here
export STRIPE_TEST_SECRET_KEY=sk_test_your_stripe_key
export SOLVAPAY_API_BASE_URL=http://localhost:3001
```

**Optional - Webhook Tests:**

The E2E webhook test is skipped by default because it requires Stripe webhooks to be forwarded to your local backend. To enable webhook testing:

1. **Install Stripe CLI:**

   ```bash
   # macOS
   brew install stripe/stripe-cli/stripe

   # Linux / Windows - see https://stripe.com/docs/stripe-cli
   ```

2. **Login to Stripe:**

   ```bash
   stripe login
   ```

3. **Forward webhooks to your local backend:**

   ```bash
   # Terminal 1: Start your backend
   cd path/to/solvapay-backend
   pnpm dev

   # Terminal 2: Forward Stripe webhooks
   stripe listen --forward-to localhost:3001/webhooks/stripe
   ```

4. **Run payment tests with webhook testing enabled:**
   ```bash
   ENABLE_WEBHOOK_TESTS=true pnpm test:integration:payment
   ```

The Stripe CLI will forward webhook events from Stripe to your local backend, allowing the E2E test to verify the complete payment flow including webhook processing.

### Debugging and Logging

The SDK and tests provide environment variable controls for logging:

**SDK Debug Logging**

Enable detailed logging for SDK operations (API calls, responses, errors):

```bash
# Enable SDK debug logging
export SOLVAPAY_DEBUG=true

# Run tests or your application
pnpm test:integration
```

**Test Verbose Logging**

Enable verbose logging for integration test progress and debug information:

```bash
# Enable verbose test logging (test setup, progress, debug info)
export VERBOSE_TEST_LOGS=true

# Run integration tests
pnpm test:integration
```

**Combined Usage:**

```bash
# Enable all logging for maximum debugging
SOLVAPAY_DEBUG=true VERBOSE_TEST_LOGS=true pnpm test:integration

# Quiet mode (default) - minimal output
pnpm test:integration
```

By default, both are **disabled** to keep test output clean and readable. Enable them when troubleshooting test failures or debugging SDK behavior.

### CI/CD

```yaml
# Always run unit tests
- name: Run unit tests
  run: pnpm test

# Optionally run integration tests if secrets available
- name: Run integration tests
  if: ${{ secrets.SOLVAPAY_SECRET_KEY != '' }}
  env:
    SOLVAPAY_SECRET_KEY: ${{ secrets.SOLVAPAY_SECRET_KEY }}
  run: pnpm test:integration
```

More: [docs/guides/architecture.md](../../docs/guides/architecture.md)
