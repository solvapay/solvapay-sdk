# @solvapay/supabase

SolvaPay adapter for Supabase Edge Functions. Reduces each Edge Function to a one-liner.

## Install

```bash
npm install @solvapay/supabase @solvapay/server @solvapay/auth
```

## Quick start

Create a `deno.json` import map at your `supabase/functions/` root:

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

Set your secret key:

```bash
supabase secrets set SOLVAPAY_SECRET_KEY=sk_sandbox_...
```

Create Edge Functions -- each is a single file:

```typescript
// supabase/functions/check-purchase/index.ts
import { checkPurchase } from '@solvapay/supabase'

Deno.serve(checkPurchase)
```

```typescript
// supabase/functions/create-payment-intent/index.ts
import { createPaymentIntent } from '@solvapay/supabase'

Deno.serve(createPaymentIntent)
```

## Available handlers

| Handler                    | Method | Description                       |
| -------------------------- | ------ | --------------------------------- |
| `checkPurchase`            | GET    | Check user's purchase status      |
| `createPaymentIntent`      | POST   | Create payment intent for a plan  |
| `processPayment`           | POST   | Process confirmed payment         |
| `createTopupPaymentIntent` | POST   | Create credit top-up intent       |
| `customerBalance`          | GET    | Get customer credit balance       |
| `cancelRenewal`            | POST   | Cancel subscription renewal       |
| `reactivateRenewal`        | POST   | Reactivate cancelled subscription |
| `activatePlan`             | POST   | Activate a free/usage plan        |
| `listPlans`                | GET    | List available plans              |
| `trackUsage`               | POST   | Track usage for metered billing   |

## CORS configuration

Default: `*` (permissive). Tighten for production:

```typescript
import { configureCors } from '@solvapay/supabase'

configureCors({
  origins: ['https://myapp.com', 'http://localhost:5173'],
})
```

Call `configureCors()` before any handler runs (e.g. at the top of each Edge Function or in a shared init module).
