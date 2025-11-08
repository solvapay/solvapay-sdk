# Welcome to SolvaPay SDK

SolvaPay SDK is a modern TypeScript SDK for monetizing APIs, AI agents, and MCP (Model Context Protocol) servers with paywall protection and subscription management. It provides a unified API that works across multiple frameworks and runtimes.

## What is SolvaPay SDK?

SolvaPay SDK helps you monetize your APIs, AI agents, and MCP servers with minimal setup. Add paywall protection to your endpoints, manage subscriptions, and process payments—all with a simple, type-safe API.

## Key Features

### 🛡️ One-Line Paywall Protection

Protect your API endpoints, functions, and MCP tools with a single line of code:

```typescript
// Express.js
app.post('/tasks', payable.http(createTask))

// Next.js App Router
export const POST = payable.next(createTask)

// MCP Server
const handler = payable.mcp(createTask)
```

### 💳 Headless React Components

Build beautiful payment flows with headless React components that work with any design system:

```tsx
import { PaymentForm, useSubscription } from '@solvapay/react'

function CheckoutPage() {
  const { hasPaidSubscription } = useSubscription()

  return (
    <PaymentForm
      planRef="pln_premium"
      agentRef="agt_myapi"
      onSuccess={() => router.push('/dashboard')}
    />
  )
}
```

### 🚀 Works Out of the Box

- **Stub mode** - Test without an API key
- **Edge runtime support** - Deploy globally with low latency
- **Automatic runtime detection** - Works in Node.js and Edge environments
- **Type-safe** - Full TypeScript support with comprehensive types

### 🔒 Secure by Default

- API keys never exposed to the browser
- Payment flows initiated by backend API routes only
- Webhook signature verification included
- Automatic runtime detection prevents environment mismatches

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

### Install in Your Project

```bash
# For server-side paywall protection
npm install @solvapay/server

# For client-side payment flows
npm install @solvapay/react

# For Supabase authentication (optional)
npm install @solvapay/react-supabase @supabase/supabase-js

# For Next.js integration
npm install @solvapay/next

# For authentication adapters
npm install @solvapay/auth
```

## Use Cases

### API Monetization

Protect your REST or GraphQL APIs with usage limits and subscription checks:

```typescript
const solvaPay = createSolvaPay()
const payable = solvaPay.payable({
  agent: 'agt_myapi',
  plan: 'pln_premium',
})

// Protect any endpoint
app.post(
  '/api/generate',
  payable.http(async req => {
    // Your business logic here
    return { result: 'generated content' }
  }),
)
```

### AI Agents

Monetize AI agent interactions with pay-per-use or subscription models:

```typescript
// Protect agent endpoints
app.post(
  '/agent/chat',
  payable.http(async req => {
    const response = await aiAgent.chat(req.body.message)
    return { response }
  }),
)
```

### MCP Servers

Protect MCP tools with paywall protection:

```typescript
import { createSolvaPay } from '@solvapay/server'

const solvaPay = createSolvaPay()
const payable = solvaPay.payable({
  agent: 'agt_mcptools',
  plan: 'pln_pro',
})

// Protect MCP tools
const handler = payable.mcp(async args => {
  // Tool implementation
  return { result: 'tool output' }
})
```

## Architecture Overview

SolvaPay SDK is organized as a monorepo with 6 published packages:

- **`@solvapay/core`** - Types, schemas, and shared utilities
- **`@solvapay/server`** - Universal server SDK (Node + Edge runtime)
- **`@solvapay/react`** - Headless payment components and hooks
- **`@solvapay/react-supabase`** - Supabase auth adapter for React Provider
- **`@solvapay/auth`** - Authentication adapters and utilities
- **`@solvapay/next`** - Next.js-specific utilities and helpers

### How It Works

1. **Agent & Plan Setup**: Define your agent (API/service) and plans (subscription tiers) in the SolvaPay dashboard
2. **Protection**: Use `payable()` to wrap your business logic with paywall protection
3. **Customer Management**: Customers are automatically created and synced with your authentication system
4. **Payment Processing**: Integrate Stripe for payment processing (handled by SolvaPay backend)
5. **Usage Tracking**: Track usage and enforce limits automatically

### Request Flow

```
Client Request
    ↓
Paywall Check (via payable adapter)
    ↓
Check Subscription Status
    ↓
Has Subscription? → Yes → Execute Business Logic
    ↓ No
Check Usage Limits
    ↓
Within Limits? → Yes → Execute Business Logic
    ↓ No
Return Paywall Error (with checkout URL)
```

## Next Steps

- **[Installation Guide](./getting-started/installation.md)** - Set up SolvaPay SDK in your project
- **[Quick Start](./getting-started/quick-start.md)** - Get up and running in 5 minutes
- **[Core Concepts](./getting-started/core-concepts.md)** - Understand agents, plans, and the paywall flow
- **[Architecture Guide](./guides/architecture.md)** - Detailed technical architecture and package design

## Documentation

- **[Framework Guides](./guides/)** - Express, Next.js, React, and MCP integration guides
- **[API Reference](./api/)** - Complete API documentation for all packages
- **[Examples](./examples/overview.md)** - Working examples and demos
- **[Advanced Topics](./guides/)** - Custom authentication, error handling, testing, and more

## Support

- **GitHub Issues**: [https://github.com/solvapay/solvapay-sdk/issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Email**: contact@solvapay.com

---

**Ready to get started?** Check out the [Installation Guide](./getting-started/installation.md) or jump straight to the [Quick Start](./getting-started/quick-start.md)!
