# SolvaPay SDK Examples Overview

This document provides an overview of all available examples in the SolvaPay SDK repository. Each example demonstrates different integration patterns and use cases for the SolvaPay SDK.

## Table of Contents

- [Quick Comparison](#quick-comparison)
- [Available Examples](#available-examples)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Example Details](#example-details)
- [Best Practices](#best-practices)
- [Related Documentation](#related-documentation)

## Quick Comparison

| Example                                                                                                                         | Framework  | Checkout Type      | Auth             | Use Case            | Complexity        |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------ | ---------------- | ------------------- | ----------------- |
| [express-basic](https://github.com/solvapay/solvapay-sdk/tree/dev/examples/express-basic)                                       | Express.js | N/A (Paywall only) | Header-based     | API protection      | ⭐ Simple         |
| [checkout-demo](https://github.com/solvapay/solvapay-sdk/tree/dev/examples/checkout-demo)                                       | Next.js    | Embedded           | Supabase         | Full payment flow   | ⭐⭐⭐ Advanced   |
| [hosted-checkout-demo](https://github.com/solvapay/solvapay-sdk/tree/dev/examples/hosted-checkout-demo)                         | Next.js    | Hosted             | Supabase         | Hosted checkout     | ⭐⭐ Intermediate |
| [mcp-basic](https://github.com/solvapay/solvapay-sdk/tree/dev/examples/mcp-basic)                                               | MCP Server | N/A (Paywall only) | Header-based     | MCP tool protection | ⭐ Simple         |
| [nextjs-openai-custom-gpt-actions](https://github.com/solvapay/solvapay-sdk/tree/dev/examples/nextjs-openai-custom-gpt-actions) | Next.js    | Hosted             | Supabase + OAuth | OpenAI GPT Actions  | ⭐⭐⭐ Advanced   |

## Available Examples

### 1. Express Basic (`express-basic`)

**Purpose**: Demonstrates basic paywall protection for Express.js REST APIs.

**Key Features**:

- Express.js REST API with CRUD operations
- Paywall protection on all endpoints
- Stub client for local development (no backend required)
- Free tier limits (5 calls per day)
- Header-based customer identification

**Best For**:

- Learning basic paywall integration
- Simple API protection patterns
- Testing paywall behavior locally

**Documentation**: [express-basic README](https://github.com/solvapay/solvapay-sdk/tree/dev/examples/express-basic/README.md)

---

### 2. Checkout Demo (`checkout-demo`)

**Purpose**: Complete payment integration with embedded checkout form.

**Key Features**:

- Headless React components with render props
- Embedded Stripe payment form
- Content gating with subscription gates
- Supabase authentication
- Real-time subscription status checking
- Full payment flow implementation

**Best For**:

- Full payment integration
- Custom UI/UX requirements
- Embedded checkout flows
- Learning React component patterns

**Documentation**: [checkout-demo README](https://github.com/solvapay/solvapay-sdk/tree/dev/examples/checkout-demo/README.md)

---

### 3. Hosted Checkout Demo (`hosted-checkout-demo`)

**Purpose**: Payment integration using SolvaPay's hosted checkout pages.

**Key Features**:

- Hosted checkout (redirects to solvapay.com)
- Hosted customer portal
- Token-based access control
- Supabase authentication
- Lower PCI compliance burden
- Consistent checkout experience

**Best For**:

- Quick payment integration
- Minimal PCI compliance requirements
- Standard checkout experience
- Similar to Stripe Checkout pattern

**Documentation**: [hosted-checkout-demo README](https://github.com/solvapay/solvapay-sdk/tree/dev/examples/hosted-checkout-demo/README.md)

---

### 4. MCP Basic (`mcp-basic`)

**Purpose**: Demonstrates paywall protection for Model Context Protocol (MCP) servers.

**Key Features**:

- MCP server integration
- Tool protection with paywall
- Persistent free tier tracking
- Usage analytics
- File-based storage simulation

**Best For**:

- MCP server developers
- AI agent monetization
- Tool access control
- Usage-based pricing models

**Documentation**: [mcp-basic README](https://github.com/solvapay/solvapay-sdk/tree/dev/examples/mcp-basic/README.md)

---

### 5. Next.js OpenAI Custom GPT Actions (`nextjs-openai-custom-gpt-actions`)

**Purpose**: Complete integration for OpenAI Custom GPT Actions with OAuth and paywall.

**Key Features**:

- Next.js 15 with App Router
- OAuth 2.0 for OpenAI Custom GPT Actions
- Hosted checkout flow
- Supabase authentication
- OpenAPI documentation generation
- Comprehensive testing suite

**Best For**:

- OpenAI Custom GPT Actions integration
- OAuth 2.0 implementation
- Production-ready applications
- Complex authentication flows

**Documentation**: [nextjs-openai-custom-gpt-actions README](https://github.com/solvapay/solvapay-sdk/tree/dev/examples/nextjs-openai-custom-gpt-actions/README.md)

---

## Prerequisites

Before running any example, ensure you have:

1. **Node.js** (v18 or higher)
2. **pnpm** (package manager)
3. **SolvaPay Account** (for examples with real backend)
   - Sign up at https://solvapay.com
   - Get your API key from the dashboard
   - Create at least one agent and plan

4. **Supabase Account** (for examples with authentication)
   - Sign up at https://supabase.com
   - Create a new project
   - Get your project URL and API keys

5. **Build SDK Packages** (from workspace root):
   ```bash
   pnpm build:packages
   ```

## Getting Started

### 1. Clone and Install

```bash
# From workspace root
pnpm install
pnpm build:packages
```

### 2. Choose an Example

Select an example based on your needs:

- **New to SolvaPay?** → Start with `express-basic`
- **Need payment flow?** → Use `checkout-demo` or `hosted-checkout-demo`
- **Building MCP server?** → Use `mcp-basic`
- **OpenAI integration?** → Use `nextjs-openai-custom-gpt-actions`

### 3. Setup Environment

Each example has an `env.example` file. Copy it and fill in your credentials:

```bash
cd examples/[example-name]
cp env.example .env.local
# Edit .env.local with your credentials
```

### 4. Run the Example

```bash
pnpm dev
```

Follow the example-specific README for detailed instructions.

## Example Details

### Express Basic

**Location**: `examples/express-basic/`

**Run**:

```bash
cd examples/express-basic
pnpm install
pnpm dev
```

**Features Demonstrated**:

- Basic paywall protection
- HTTP adapter usage
- Stub client for local development
- Free tier limits

**No authentication required** - uses header-based customer identification.

---

### Checkout Demo

**Location**: `examples/checkout-demo/`

**Run**:

```bash
cd examples/checkout-demo
pnpm install
cp env.example .env.local
# Fill in SolvaPay and Supabase credentials
pnpm dev
```

**Features Demonstrated**:

- Embedded payment form
- React components (SolvaPayProvider, PaymentForm, SubscriptionGate)
- Supabase authentication
- Content gating

**Requires**: SolvaPay API key, Supabase credentials

---

### Hosted Checkout Demo

**Location**: `examples/hosted-checkout-demo/`

**Run**:

```bash
cd examples/hosted-checkout-demo
pnpm install
cp env.example .env.local
# Fill in SolvaPay and Supabase credentials
pnpm dev
```

**Features Demonstrated**:

- Hosted checkout flow
- Token generation
- Customer portal access
- Supabase authentication

**Requires**: SolvaPay API key, Supabase credentials

---

### MCP Basic

**Location**: `examples/mcp-basic/`

**Run**:

```bash
cd examples/mcp-basic
pnpm install
pnpm start
```

**Features Demonstrated**:

- MCP server integration
- MCP adapter usage
- Tool protection
- Usage tracking

**No authentication required** - uses header-based customer identification.

---

### Next.js OpenAI Custom GPT Actions

**Location**: `examples/nextjs-openai-custom-gpt-actions/`

**Run**:

```bash
cd examples/nextjs-openai-custom-gpt-actions
pnpm install
cp env.example .env.local
# Fill in all required credentials
pnpm build:deps
pnpm init:db  # Setup Supabase database
pnpm dev
```

**Features Demonstrated**:

- OAuth 2.0 flow
- OpenAI Custom GPT Actions integration
- OpenAPI documentation
- Comprehensive testing

**Requires**: SolvaPay API key, Supabase credentials, OAuth configuration

---

## Best Practices

### 1. Start Simple

Begin with `express-basic` or `mcp-basic` to understand core concepts before moving to more complex examples.

### 2. Use Stub Client for Development

All examples support stub client mode for local development without requiring a real backend:

```typescript
import { createStubClient } from '../../shared/stub-api-client'

const apiClient = createStubClient({
  freeTierLimit: 5,
  debug: true,
})
```

### 3. Environment Variables

- Never commit `.env.local` files
- Use `env.example` as a template
- Document all required variables in README

### 4. Error Handling

All examples demonstrate proper error handling patterns:

```typescript
try {
  const result = await payable.http(handler)(req, res)
} catch (error) {
  if (error instanceof PaywallError) {
    // Handle paywall error
  }
}
```

### 5. Testing

Examples include test suites demonstrating:

- Unit tests for business logic
- Integration tests for API routes
- Paywall behavior verification

### 6. Authentication Patterns

Examples show different authentication approaches:

- **Header-based**: Simple, for APIs
- **Supabase**: Full authentication with JWT
- **OAuth 2.0**: For third-party integrations

### 7. Checkout Patterns

Two checkout approaches are demonstrated:

- **Embedded**: Full control, more complex (`checkout-demo`)
- **Hosted**: Simpler, lower PCI burden (`hosted-checkout-demo`)

## Related Documentation

### Getting Started

- [Installation Guide](../getting-started/installation.md)
- [Quick Start Guide](../getting-started/quick-start.md)
- [Core Concepts](../getting-started/core-concepts.md)

### Framework Guides

- [Express.js Integration](../guides/express.md)
- [Next.js Integration](../guides/nextjs.md)
- [React Integration](../guides/react.md)
- [MCP Server Integration](../guides/mcp.md)

### Advanced Topics

- [Custom Authentication Adapters](../guides/custom-auth.md)
- [Error Handling](../guides/error-handling.md)
- [Testing with Stub Mode](../guides/testing.md)
- [Performance Optimization](../guides/performance.md)
- [Webhook Handling](../guides/webhooks.md)

### API Reference

- [Server SDK API Reference](../api/server/src/)
- [React SDK API Reference](../api/react/src/)
- [Next.js SDK API Reference](../api/next/src/)

## Troubleshooting

### Common Issues

1. **"Module not found" errors**
   - Run `pnpm build:packages` from workspace root
   - Ensure you're using workspace dependencies

2. **Environment variable errors**
   - Check `.env.local` exists and has all required variables
   - Restart dev server after adding variables

3. **Port already in use**
   - Examples auto-detect next available port
   - Or set `PORT` environment variable

4. **Authentication errors**
   - Verify Supabase credentials are correct
   - Check JWT secret matches Supabase project settings

5. **Payment errors**
   - Verify SolvaPay API key is valid
   - Check backend URL is correct
   - Review network tab for API errors

### Getting Help

- **Documentation**: Check example-specific README files
- **GitHub Issues**: https://github.com/solvapay/solvapay-sdk/issues
- **Email Support**: contact@solvapay.com

## Next Steps

After exploring examples:

1. **Read the guides**: Framework-specific integration guides
2. **Review API docs**: Understand all available methods
3. **Build your own**: Use examples as templates
4. **Join the community**: Share your implementations

---

**Last Updated**: 2024-12-19
