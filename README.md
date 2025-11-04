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

# For Next.js integration
npm install @solvapay/next

# For authentication adapters
npm install @solvapay/auth
```

## 📦 Packages

The SDK consists of **5 published packages**:

- **`@solvapay/core`** - Types, schemas, and shared utilities
- **`@solvapay/server`** - Universal server SDK (Node + Edge runtime)
- **`@solvapay/react`** - Headless payment components and hooks
- **`@solvapay/auth`** - Authentication adapters for extracting user IDs from requests
- **`@solvapay/next`** - Next.js-specific utilities and helpers

See [`docs/architecture.md`](./docs/architecture.md) for detailed package design and boundaries.

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

function RootLayout({ children }) {
  return (
    <SolvaPayProvider
      customerRef={userId}
      createPayment={async ({ planRef, customerRef }) => {
        const res = await fetch('/api/create-payment-intent', {
          method: 'POST',
          body: JSON.stringify({ planRef, customerRef, agentRef: 'your_agent' })
        });
        return res.json();
      }}
      checkSubscription={async (customerRef) => {
        const res = await fetch(`/api/check-subscription?customerRef=${customerRef}`);
        return res.json();
      }}
    >
      {children}
    </SolvaPayProvider>
  );
}

function CheckoutPage() {
  const { subscriptions } = useSubscription();
  
  return (
    <PaymentForm
      planRef="pln_YOUR_PLAN"
      onSuccess={() => console.log('Payment successful!')}
    />
  );
}
```

**Backend API routes** needed for `SolvaPayProvider`:

```typescript
// /api/create-payment-intent/route.ts
import { createSolvaPay } from '@solvapay/server';

const solvaPay = createSolvaPay({ 
  apiKey: process.env.SOLVAPAY_SECRET_KEY 
});

export async function POST(req: Request) {
  const { planRef, customerRef, agentRef } = await req.json();
  
  const paymentIntent = await solvaPay.createPaymentIntent({
    planRef,
    customerRef,
    agentRef
  });
  
  return Response.json(paymentIntent);
}

// /api/check-subscription/route.ts
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const customerRef = searchParams.get('customerRef');
  
  try {
    const customer = await solvaPay.getCustomer({ customerRef });
    return Response.json({
      customerRef: customer.customerRef,
      subscriptions: customer.subscriptions || []
    });
  } catch {
    // Customer doesn't exist - return empty subscriptions (free tier)
    return Response.json({ customerRef, subscriptions: [] });
  }
}
```

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
- Complete subscription management
- Plan selection UI with `PaymentForm`
- Customer session management
- Subscription status checking with `useSubscription` hook

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

See [`docs/architecture.md`](./docs/architecture.md) for:
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

**💡 Hot Reloading**: For a better development experience, see [`docs/HOT_RELOADING_SETUP.md`](./docs/HOT_RELOADING_SETUP.md) to set up automatic rebuilds and hot reloading when working with SDK packages and examples.

### Branching & Publishing

- **`dev`** - Main development branch for daily work
- **`main`** - Production branch that triggers automated npm publishing

When you push to `main`, a new patch version is automatically published. For minor/major versions:

```bash
pnpm version:bump:minor  # 0.1.x → 0.2.0
pnpm version:bump:major  # 0.x.x → 1.0.0
```

See [`docs/publishing.md`](./docs/publishing.md) for complete publishing workflow and [`docs/contributing.md`](./docs/contributing.md) for development guidelines.

## 📖 Documentation

- **[Architecture](./docs/architecture.md)** - Package design and structure
- **[Contributing](./docs/contributing.md)** - Development guidelines
- **[Publishing](./docs/publishing.md)** - Publishing and release process
- **[Hot Reloading Setup](./docs/HOT_RELOADING_SETUP.md)** - Set up automatic rebuilds and hot reloading

## 🔒 Security

- API keys are **never** exposed to the browser
- Payment flows initiated by backend API routes only
- Webhook signature verification included
- Automatic runtime detection prevents environment mismatches

## 📝 License

MIT

## 🤝 Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Email**: support@solvapay.com
