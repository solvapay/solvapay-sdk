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

### 1. Set your secrets

```bash
supabase secrets set SOLVAPAY_SECRET_KEY=sk_sandbox_...
supabase secrets set SOLVAPAY_WEBHOOK_SECRET=whsec_...
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

Deploy individually:

```bash
supabase functions deploy check-purchase
supabase functions deploy create-payment-intent
supabase functions deploy process-payment
supabase functions deploy create-topup-payment-intent
supabase functions deploy customer-balance
supabase functions deploy cancel-renewal
supabase functions deploy reactivate-renewal
supabase functions deploy activate-plan
supabase functions deploy list-plans
supabase functions deploy get-merchant
supabase functions deploy get-product
supabase functions deploy track-usage
supabase functions deploy sync-customer
supabase functions deploy create-checkout-session
supabase functions deploy create-customer-session
supabase functions deploy solvapay-webhook
```

Or deploy all at once:

```bash
supabase functions deploy
```

## Edge Functions

| Function                       | Method | Handler                    | Description                       |
| ------------------------------ | ------ | -------------------------- | --------------------------------- |
| `check-purchase`               | GET    | `checkPurchase`            | Check user's purchase status      |
| `create-payment-intent`        | POST   | `createPaymentIntent`      | Create payment intent for a plan  |
| `process-payment`              | POST   | `processPayment`           | Process confirmed payment         |
| `create-topup-payment-intent`  | POST   | `createTopupPaymentIntent` | Create credit top-up intent       |
| `customer-balance`             | GET    | `customerBalance`          | Get customer credit balance       |
| `cancel-renewal`               | POST   | `cancelRenewal`            | Cancel subscription renewal       |
| `reactivate-renewal`           | POST   | `reactivateRenewal`        | Reactivate cancelled subscription |
| `activate-plan`                | POST   | `activatePlan`             | Activate a free/usage plan        |
| `list-plans`                   | GET    | `listPlans`                | List available plans              |
| `get-merchant`                 | GET    | `getMerchant`              | Fetch the authenticated merchant's public metadata (name, branding, currency). |
| `get-product`                  | GET    | `getProduct`               | Fetch a product by reference (name, description). |
| `track-usage`                  | POST   | `trackUsage`               | Track usage for metered billing   |
| `sync-customer`                | POST   | `syncCustomer`             | Sync/create customer in SolvaPay  |
| `create-checkout-session`      | POST   | `createCheckoutSession`    | Create hosted checkout session    |
| `create-customer-session`      | POST   | `createCustomerSession`    | Create customer portal session    |
| `solvapay-webhook`             | POST   | `solvapayWebhook(options)` | Receive and verify webhook events |

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
  config={{
    auth: {
      adapter: createSupabaseAuthAdapter(supabase),
    },
    api: {
      checkPurchase: `${SUPABASE_URL}/check-purchase`,
      createPayment: `${SUPABASE_URL}/create-payment-intent`,
      processPayment: `${SUPABASE_URL}/process-payment`,
      createTopupPayment: `${SUPABASE_URL}/create-topup-payment-intent`,
      customerBalance: `${SUPABASE_URL}/customer-balance`,
      cancelRenewal: `${SUPABASE_URL}/cancel-renewal`,
      reactivateRenewal: `${SUPABASE_URL}/reactivate-renewal`,
      activatePlan: `${SUPABASE_URL}/activate-plan`,
      listPlans: `${SUPABASE_URL}/list-plans`,
    },
  }}
>
  {children}
</SolvaPayProvider>
```

The `sync-customer`, `create-checkout-session`, `create-customer-session`, and `solvapay-webhook` functions are called server-side (not through the React provider) and should be invoked directly from your application code.

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
├── check-purchase/index.ts
├── create-payment-intent/index.ts
├── process-payment/index.ts
├── create-topup-payment-intent/index.ts
├── customer-balance/index.ts
├── cancel-renewal/index.ts
├── reactivate-renewal/index.ts
├── activate-plan/index.ts
├── list-plans/index.ts
├── get-merchant/index.ts
├── get-product/index.ts
├── track-usage/index.ts
├── sync-customer/index.ts
├── create-checkout-session/index.ts
├── create-customer-session/index.ts
└── solvapay-webhook/index.ts
```

Total backend code: ~40 lines across 14 files.
