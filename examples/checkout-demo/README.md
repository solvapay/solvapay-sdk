# SolvaPay Checkout Demo

A complete, drop-in checkout example built entirely around the SDK's
`<CheckoutLayout>` component. The whole checkout page is ~50 lines — plan
selection, payment, usage-based activation, and cancel/reactivate are all
owned by the SDK.

## Golden path (90% of integrations)

The entire checkout surface is a single component call:

```tsx
<CheckoutLayout
  productRef="prd_myapi"
  prefillCustomer={{ email, name }}
  initialPlanRef={activePurchase?.planRef}
  requireTermsAcceptance
  onResult={result => {
    // result.kind === 'paid' | 'activated' — navigate away, show success, etc.
  }}
/>
```

`<CheckoutLayout>` internally:

- Fetches plans for `productRef` via `/api/list-plans`
- Renders `<PlanSelector>` if there's more than one plan (auto-skipped for single-plan products)
- Routes paid/free plans to `<PaymentForm>`
- Routes usage-based plans to `<ActivationFlow>` (summary → top-up → retry → activated)
- Fires `onResult` with a discriminated `CheckoutResult` on success

Pair it with `<CancelledPlanNotice>` (auto-shows when there's a cancelled
active purchase) and `<CancelPlanButton>` (confirm dialog + plan-type-aware
copy) for the full lifecycle — see [`app/checkout/page.tsx`](app/checkout/page.tsx).

## Custom composition

Need full layout control? Compose the SDK primitives directly:

- `<PlanSelector>` — styled plan grid with selection state + `PlanSelectionContext`
- `<PaymentForm>` — Stripe Elements with slot subcomponents (`.Summary`, `.CustomerFields`, `.PaymentElement`, `.MandateText`, `.TermsCheckbox`, `.SubmitButton`)
- `<ActivationFlow>` — styled usage-based activation state machine
- `<AmountPicker>` — quick-amount pills + custom input + credit estimate

