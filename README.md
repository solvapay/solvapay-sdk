# SolvaPay SDK

A modern TypeScript SDK for SolvaPay with unified paywall protection, payment processing, and edge runtime support.

[![npm version](https://img.shields.io/npm/v/@solvapay/server.svg)](https://www.npmjs.com/package/@solvapay/server)
[![preview](https://img.shields.io/npm/v/@solvapay/server/preview?label=preview)](https://www.npmjs.com/package/@solvapay/server?activeTab=versions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## 📦 Packages

The SDK consists of **3 focused packages**:

- **`@solvapay/core`** - Types, schemas, and shared utilities
- **`@solvapay/server`** - Universal server SDK (Node + Edge runtime)
- **`@solvapay/react`** - Payment flow components

See [`docs/architecture.md`](./docs/architecture.md) for detailed package design and boundaries.

### Installation

```bash
# Server-side (paywall protection, webhooks)
npm install @solvapay/server

# Client-side (payment flows)
npm install @solvapay/react
```

## 🎯 Usage

### Server-Side: Paywall Protection

```typescript
import { createSolvaPay } from '@solvapay/server';

// Create SolvaPay instance
const solvaPay = createSolvaPay({ 
  apiKey: process.env.SOLVAPAY_SECRET_KEY 
});

// Create a payable with your agent
const payable = solvaPay.payable({ agent: 'my-api' });

// Protect endpoints with different adapters:
app.post('/tasks', payable.http(handler));        // Express/Fastify
export const POST = payable.next(handler);         // Next.js App Router
const mcpHandler = payable.mcp(handler);           // MCP servers
```

### Client-Side: Payment Flow

```tsx
import { SolvaPayProvider, PaymentForm } from '@solvapay/react';

function CheckoutPage() {
  return (
    <SolvaPayProvider 
      amount={999} 
      currency="USD" 
      planRef="pln_basic"
    >
      <PaymentForm
        returnUrl="/success"
        onSuccess={(paymentIntent) => {
          console.log('Payment successful!', paymentIntent);
        }}
      />
    </SolvaPayProvider>
  );
}
```

## 📚 Examples

The [`examples/`](./examples) directory contains working demonstrations:

- **[express-basic](./examples/express-basic)** - Paywall protection for CRUD APIs
- **[nextjs-openai-custom-gpt-actions](./examples/nextjs-openai-custom-gpt-actions)** - Payment flow with React components and OpenAI integration
- **[checkout-demo](./examples/checkout-demo)** - Full checkout with plan selection
- **[mcp-basic](./examples/mcp-basic)** - Model Context Protocol server

See [`examples/README.md`](./examples/README.md) for setup instructions.

## 🏗️ Architecture

This is a **monorepo** with 3 published packages built using Turborepo, tsup, and pnpm workspaces.

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

## 🔒 Security

- API keys are **never** exposed to the browser
- Payment flows initiated by backend API routes only
- Webhook signature verification included
- Automatic runtime detection prevents environment mismatches

## 📝 License

MIT

## 🤝 Support

- **Documentation**: [docs.solvapay.com](https://docs.solvapay.com)
- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Email**: support@solvapay.com
