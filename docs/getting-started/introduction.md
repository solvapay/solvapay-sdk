# Introduction

## What is SolvaPay SDK?

SolvaPay SDK is a modern TypeScript SDK for monetizing APIs, AI agents, and MCP (Model Context Protocol) servers with paywall protection and subscription management. It provides a unified API that works across multiple frameworks and runtimes.

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

- [Installation Guide](./installation.md) - Set up SolvaPay SDK in your project
- [Quick Start](./quick-start.md) - Get up and running in 5 minutes
- [Core Concepts](./core-concepts.md) - Understand agents, plans, and the paywall flow
- [Architecture Guide](../guides/architecture.md) - Detailed technical architecture and package design
