# @solvapay/server

[![npm version](https://img.shields.io/npm/v/@solvapay/server.svg)](https://www.npmjs.com/package/@solvapay/server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Universal server SDK for Node.js and edge runtimes — API client, paywall protection, and webhook verification.

**When to use this package:** protect HTTP routes, Next.js handlers, background jobs, or low-level MCP tool handlers. For a full MCP server with transport tools and widget UI, prefer [`npm create solvapay@latest <name> -- --type mcp`](https://www.npmjs.com/package/create-solvapay) or [`@solvapay/mcp`](../mcp/README.md).

**Works in:** Node.js, Vercel Edge, Cloudflare Workers, Deno, Supabase Edge Functions, and more.

## Install

```bash
pnpm add @solvapay/server
```

## Quickstart

```typescript
import { createSolvaPay } from '@solvapay/server'

const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY })
const payable = solvaPay.payable({ product: 'prd_YOUR_PRODUCT' })

app.post(
  '/tasks',
  payable.http(async args => ({ id: 'task_1', ...args })),
)
```

Guide: [Express integration](https://docs.solvapay.com/sdks/typescript/guides/express)

### Basic client

The same imports work in Node and edge runtimes — the correct crypto implementation is selected automatically:

```typescript
import { createSolvaPayClient, verifyWebhook } from '@solvapay/server'

const apiClient = createSolvaPayClient({
  apiKey: process.env.SOLVAPAY_SECRET_KEY!,
})

const event = await verifyWebhook({ body, signature, secret: process.env.SOLVAPAY_WEBHOOK_SECRET! })
```

### Web-standards runtimes — `@solvapay/server/fetch` subpath

For Deno / Supabase Edge / Cloudflare Workers / Bun, use ready-made `(req: Request) => Promise<Response>` handlers:

```typescript
// supabase/functions/check-purchase/index.ts
import { checkPurchase } from '@solvapay/server/fetch'

Deno.serve(checkPurchase)
```

Available handlers include `checkPurchase`, `createPaymentIntent`, `processPayment`, `listPlans`, `syncCustomer`, `createCheckoutSession`, `createCustomerSession`, `solvapayWebhook`, and more.

Guide: [Supabase Edge](https://docs.solvapay.com/sdks/typescript/guides/supabase-edge) · Example: [`examples/supabase-edge`](../../examples/supabase-edge)

### Paywall adapters

```typescript
const payable = solvaPay.payable({ product: 'my-product' })

app.post('/tasks', payable.http(handler))           // Express / Fastify
export const POST = payable.next(handler)           // Next.js App Router
server.setRequestHandler(..., payable.mcp(handler)) // MCP (low-level)
const fn = await payable.function(handler)          // Direct / jobs / tests
```

| Adapter              | Use when                           |
| -------------------- | ---------------------------------- |
| `payable.http()`     | Express, Fastify, traditional HTTP |
| `payable.next()`     | Next.js App Router                 |
| `payable.mcp()`      | MCP tool handlers (low-level)      |
| `payable.function()` | Tests, cron, non-HTTP contexts     |

### Authentication

Integrate `@solvapay/auth` via `getCustomerRef`. Fail closed on missing auth — do not fall back to shared identities like `anonymous`:

```typescript
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase'

const auth = new SupabaseAuthAdapter({ jwtSecret: process.env.SUPABASE_JWT_SECRET! })

export const POST = payable.next(handler, {
  getCustomerRef: async req => {
    const userId = await auth.getUserIdFromRequest(req)
    if (!userId) throw new Error('Unauthorized')
    return userId
  },
})
```

### MCP servers

`@solvapay/server` is framework-free. For batteries-included MCP:

- **New apps:** [`npm create solvapay@latest <name> -- --type mcp`](https://www.npmjs.com/package/create-solvapay)
- **Official adapter:** [`@solvapay/mcp`](../mcp/README.md) — `createSolvaPayMcpServer`
- **Custom adapters:** [`@solvapay/mcp-core`](../mcp-core/README.md) — descriptors + OAuth JSON
- **OAuth middleware:** `@solvapay/mcp/express` (Node) or `@solvapay/mcp/fetch` (edge)

Guide: [MCP](https://docs.solvapay.com/sdks/typescript/guides/mcp)

## API client methods

`createSolvaPayClient` implements:

- `checkLimits(params)` — usage limits; auto-enrolls on first call for free default plans
- `trackUsage(params)` — metered billing; returns the recorded usage reference and any credit debit result
- `trackUsageBulk({ events })` — record several metered usage events in one request
- `assignCredits(params)` — grant credits to a customer balance with optional idempotency
- `createCustomer(params)` / `getCustomer(params)` — customer lifecycle

Full reference: [Server SDK docs](https://docs.solvapay.com/sdks/typescript/intro)

## Contributing

Type generation and integration-test details live in contributor docs — not duplicated here:

- [SDK testing guide](../../docs/contributing/testing.md)
- [Type generation](../../packages/server/src/types/README.md) — `pnpm --filter @solvapay/server generate:types`
- [Architecture](../../docs/contributing/architecture.md)

## See also

- [`@solvapay/mcp`](../mcp) — official MCP SDK adapter
- [`@solvapay/mcp-core`](../mcp-core) — framework-neutral MCP contracts
- [`@solvapay/auth`](../auth) — auth adapters
- [`@solvapay/next`](../next) — Next.js API route helpers
- [`create-solvapay`](../create-solvapay) — scaffold new MCP apps

## Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Security**: [Security Policy](https://github.com/solvapay/solvapay-sdk/blob/main/SECURITY.md)
- **Docs**: [docs.solvapay.com/sdks/typescript](https://docs.solvapay.com/sdks/typescript/intro)