Same behavior, you own the surrounding layout. See the [SDK README](../../packages/react/README.md#custom-composition-pick-the-primitives-you-need) for slot examples.

## Custom activation UI

When you need to completely replace the default `<ActivationFlow>` — for
example to show a bespoke credit-purchase flow or integrate with an external
payment method — compose `@solvapay/react/primitives` directly instead of
using `<CheckoutLayout>`. The built-in `<ActivationFlow>` covers the full
summary → top-up → retry → activated state machine for the common case.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running the Demo](#running-the-demo)
- [Demo Flow](#demo-flow)
- [Testing Payments](#testing-payments)
- [How It Works](#how-it-works)
- [Project Structure](#project-structure)
- [Key Concepts](#key-concepts)
- [Environment Variables](#environment-variables)
- [Customization](#customization)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [Related Documentation](#related-documentation)

## Features

- **Headless Components**: Fully flexible, unstyled components with render props
- **Content Gating**: Lock premium features behind purchases
- **Secure Payments**: Stripe-powered payment processing
- **Purchase Management**: Real-time purchase status checking
- **Authentication**: Email/password and Google OAuth sign-in with Supabase
- **Style Agnostic**: Works with any CSS framework or design system
- **Test Mode**: Complete test environment with localStorage persistence

## New Headless Architecture

This demo showcases the modern headless component approach:

### Core Components

1. **`<SolvaPayProvider>`** - Context provider with purchase state
2. **`<PurchaseGate>`** - Conditional rendering based on purchase
3. **`<UpgradeButton>`** - Complete upgrade flow with inline payment
4. **`<PlanBadge>`** - Display current purchase status
5. **`usePurchase`** - Hook for purchase state access
6. **`useCheckout`** - Hook for checkout flow management

## Prerequisites

Before running this demo, you need:

1. **SolvaPay Account**
   - Sign up at https://solvapay.com
   - Get your secret API key from the dashboard
   - Create at least one product and plan

2. **Supabase Account** (for authentication)
   - Sign up at https://supabase.com
   - Create a new project
   - Get your project URL and anon key from Settings → API
   - Get your JWT secret from Settings → API → JWT Secret
   - **Enable Google OAuth** (optional):
     - First, create OAuth credentials in Google Cloud Console (see detailed steps below)
     - Then in Supabase: Authentication → Providers → Google
     - Enable the provider and paste your Google OAuth Client ID and Client Secret
     - **Important**: Client IDs field should contain only the Client ID (no spaces, like "123456789-abc.apps.googleusercontent.com")
     - Copy the Callback URL shown (e.g., `https://ganvogeprtezdpakybib.supabase.co/auth/v1/callback`)
     - Add this Callback URL to Google Cloud Console as an authorized redirect URI
     - Add your app's callback URL (`http://localhost:3000/auth/callback`) to Supabase Redirect URLs

3. **Environment Variables**
   - Run `npx solvapay init` in `examples/checkout-demo/` to create a gitignored `.env`, **or**
   - Create `.env.local` manually (see [Environment Variables](#environment-variables) below)

## Setup

```bash
# From the SDK monorepo root — lockfile must stay in sync (CI uses --frozen-lockfile)
pnpm install

cd examples/checkout-demo

# Recommended: CLI scaffolds .env with SOLVAPAY_SECRET_KEY + product ref
npx solvapay init

# Or create .env.local manually with:
#   SOLVAPAY_SECRET_KEY, SUPABASE_JWT_SECRET,
#   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
# Optional: SOLVAPAY_API_BASE_URL, NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF (or SOLVAPAY_PRODUCT_REF)
```

## Running the Demo

```bash
# Development mode
pnpm dev

# Production build
pnpm build
pnpm start
```

Open [http://localhost:3010](http://localhost:3010) in your browser.

## Deploy to Cloudflare Workers (DEV-441)

This demo deploys to [https://web-app-demo.solvapay.app](https://web-app-demo.solvapay.app) via
[@opennextjs/cloudflare](https://opennext.js.org/cloudflare) + Wrangler. Deploy ergonomics mirror
`examples/chat-checkout-demo` (`scripts/deploy.mjs`, gitignored env files, one-time Worker secrets).

### Two value paths (read this first)

Understanding where each config value lives is required for a reproducible deploy:

| When               | Where                     | Variables                                            | How they reach the Worker                                                                                         |
| ------------------ | ------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Build time**     | Gitignored `.env.prod`    | `NEXT_PUBLIC_*` (product ref, Supabase URL/anon key) | Loaded by `pnpm build:opennext:prod` (`dotenv -e .env.prod`) and **baked into the client bundle**                 |
| **Deploy time**    | Gitignored `.env.prod`    | `SOLVAPAY_API_BASE_URL` (optional)                   | Forwarded by `scripts/deploy.mjs` as `wrangler deploy --var`                                                      |
| **Runtime (once)** | Cloudflare Worker secrets | `SOLVAPAY_SECRET_KEY`, `SUPABASE_JWT_SECRET`         | `wrangler secret put` — **not** in `.env.prod`; persists across deploys; `deploy.mjs` does **not** re-upload them |

If you skip `wrangler secret put`, the Worker deploys successfully but every `/api/*` request fails at
runtime with Cloudflare `error code: 1101`. If you skip `NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF` in
`.env.prod` before `build:opennext:prod`, `/checkout` loads but cannot fetch plans.

**API base URL must match the secret key** that issued it:

| Key source                                                          | Set `SOLVAPAY_API_BASE_URL` to           |
| ------------------------------------------------------------------- | ---------------------------------------- |
| Keys from `solvapay init` / app.solvapay.com (incl. `sk_sandbox_*`) | `https://api.solvapay.com`               |
| Keys from a dev/staging backend                                     | `https://api-dev.solvapay.com`           |
| Local backend                                                       | `http://localhost:3001` (local dev only) |

After changing `.env.prod`, redeploy with `pnpm run deploy:cf:prod`.

### Differences from chat-checkout-demo

| Topic          | chat-checkout-demo                      | checkout-demo                                    |
| -------------- | --------------------------------------- | ------------------------------------------------ |
| Runtime        | Vite + `worker.ts` + `handlers.ts`      | Next.js 16 + OpenNext                            |
| Auth           | Anonymous `x-customer-ref`              | Supabase JWT + `proxy.ts`                        |
| Secrets        | `SOLVAPAY_SECRET_KEY`, `GEMINI_API_KEY` | `SOLVAPAY_SECRET_KEY`, `SUPABASE_JWT_SECRET`     |
| Build-time env | `VITE_*`                                | `NEXT_PUBLIC_*`                                  |
| Prod domain    | `chat-demo.solvapay.app`                | `web-app-demo.solvapay.app`                      |
| Prod Worker    | `solvapay-chat-checkout-demo-prod`      | `solvapay-checkout-demo-prod`                    |
| Deploy scripts | `pnpm deploy` / `pnpm deploy:prod`      | `pnpm run deploy:cf` / `pnpm run deploy:cf:prod` |

Uses Supabase project [ganvogeprtezdpakybib](https://supabase.com/dashboard/project/ganvogeprtezdpakybib)
(`https://ganvogeprtezdpakybib.supabase.co`) — not SolvaPay internal dev auth.

### Prerequisites (prod deploy checklist)

Before deploying to `web-app-demo.solvapay.app`, confirm all of the following:

1. **Repo** — clone `solvapay-sdk` and check out the branch with checkout-demo Cloudflare support.
2. **Install** — from the **monorepo root**, run `pnpm install` (CI uses `pnpm install --frozen-lockfile`; commit any `pnpm-lock.yaml` changes when `examples/checkout-demo/package.json` changes).
3. **Wrangler** — `pnpm exec wrangler login` (or set `CLOUDFLARE_API_TOKEN`).
4. **Cloudflare account** — `pnpm exec wrangler whoami` must list account `98aefe33182e11a1b0e5d7fa89a12a6d` (SolvaPay org), not only a personal account.
5. **SolvaPay** — a secret key and product ref for the merchant you want the demo to use (`npx solvapay init` in `examples/checkout-demo/` writes these to gitignored `.env`).
6. **Supabase** — JWT secret plus anon URL/key for project `ganvogeprtezdpakybib` (see [Supabase prod redirect](#supabase-prod-redirect-required-before-oauth-on-prod) below).

### Supabase prod redirect (required before OAuth on prod)

In **Authentication → URL configuration** for `ganvogeprtezdpakybib`:

- **Redirect URLs:** `https://web-app-demo.solvapay.app/auth/callback` (keep `http://localhost:3010/auth/callback` for local dev)
- **Site URL:** `https://web-app-demo.solvapay.app` (recommended)

Google Cloud Console still uses `https://ganvogeprtezdpakybib.supabase.co/auth/v1/callback` only.

### Local Cloudflare preview

```bash
# From SDK root
pnpm install && pnpm -w build:packages

cd examples/checkout-demo

# Local secrets — either .env.local (Next dev) or .dev.vars (wrangler dev)
npx solvapay init   # creates .env, or copy values manually into .env.local
cp .dev.vars.example .dev.vars
# Fill SOLVAPAY_SECRET_KEY and SUPABASE_JWT_SECRET in .dev.vars

pnpm build:opennext
pnpm serve:local   # wrangler dev
```

`wrangler dev` reads `.dev.vars` for Worker runtime secrets; Next.js dev (`pnpm dev`) reads `.env.local` / `.env`.

### Deploy to `*.workers.dev` (non-prod Worker)

Uses the top-level Worker `solvapay-checkout-demo` (no `--env production`).

**1. Secrets (one-time per Worker — separate from prod):**

```bash
cd examples/checkout-demo

pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY
pnpm exec wrangler secret put SUPABASE_JWT_SECRET

# Or pipe from .env:
grep '^SOLVAPAY_SECRET_KEY=' .env | cut -d= -f2- | pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY
grep '^SUPABASE_JWT_SECRET=' .env | cut -d= -f2- | pnpm exec wrangler secret put SUPABASE_JWT_SECRET

pnpm exec wrangler secret list   # should list both secrets
```

**2. Deploy:**

```bash
pnpm run deploy:cf   # pnpm -w build:packages && pnpm build:opennext && node scripts/deploy.mjs
```

### Deploy the live demo (`web-app-demo.solvapay.app`) — full walkthrough

Production uses Worker **`solvapay-checkout-demo-prod`** in `[env.production]` of
[`wrangler.jsonc`](wrangler.jsonc), Cloudflare account **`98aefe33182e11a1b0e5d7fa89a12a6d`**, route
**`web-app-demo.solvapay.app`**.

> **pnpm script names:** use `pnpm run deploy:cf` and `pnpm run deploy:cf:prod`. Plain `pnpm deploy`
> is reserved by pnpm itself.

> **Prod secrets are scoped to the prod Worker.** Uploading secrets without `--env production` only
> covers the `*.workers.dev` Worker. Prod always needs `--env production`.

#### Step 0 — Install and build packages

```bash
# From solvapay-sdk root
pnpm install
pnpm -w build:packages
```

#### Step 1 — Prod Worker secrets (one-time)

```bash
cd examples/checkout-demo

# Interactive:
pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY --env production
pnpm exec wrangler secret put SUPABASE_JWT_SECRET --env production

# Or pipe from local .env (use printf to avoid trailing-newline corruption on keys with + or =):
grep '^SOLVAPAY_SECRET_KEY=' .env | cut -d= -f2- | pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY --env production
grep '^SUPABASE_JWT_SECRET=' .env | cut -d= -f2- | pnpm exec wrangler secret put SUPABASE_JWT_SECRET --env production

pnpm exec wrangler secret list --env production
# Expected: SOLVAPAY_SECRET_KEY, SUPABASE_JWT_SECRET
```

To **rotate** a secret later, run the same `wrangler secret put` command again — no rebuild required
unless you also change build-time vars.

#### Step 2 — Prod build env (`.env.prod`)

```bash
cp .env.prod.example .env.prod
```

Edit `.env.prod` (gitignored). Minimum required fields:

```bash
# Baked into the client bundle at build time (pnpm build:opennext:prod)
NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF=prd_your_product_ref   # must match merchant for SOLVAPAY_SECRET_KEY
NEXT_PUBLIC_SUPABASE_URL=https://ganvogeprtezdpakybib.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Deploy-time Worker var (must match the API that issued SOLVAPAY_SECRET_KEY)
SOLVAPAY_API_BASE_URL=https://api.solvapay.com
```

`next.config.mjs` also accepts `SOLVAPAY_PRODUCT_REF` or `NEXT_PUBLIC_PRODUCT_REF` at build time, but
`.env.prod.example` standardizes on `NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF`.

**Do not** put `SOLVAPAY_SECRET_KEY` or `SUPABASE_JWT_SECRET` in `.env.prod` — those are Worker secrets
(step 1).

#### Step 3 — Build and deploy

```bash
pnpm run deploy:cf:prod
```

This runs, in order:

1. `pnpm -w build:packages` — rebuild SDK workspace packages
2. `pnpm build:opennext:prod` — OpenNext production build with `.env.prod` (bakes `NEXT_PUBLIC_*`)
3. `node scripts/deploy.mjs --prod` — `wrangler deploy --env production` (+ `--var SOLVAPAY_API_BASE_URL` from `.env.prod`)

#### Step 4 — Verify

```bash
# Public API (no auth) — should return 200 with plans JSON
curl -sS -o /dev/null -w "%{http_code}\n" \
  "https://web-app-demo.solvapay.app/api/list-plans?productRef=YOUR_PRODUCT_REF"

# Browser
open https://web-app-demo.solvapay.app/checkout
```

Expected: HTTP 200 on list-plans; checkout shows plan selection after sign-in (not "Missing
NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF" or Cloudflare 1101).

#### Step 5 — Supabase OAuth (if testing sign-in on prod)

Complete [Supabase prod redirect](#supabase-prod-redirect-required-before-oauth-on-prod) before Google
or email OAuth on `web-app-demo.solvapay.app`.

### Troubleshooting

| Symptom                                              | Fix                                                                                                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI: `ERR_PNPM_OUTDATED_LOCKFILE` for `checkout-demo` | From repo root: `pnpm install`, commit updated `pnpm-lock.yaml`                                                                                       |
| CF `error code: 1101` on `/api/*`                    | Missing secrets — `wrangler secret list --env production`; re-run step 1                                                                              |
| `Product not found: prd_…`                           | `NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF` in `.env.prod` must match the merchant for `SOLVAPAY_SECRET_KEY`                                                   |
| `/checkout` shows "This page couldn't load"          | Missing product ref at build time — set `NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF` in `.env.prod` and redeploy `pnpm run deploy:cf:prod`                      |
| `Failed to fetch plans: 401` on `/checkout`          | `SOLVAPAY_API_BASE_URL` must match the Worker secret's API — see [Two value paths](#two-value-paths-read-this-first). Update `.env.prod` and redeploy |
| OAuth redirect error on prod                         | Add `https://web-app-demo.solvapay.app/auth/callback` in Supabase redirect URLs                                                                       |
| OpenNext build: proxy warning                        | Use `proxy.ts` for the Next.js proxy convention                                                                                                       |
| `wrangler whoami` missing SolvaPay account           | Request access to Cloudflare account `98aefe33182e11a1b0e5d7fa89a12a6d`                                                                               |

## Demo Flow

1. **Home Page**: View locked premium content
2. **Click Upgrade**: Trigger inline payment form
3. **Complete Payment**: Use test card (4242 4242 4242 4242)
4. **View Unlocked Content**: Premium features are instantly available
5. **Persistence**: Purchase persists in localStorage across refreshes

## Testing Payments

Use these test card numbers in the checkout form:

| Card Number         | Result             |
| ------------------- | ------------------ |
| 4242 4242 4242 4242 | Payment succeeds   |
| 4000 0000 0000 0002 | Payment declined   |
| 4000 0000 0000 9995 | Insufficient funds |

- Use any future expiry date
- Use any 3-digit CVC
- Use any billing ZIP code

## How It Works

### 1. Root Provider Setup

```tsx
// app/layout.tsx
import { SolvaPayProvider } from '@solvapay/react'

// Zero config: uses the default HTTP transport wired to /api/* routes.
;<SolvaPayProvider>{children}</SolvaPayProvider>
```

To override individual methods, pass a custom `transport` on the config. See
[`@solvapay/react` README](../../packages/react/README.md#fully-custom-implementation).

### 2. Authentication Setup

This demo uses Supabase authentication through `proxy.ts` and SDK helpers from
`@solvapay/next`.

**Proxy setup (default):**

```tsx
// proxy.ts
import { createSupabaseAuthMiddleware } from '@solvapay/next/middleware'

export const proxy = createSupabaseAuthMiddleware({
  publicRoutes: ['/api/list-plans', '/api/merchant', '/api/get-product'],
})

export const config = {
  matcher: ['/api/:path*'],
}
```

The frontend sends the Supabase access token in the Authorization header for protected routes:

```tsx
// app/layout.tsx
import { getAccessToken } from './lib/supabase'

const handleCreatePayment = async ({ planRef }) => {
  const accessToken = await getAccessToken()
  const res = await fetch('/api/create-payment-intent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
    },
    body: JSON.stringify({ planRef, productRef }),
  })
  return res.json()
}
```

### 3. Locked Content with PurchaseGate

```tsx
// app/page.tsx
import { PurchaseGate, UpgradeButton } from '@solvapay/react'
;<PurchaseGate requirePlan="Pro Plan">
  {({ hasAccess, loading }) => {
    if (loading) return <Skeleton />

    if (!hasAccess) {
      return (
        <div>
          <h2>Premium Content</h2>
          <UpgradeButton planRef="pln_pro">
            {({ onClick, loading }) => (
              <button onClick={onClick}>{loading ? 'Loading...' : 'Upgrade Now'}</button>
            )}
          </UpgradeButton>
        </div>
      )
    }

    return <PremiumContent />
  }}
</PurchaseGate>
```

### 4. Navigation with Plan Badge

```tsx
// app/components/Navigation.tsx
import { PlanBadge, UpgradeButton } from '@solvapay/react';

<PlanBadge>
  {({ purchases, loading }) => {
    const activeSubs = purchases.filter(sub => sub.status === 'active');
    return (
      <div>
        {activeSubs.length > 0
          ? activeSubs.map(sub => <span>[Active] {sub.productName}</span>)
          : <span>Free Plan</span>
        }
      </div>
    );
  }}
</PlanBadge>

<UpgradeButton planRef="pln_pro">
  {({ onClick, loading, disabled }) => (
    <button onClick={onClick} disabled={disabled}>
      {loading ? 'Processing...' : 'Upgrade'}
    </button>
  )}
</UpgradeButton>
```

### 5. Backend API Routes

The API routes are intentionally thin and delegate to `@solvapay/next` helpers.
Each route returns either a `NextResponse` (on auth/errors) or helper payload JSON.

**Check Purchase:**

```typescript
// app/api/check-purchase/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { checkPurchase } from '@solvapay/next'

export async function GET(request: NextRequest) {
  const result = await checkPurchase(request)
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
```

**Create Payment Intent:**

```typescript
// app/api/create-payment-intent/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createPaymentIntent } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const { planRef, productRef } = await request.json()
  const result = await createPaymentIntent(request, { planRef, productRef })
  return result instanceof NextResponse ? result : NextResponse.json(result)
}
```

## Project Structure

```
checkout-demo/
├── app/
│   ├── api/
│   │   ├── create-payment-intent/
│   │   │   └── route.ts          # Payment intent creation
│   │   └── check-purchase/
│   │       └── route.ts          # Purchase status check
│   ├── components/
│   │   └── Navigation.tsx        # Nav with PlanBadge and UpgradeButton
│   ├── lib/
│   │   ├── customer.ts           # Customer ID management (Supabase auth)
│   │   └── supabase.ts           # Supabase client setup
│   ├── checkout/
│   │   └── page.tsx              # Checkout page with plan selection
│   ├── layout.tsx                # Root layout with SolvaPayProvider
│   └── page.tsx                  # Home with locked content
├── proxy.ts                      # Supabase JWT auth on /api/* (Edge)
├── wrangler.jsonc                # Cloudflare Worker config (prod: web-app-demo.solvapay.app)
├── scripts/deploy.mjs            # Deploy wrapper (sources .env / .env.prod)
├── open-next.config.ts           # OpenNext Cloudflare adapter config
├── .env.prod.example             # Prod build/deploy env template (copy to .env.prod)
├── .dev.vars.example             # Local wrangler dev secrets template
├── package.json
├── next.config.mjs
├── tsconfig.json
└── README.md
```

## Key Concepts

### Headless Components

All components use **render props** pattern for maximum flexibility:

```tsx
<Component>
  {({ state, handlers }) => (
    // Your custom UI here
  )}
</Component>
```

This allows you to:

- Use any CSS framework (Tailwind, CSS Modules, Styled Components)
- Implement any UI design
- Control all behavior and state
- Maintain full TypeScript type safety

### Purchase State Management

The provider automatically:

- Fetches purchase on mount
- Provides refetch method for updates
- Exposes helper methods (`hasActivePurchase`)
- Manages loading states

### Authentication

This demo uses Supabase authentication through `proxy.ts` by default:

- Proxy extracts user IDs from Supabase JWT tokens on all `/api/*` routes
- User IDs are set as `x-user-id` header for downstream routes
- Proxy returns 401 if authentication fails
- The frontend sends access tokens in Authorization headers
- The Supabase user ID is stored as `externalRef` on the SolvaPay backend
- The `customerRef` prop passed to `SolvaPayProvider` uses the Supabase user ID as a cache key (the actual SolvaPay backend customer reference is returned from API calls)
- Individual routes can optionally use SupabaseAuthAdapter directly (see route comments)

**Sign-in Methods:**

- Email/password authentication
- Google OAuth (requires Google OAuth setup in Supabase dashboard)

**Google OAuth Setup:**

1. **In Google Cloud Console:**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Navigate to APIs & Services → Credentials
   - Create OAuth 2.0 Client ID (or use existing)
   - Copy the **Client ID** and **Client Secret**
   - Add authorized redirect URI: `https://[your-project-ref].supabase.co/auth/v1/callback`
   - Example: `https://ganvogeprtezdpakybib.supabase.co/auth/v1/callback`
   - **Note**: This is Supabase's internal callback URL (read-only in Supabase dashboard)

2. **In Supabase Dashboard:**
   - Go to Authentication → Providers → Google
   - Enable Google provider (toggle ON)
   - **Client IDs**: Paste your Google OAuth Client ID (no spaces, just the ID)
   - **Client Secret (for OAuth)**: Paste your Google OAuth Client Secret
   - **Callback URL**: This is read-only - Supabase handles the OAuth callback internally at this URL
   - Add your app's callback URL to Site URL or Redirect URLs:
     - Go to Authentication → URL Configuration
     - Add to Redirect URLs: `http://localhost:3000/auth/callback` (for local dev)
     - Add production URL when deploying: `https://yourdomain.com/auth/callback`

**How it works:**

1. User clicks "Sign in with Google" → redirects to Supabase → Google
2. Google redirects back to Supabase's callback URL (read-only, handled by Supabase)
3. Supabase processes the OAuth and redirects to your app's callback URL (`/auth/callback`)
4. Your app's callback handler receives the session and syncs the customer

**Important:**

- The Supabase callback URL (`https://[your-project-ref].supabase.co/auth/v1/callback`) goes in Google Cloud Console
- Your app's callback URL (`http://localhost:3000/auth/callback`) goes in Supabase dashboard Redirect URLs
- The Supabase callback URL is read-only - Supabase handles it automatically

## Environment Variables

| Variable                           | Description                                                                          | Required |
| ---------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| `SOLVAPAY_SECRET_KEY`              | Your SolvaPay secret key                                                             | Yes      |
| `SOLVAPAY_API_BASE_URL`            | Backend URL — must match the API that issued `SOLVAPAY_SECRET_KEY` (see deploy docs) | No       |
| `NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF` | Product reference (client bundle)                                                    | No       |
| `NEXT_PUBLIC_SUPABASE_URL`         | Supabase project URL                                                                 | Yes      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`    | Supabase anon/public key                                                             | Yes      |
| `SUPABASE_JWT_SECRET`              | Supabase JWT secret (for server verification)                                        | Yes      |

## Customization

### Adding New Plans

Edit `app/checkout/page.tsx`:

```typescript
const plans = {
  basic: {
    name: 'Basic Plan',
    amount: 999, // $9.99 in cents
    planRef: 'pln_basic',
    features: ['Feature 1', 'Feature 2'],
  },
  enterprise: {
    name: 'Enterprise',
    amount: 9999, // $99.99 in cents
    planRef: 'pln_enterprise',
    features: ['All features', 'Priority support'],
  },
}
```

### Custom Styling

All components accept any styling approach:

```tsx
// Tailwind
<UpgradeButton planRef="pro">
  {({ onClick, loading }) => (
    <button
      onClick={onClick}
      className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
    >
      {loading ? 'Processing...' : 'Upgrade'}
    </button>
  )}
</UpgradeButton>

// CSS Modules
<PlanBadge>
  {({ purchases }) => (
    <div className={styles.badge}>
      {purchases.map(sub => sub.productName).join(', ')}
    </div>
  )}
</PlanBadge>
```

### Custom layout

Need full control over the surrounding layout? Compose `<PlanSelector>`,
`<PaymentForm>`, and `<ActivationFlow>` directly. See the
[SDK README](../../packages/react/README.md#custom-composition-pick-the-primitives-you-need)
for slot usage and render-prop escape hatches.

## Best Practices

### 1. Provider Setup

Always wrap your app with `SolvaPayProvider` at the root level:

```tsx
// app/layout.tsx
<SolvaPayProvider>{children}</SolvaPayProvider>
```

Pass a custom transport only when you need to override the default HTTP
routing (e.g. MCP App). See
[`@solvapay/react` README](../../packages/react/README.md#fully-custom-implementation).

### 2. Error Handling

Handle errors via `config.onError` or wrap your transport:

```tsx
const handleCreatePayment = async ({ planRef, customerRef }) => {
  try {
    const res = await fetch('/api/create-payment-intent', {
      method: 'POST',
      body: JSON.stringify({ planRef, customerRef, productRef }),
    })

    if (!res.ok) {
      throw new Error('Payment intent creation failed')
    }

    return res.json()
  } catch (error) {
    console.error('Payment error:', error)
    throw error // Re-throw to let provider handle it
  }
}
```

### 3. Purchase Refetching

Always refetch purchase after successful payment:

```tsx
const { refetch } = usePurchase()

const handlePaymentSuccess = async () => {
  await refetch() // Update purchase status
  // Navigate or show success message
}
```

### 4. Loading States

Use loading states from hooks:

```tsx
const { loading, purchases } = usePurchase()

if (loading) {
  return <Spinner />
}
```

### 5. Type Safety

Use TypeScript types from the SDK:

```tsx
import type { PurchaseStatus } from '@solvapay/react'

const status: PurchaseStatus = purchase.status
```

### 6. Environment Variables

Never commit `.env.local` files and document all required variables:

```bash
# .env.local (never commit)
SOLVAPAY_SECRET_KEY=your_key_here
SUPABASE_JWT_SECRET=your_secret_here
```

## Troubleshooting

### "Missing SOLVAPAY_SECRET_KEY"

**Problem**: Error about missing secret key.

**Solution**:

1. Ensure `.env.local` or `.env` exists in the example directory (run `npx solvapay init` or create manually)
2. For Cloudflare deploys, upload secrets with `wrangler secret put` (local `.env` is not read in prod)
3. Restart the dev server after adding environment variables
4. Verify the variable name is exactly `SOLVAPAY_SECRET_KEY`

### "Payment intent creation failed"

**Problem**: Payment intent creation returns an error.

**Solution**:

1. Check your SolvaPay API key is valid in the dashboard
2. Verify the backend URL is correct (`SOLVAPAY_API_BASE_URL`)
3. Check network tab for API errors and status codes
4. Verify product and plan references match your dashboard
5. Check server logs for detailed error messages
6. Ensure API route is properly handling authentication

### Purchase not updating after payment

**Problem**: Payment succeeds but purchase status doesn't update.

**Solution**:

1. Check that `refetch()` is called after successful payment:
   ```tsx
   const { refetch } = usePurchase()
   await refetch()
   ```
2. Verify API returns proper purchase format
3. Check browser console for errors
4. Verify customer reference matches between frontend and backend
5. Check that webhook is configured (if using webhooks)
6. Wait a few seconds and manually refetch

### Components not rendering

**Problem**: SolvaPay components don't appear or throw errors.

**Solution**:

1. Ensure you're inside `<SolvaPayProvider>`:
   ```tsx
   <SolvaPayProvider {...props}>
     <YourComponent />
   </SolvaPayProvider>
   ```
2. Check that hooks are called in functional components (not class components)
3. Verify all required props are provided to provider
4. Check browser console for React errors
5. Verify customer reference is available

### "Unauthorized" errors

**Problem**: API routes return 401 Unauthorized, or checkout shows `Failed to fetch plans: 401`.

**Solution**:

1. **`/api/list-plans` 401 (public route):** The Worker calls SolvaPay with `SOLVAPAY_SECRET_KEY`. Set `SOLVAPAY_API_BASE_URL` in `.env.prod` to the API that issued the key — keys from `solvapay init` / app.solvapay.com use `https://api.solvapay.com`; dev/staging keys use `https://api-dev.solvapay.com`. Redeploy with `pnpm run deploy:cf:prod`.
2. **Protected routes 401:** Verify Supabase credentials are correct
3. Check that `SUPABASE_JWT_SECRET` matches your project settings
4. Ensure proxy (`proxy.ts`) is properly extracting user ID
5. Verify access token is being sent in Authorization header
6. Check Supabase project has email/password auth enabled
7. Review proxy logs for authentication errors

### Payment form not appearing

**Problem**: Clicking upgrade button doesn't show payment form.

**Solution**:

1. Check that `createPayment` callback is provided to provider
2. Verify callback returns proper format with `clientSecret`
3. Check browser console for errors
4. Ensure Stripe publishable key is available
5. Verify payment intent creation succeeds

### Google OAuth "redirect_uri_mismatch" Error (Error 400)

This error occurs when Google doesn't recognize the redirect URI that Supabase is using.

**The Fix:**

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **APIs & Services → Credentials**
3. Click on your **OAuth 2.0 Client ID**
4. Scroll down to **Authorized redirect URIs**
5. Click **+ ADD URI**
6. Add your Supabase callback URL exactly as shown in Supabase dashboard:
   - `https://[your-project-ref].supabase.co/auth/v1/callback`
   - Example: `https://ganvogeprtezdpakybib.supabase.co/auth/v1/callback`
7. Click **SAVE**

**Important Notes:**

- Google sees Supabase's callback URL (`https://ganvogeprtezdpakybib.supabase.co/auth/v1/callback`), NOT your localhost URL
- The `redirectTo` option (`localhost:3000/auth/callback`) is where Supabase redirects AFTER processing OAuth
- You must add the Supabase callback URL to Google Cloud Console, not localhost
- Make sure the URL matches exactly (including the `/auth/v1/callback` path)
- After adding the URI, wait a few minutes for changes to propagate

**For Production:**

- You'll need to add your production Supabase callback URL if different
- Your app's callback URL (`https://yourdomain.com/auth/callback`) goes in Supabase dashboard Redirect URLs, not Google Cloud Console

## Related Documentation

### Getting Started

- [Examples Overview](../../docs/guides/examples.mdx) - Overview of all examples
- [Installation Guide](../../docs/setup/installation.mdx) - SDK installation
- [Quick Start Guide](../../docs/setup/quick-start.mdx) - Quick setup guide
- [Core Concepts](../../docs/setup/core-concepts.mdx) - Understanding agents, plans, and paywalls

### Framework Guides

- [React Integration Guide](../../docs/guides/react.mdx) - Complete React integration guide
- [Next.js Integration Guide](../../docs/guides/nextjs.mdx) - Next.js specific patterns
- [Custom Authentication Adapters](../../docs/guides/custom-auth.mdx) - Custom auth setup
- [Error Handling Guide](../../docs/contributing/error-handling.md) - Error handling patterns

### API Reference

- [React SDK API Reference](../../packages/react/README.md) - Complete React component documentation
- [Server SDK API Reference](../../packages/server/README.md) - Backend API documentation
- [Next.js SDK API Reference](../../packages/next/README.md) - Next.js helper documentation

### Additional Resources

- [SolvaPay Documentation](https://docs.solvapay.com) - Official documentation
- [Headless Components Pattern](https://www.patterns.dev/posts/headless-ui) - Headless UI patterns
- [Stripe Testing Documentation](https://stripe.com/docs/testing) - Test card numbers
- [Next.js Documentation](https://nextjs.org/docs) - Next.js framework docs
- [GitHub Repository](https://github.com/solvapay/solvapay-sdk) - Source code and issues

## Support

For issues or questions:

- GitHub Issues: https://github.com/solvapay/solvapay-sdk/issues
- Documentation: https://docs.solvapay.com
- Email: contact@solvapay.com
