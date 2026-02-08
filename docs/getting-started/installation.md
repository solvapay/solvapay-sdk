# Installation

This guide covers installing and setting up SolvaPay SDK packages in your project.

## Prerequisites

- **Node.js**: Version 18.0.0 or higher
- **Package Manager**: npm, yarn, or pnpm
- **TypeScript**: Version 5.0.0 or higher (recommended)

## Package Installation

SolvaPay SDK consists of 6 published packages. Install only the packages you need for your use case.

### Server-Side Protection

For protecting API endpoints, functions, or MCP servers:

```bash
npm install @solvapay/server
# or
yarn add @solvapay/server
# or
pnpm add @solvapay/server
```

### React Components

For client-side payment flows and purchase management:

```bash
npm install @solvapay/react
# or
yarn add @solvapay/react
# or
pnpm add @solvapay/react
```

### Next.js Integration

For Next.js-specific helpers and optimizations:

```bash
npm install @solvapay/next
# or
yarn add @solvapay/next
# or
pnpm add @solvapay/next
```

### Authentication Adapters

For extracting user IDs from requests:

```bash
npm install @solvapay/auth
# or
yarn add @solvapay/auth
# or
pnpm add @solvapay/auth
```

### Supabase Integration

For Supabase authentication with React:

```bash
npm install @solvapay/react-supabase @supabase/supabase-js
# or
yarn add @solvapay/react-supabase @supabase/supabase-js
# or
pnpm add @solvapay/react-supabase @supabase/supabase-js
```

### Core Types (Optional)

If you only need types and schemas:

```bash
npm install @solvapay/core
# or
yarn add @solvapay/core
# or
pnpm add @solvapay/core
```

## Environment Setup

### Required Environment Variables

For production use, you'll need a SolvaPay API key:

```bash
# .env (server-side only, never expose to browser)
SOLVAPAY_SECRET_KEY=sk_live_...
```

### Optional Environment Variables

```bash
# Custom API base URL (for testing or self-hosted)
SOLVAPAY_API_BASE_URL=https://api.solvapay.com
```

### Stub Mode (Testing Without API Key)

SolvaPay SDK works in **stub mode** when no API key is provided. This is perfect for:

- Local development
- Testing
- CI/CD pipelines
- Prototyping

In stub mode:

- All purchase checks return "free tier" (no purchase)
- Payment flows are simulated
- No actual API calls are made

To use stub mode, simply don't set `SOLVAPAY_SECRET_KEY`:

```typescript
import { createSolvaPay } from '@solvapay/server'

// Works without API key (stub mode)
const solvaPay = createSolvaPay()
```

## Verification Steps

### 1. Verify Installation

Create a test file to verify the installation:

```typescript
// test-installation.ts
import { createSolvaPay } from '@solvapay/server'

const solvaPay = createSolvaPay()
console.log('✅ SolvaPay SDK installed successfully!')
```

Run it:

```bash
npx tsx test-installation.ts
```

### 2. Verify TypeScript Types

If using TypeScript, verify types are available:

```typescript
import type { SolvaPay, PayableFunction } from '@solvapay/server'

const solvaPay: SolvaPay = createSolvaPay()
// Type checking should work without errors
```

### 3. Test Stub Mode

Test that stub mode works without an API key:

```typescript
import { createSolvaPay } from '@solvapay/server'

const solvaPay = createSolvaPay() // No API key needed

const payable = solvaPay.payable({
  agent: 'agt_test',
  plan: 'pln_test',
})

// This should work in stub mode
const handler = payable.http(async () => {
  return { message: 'Hello from stub mode!' }
})
```

## Framework-Specific Setup

### Express.js

```bash
npm install @solvapay/server express
```

See [Express.js Integration Guide](../guides/express.md) for detailed setup.

### Next.js

```bash
npm install @solvapay/server @solvapay/next @solvapay/react
```

See [Next.js Integration Guide](../guides/nextjs.md) for detailed setup.

### React (Standalone)

```bash
npm install @solvapay/react
```

See [React Integration Guide](../guides/react.md) for detailed setup.

### MCP Server

```bash
npm install @solvapay/server
```

See [MCP Server Integration Guide](../guides/mcp.md) for detailed setup.

## Next Steps

- [Quick Start Guide](./quick-start.md) - Get up and running in 5 minutes
- [Core Concepts](./core-concepts.md) - Understand the key concepts
- [Framework Guides](../guides/express.md) - Framework-specific integration guides
