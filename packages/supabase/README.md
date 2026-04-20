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
| `syncCustomer`             | POST   | Sync/create customer in SolvaPay  |
| `createCheckoutSession`    | POST   | Create hosted checkout session    |
| `createCustomerSession`    | POST   | Create customer portal session    |

## Webhooks

Use the `solvapayWebhook` factory to verify and handle webhook events:

```typescript
// supabase/functions/solvapay-webhook/index.ts
import { solvapayWebhook } from '@solvapay/supabase'

Deno.serve(solvapayWebhook({
  secret: Deno.env.get('SOLVAPAY_WEBHOOK_SECRET')!,
  onEvent: async (event) => {
    if (event.type === 'purchase.created') {
      // handle new purchase
    }
  },
}))
```

The factory reads the raw body, verifies the `SV-Signature` header, and calls your `onEvent` handler with the parsed event. Returns 401 on invalid signatures.

Set the webhook secret alongside your API key:

```bash
supabase secrets set SOLVAPAY_WEBHOOK_SECRET=whsec_...
```

## Authentication model

Every handler extracts the authenticated user from the `Authorization: Bearer <jwt>` header that the Supabase platform gateway forwards. Supabase Edge Functions run with `verify_jwt = true` by default, so the token is cryptographically validated at the gateway before your function runs -- inside the function the SDK decodes the payload to read `sub`, `email`, and `user_metadata.full_name`.

If you want cryptographic verification inside the function as well (defence-in-depth, or to lock down a function where you've disabled gateway verification), set the Supabase JWT secret:

```bash
supabase secrets set SUPABASE_JWT_SECRET=<project jwt secret>
```

The SDK verifies HS256 tokens when this secret is present. Asymmetric JWT signing keys (ES256/RS256, Supabase Auth GA 2025) are covered by the gateway-trust path and do not require this secret.

To require verified tokens (reject the unverified-decode fallback), also set:

```bash
supabase secrets set SOLVAPAY_AUTH_STRICT=true
```

`SOLVAPAY_JWT_SECRET` works as a provider-neutral alias for `SUPABASE_JWT_SECRET`.

## CORS configuration

Default: `*` (permissive). Tighten for production:

```typescript
import { configureCors } from '@solvapay/supabase'

configureCors({
  origins: ['https://myapp.com', 'http://localhost:5173'],
})
```

Call `configureCors()` before any handler runs (e.g. at the top of each Edge Function or in a shared init module).
