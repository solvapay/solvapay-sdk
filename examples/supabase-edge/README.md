# Supabase Edge Functions Example

Reference project showing how to use `@solvapay/supabase` to wire up SolvaPay endpoints as Supabase Edge Functions. Each function is a one-liner.

## Why this adapter?

Compare the same endpoint implemented two ways:

**Next.js API route** (checkout-demo):

```typescript
// app/api/check-purchase/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { checkPurchase } from '@solvapay/next'

export async function GET(request: NextRequest) {
  const result = await checkPurchase(request)
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
```

**Supabase Edge Function** (this example):

```typescript
// supabase/functions/check-purchase/index.ts
import { checkPurchase } from '@solvapay/supabase'

Deno.serve(checkPurchase)
```

The adapter handles CORS, JSON serialization, and error formatting internally.

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- A SolvaPay account with a secret key

## Setup

### 1. Set your secret key

```bash
supabase secrets set SOLVAPAY_SECRET_KEY=sk_sandbox_...
```

### 2. Import map

The `supabase/functions/deno.json` maps npm packages for Deno:

```json
{
  "imports": {
    "@solvapay/supabase": "npm:@solvapay/supabase",
    "@solvapay/server": "npm:@solvapay/server",
    "@solvapay/auth": "npm:@solvapay/auth",
    "@solvapay/core": "npm:@solvapay/core"
  }
}
```

### 3. Deploy

```bash
supabase functions deploy check-purchase
supabase functions deploy create-payment-intent
supabase functions deploy process-payment
# ... deploy each function
```

Or deploy all at once:

```bash
supabase functions deploy
```

## Edge Functions

| Function                       | Method | Handler                  | Description                       |
| ------------------------------ | ------ | ------------------------ | --------------------------------- |
| `check-purchase`               | GET    | `checkPurchase`          | Check user's purchase status      |
| `create-payment-intent`        | POST   | `createPaymentIntent`    | Create payment intent for a plan  |
| `process-payment`              | POST   | `processPayment`         | Process confirmed payment         |
| `create-topup-payment-intent`  | POST   | `createTopupPaymentIntent` | Create credit top-up intent     |
| `customer-balance`             | GET    | `customerBalance`        | Get customer credit balance       |
| `cancel-renewal`               | POST   | `cancelRenewal`          | Cancel subscription renewal       |
| `reactivate-renewal`           | POST   | `reactivateRenewal`      | Reactivate cancelled subscription |
| `activate-plan`                | POST   | `activatePlan`           | Activate a free/usage plan        |
| `list-plans`                   | GET    | `listPlans`              | List available plans              |
| `track-usage`                  | POST   | `trackUsage`             | Track usage for metered billing   |

## CORS configuration

Default: `*` (permissive, suitable for development). For production, configure allowed origins:

```typescript
// supabase/functions/check-purchase/index.ts
import { checkPurchase, configureCors } from '@solvapay/supabase'

configureCors({
  origins: ['https://myapp.com', 'http://localhost:5173'],
})

Deno.serve(checkPurchase)
```

## Frontend configuration

Point your React app's `SolvaPayProvider` at the Edge Function URLs:

```tsx
import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'

const SUPABASE_URL = 'https://<project-ref>.supabase.co/functions/v1'

<SolvaPayProvider
  authAdapter={createSupabaseAuthAdapter(supabase)}
  apiRoutes={{
    checkPurchase: `${SUPABASE_URL}/check-purchase`,
    createPaymentIntent: `${SUPABASE_URL}/create-payment-intent`,
    processPayment: `${SUPABASE_URL}/process-payment`,
    listPlans: `${SUPABASE_URL}/list-plans`,
    syncCustomer: `${SUPABASE_URL}/sync-customer`,
    activatePlan: `${SUPABASE_URL}/activate-plan`,
    trackUsage: `${SUPABASE_URL}/track-usage`,
    customerBalance: `${SUPABASE_URL}/customer-balance`,
  }}
>
  {children}
</SolvaPayProvider>
```

## Local testing

```bash
supabase start
supabase functions serve
```

Functions are available at `http://localhost:54321/functions/v1/<function-name>`.

## Project structure

```
supabase/functions/
├── deno.json                          # npm import map
├── check-purchase/index.ts            # 2 lines
├── create-payment-intent/index.ts     # 2 lines
├── process-payment/index.ts           # 2 lines
├── create-topup-payment-intent/index.ts
├── customer-balance/index.ts
├── cancel-renewal/index.ts
├── reactivate-renewal/index.ts
├── activate-plan/index.ts
├── list-plans/index.ts
└── track-usage/index.ts
```

Total backend code: ~30 lines across 10 files.
