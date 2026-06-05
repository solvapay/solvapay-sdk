# @solvapay/next

[![npm version](https://img.shields.io/npm/v/@solvapay/next.svg)](https://www.npmjs.com/package/@solvapay/next)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Next.js API route helpers for SolvaPay — purchase checks, payments, checkout sessions, and customer portal.

**When to use this package:** you run Next.js App Router API routes and want typed helpers with request deduplication and caching. For Express or other frameworks, use `@solvapay/server` directly.

## Install

```bash
pnpm add @solvapay/next @solvapay/server next
```

Guide: [Next.js integration](https://docs.solvapay.com/sdks/typescript/guides/nextjs)

## Quickstart

All helpers return either a success result or a `NextResponse` error:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { checkPurchase, createPaymentIntent } from '@solvapay/next'

export async function GET(request: NextRequest) {
  const result = await checkPurchase(request)
  return result instanceof NextResponse ? result : NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  const { planRef, productRef } = await request.json()
  const result = await createPaymentIntent(request, { planRef, productRef })
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
```

Example app: [`examples/checkout-demo`](../../examples/checkout-demo)

## Helper reference

| Helper | Purpose |
| --- | --- |
| `checkPurchase` | Purchase status (deduped + cached) |
| `syncCustomer` | Ensure customer exists |
| `createPaymentIntent` / `processPayment` | Embedded checkout |
| `createCheckoutSession` | Hosted redirect checkout |
| `createCustomerSession` | Customer portal |
| `listPlans` | Public plan listing |
| `cancelRenewal` / `reactivateRenewal` / `activatePlan` | Plan lifecycle |
| `trackUsage` | Server-side usage metering |
| `getAuthenticatedUser` | User ID, email, name from headers |
| `clearPurchaseCache` / `getPurchaseCacheStats` | Cache management |

Full signatures and options: [Next.js guide](https://docs.solvapay.com/sdks/typescript/guides/nextjs)

## Middleware

Helpers expect `x-user-id` from middleware. Quick setup with Supabase:

```typescript
// middleware.ts (Next.js 15) or src/proxy.ts (Next.js 16)
import { createSupabaseAuthMiddleware } from '@solvapay/next'

export const middleware = createSupabaseAuthMiddleware({
  publicRoutes: ['/api/list-plans'],
})

export const config = { matcher: ['/api/:path*'] }
```

Next.js 16 renamed middleware to proxy — use `@solvapay/next/middleware` and export `proxy` instead of `middleware` when required.

## Requirements

- Next.js >= 13.0.0
- Node.js >= 18.17

## See also

- [`@solvapay/server`](../server) — framework-agnostic paywall
- [`@solvapay/react`](../react) — checkout UI
- [`@solvapay/auth`](../auth) — auth adapters and `requireUserId`

## Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Docs**: [docs.solvapay.com/sdks/typescript/guides/nextjs](https://docs.solvapay.com/sdks/typescript/guides/nextjs)
