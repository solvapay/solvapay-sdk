# Chat Checkout Demo

A Vite-only chat app that demonstrates the SolvaPay React + server primitives for **three monetization scenarios** in a single chrome:

- **Subscription** — recurring plan via `<PaymentForm.*>`
- **Lifetime Access** — one-time plan via `<PaymentForm.*>`
- **Top-up** — credit balance via `<TopupForm.*>` + `<AmountPicker>` styling

The chat itself is powered by Google Gemini, proxied through a `/api/chat` route that gates each request via the SDK's `payable.gate(req, { ctx })` primitive — the decision-shaped paywall for streaming flows. Every browser gets an anonymous SolvaPay customer (random UUID in `localStorage`, via `@solvapay/react`'s `getOrCreateAnonymousCustomerRef`) so the demo runs without any login screen.

## Architecture

The app runs in two modes off a single source tree:

- **Local dev** (`pnpm dev`) — Vite serves the SPA and mounts `/api/*` as connect-style middleware via `src/server/vitePlugin.ts`.
- **Production** (`pnpm deploy`) — a Cloudflare Worker (`src/worker.ts`) serves the Vite build via Workers Assets and dispatches `/api/*` through the same handlers.

The dispatcher itself (`src/server/handlers.ts`) is runtime-agnostic: it takes a Web `Request` and a `{ solvaPay, geminiApiKey }` deps object, so both runtimes share one routing table. SolvaPay routes (`/api/list-plans`, `/api/create-payment-intent`, …) dispatch to the framework-agnostic `*Core` helpers from `@solvapay/server` with `{ solvaPay }` passed through (no `process.env` reads inside). The chat route uses `solvaPay.payable({ productRef }).gate(req, { ctx })` — the SDK's decision-shaped primitive for streaming flows — to gate the request, then streams Gemini's response as NDJSON via a `ReadableStream`. Both `SOLVAPAY_SECRET_KEY` and `GEMINI_API_KEY` stay server-side; the browser only forwards an `x-customer-ref` header.

```
Browser (App.tsx, components/*, <PaywallNotice>)
   │
   │  fetch /api/* with x-customer-ref header
   ▼
Vite middleware  ──or──  Cloudflare Worker
(src/server/middleware.ts)  (src/worker.ts)
   │                        │
   └────► handleApiRequest (src/server/handlers.ts) ◄────┘
            │
            │  /api/chat → payable.gate(req, { ctx })
            │              ├── 402 (paywall) → JSON Response
            │              └── allow → stream Gemini + trackSuccess on close
            │  /api/*    → @solvapay/server *Core helpers
            ▼
        SolvaPay API + Gemini
```

## Setup

```bash
# From the SDK monorepo root
pnpm install

# Copy the env template and fill in your keys / refs
cd examples/chat-checkout-demo
cp env.example .env
```

Required env vars:

| Variable | Purpose |
|---|---|
| `SOLVAPAY_SECRET_KEY` | Secret API key (sandbox or live). Server-side only. |
| `GEMINI_API_KEY` | Gemini API key from [aistudio.google.com](https://aistudio.google.com/app/apikey). Server-side only — proxied through `/api/chat`. |
| `VITE_SUBSCRIPTION_PRODUCT_REF` | A product intended to back the subscription scenario (typically a **recurring** paid plan). |
| `VITE_LIFETIME_PRODUCT_REF` | A product intended to back the lifetime access scenario (typically a **one-time** paid plan). |
| `VITE_TOPUP_PRODUCT_REF` | A product intended to back the top-up scenario (a usage-based plan + one one-time plan per credit pack). |

The demo lists plans for each product on demand. Each scenario can be configured independently — the demo will display an inline notice when env vars are missing, so you can try the chat / paywall flow with just one scenario set up.

## Plan setup

The demo no longer hardcodes any pricing or free-tier limits — it reads them from the plans you configure on each product in the SolvaPay dashboard.

| Scenario | Product needs | Each plan should set |
|---|---|---|
| Subscription | One recurring paid plan (and optionally one free plan). | `name`, `price`, `currency`, `billingCycle`. The free plan should set `freeUnits` to whatever message cap you want before the paywall trips. |
| Lifetime Access | One one-time paid plan (and optionally one free plan). | `name`, `price`, `currency`. The free plan should set `freeUnits`. |
| Top-up | One usage-based plan (and optionally one free plan). | Usage-based plan: `meterName: 'requests'`, `freeUnits`, `creditsPerUnit`. The SDK's `<AmountPicker>` handles credit-pack selection via currency presets (`$10` / `$50` / `$100` / `$500` for USD) plus a custom amount — **no separate pack plans needed**. |

> **Migration note.** Earlier revisions of this README told you to set up the topup product with `"one one-time plan per credit pack"` (`100 Credits` at `$5`, `250 Credits` at `$10`, etc.). That was wrong — it doesn't match the hosted-checkout topup pattern in `solvapay-frontend/src/pages/customer/checkout/topup.tsx`. If your topup product carries those pack plans, delete them in the SolvaPay dashboard. The SDK's `<CheckoutSteps.AmountPicker>` covers their job and uses the same currency presets as the hosted page. Recent SDK versions also default to a smart plan filter that hides PAYG when the product still has pack plans, so the grid renders only the packs while you migrate.

### Topup currency

The PAYG topup branch (`<CheckoutSteps.AmountPicker>` and the embedded `<TopupForm>`) drives currency off the **merchant's `defaultCurrency`** — credits are merchant-wide, not plan-specific, so plan currency is intentionally ignored on the topup path. The header pill and quick-amount presets follow the merchant currency automatically (USD → `[10, 50, 100, 500]`, SEK → `[100, 500, 1000, 5000]`, JPY → `[1000, 5000, 10000, 50000]`, etc.). When `useMerchant` is still in flight on first paint, the picker renders a brief skeleton instead of a misleading default — usually invisible thanks to the 5-minute cache.

For multi-currency topups (a per-customer picker letting them pay in EUR, USD, etc. against the same merchant wallet), pass an explicit code via the new `topupCurrency` prop on `<CheckoutSteps.Root>` or `<PaywallNotice.EmbeddedCheckout>`:

```tsx
const [currency, setCurrency] = useState('EUR')

<MyCurrencyPicker value={currency} onChange={setCurrency} />
<CheckoutSteps.Root
  productRef={productRef}
  returnUrl={returnUrl}
  topupCurrency={currency}
>
  …
</CheckoutSteps.Root>
```

Recurring/one-time plans always settle in `plan.currency` regardless of the prop — the `topupCurrency` knob is scoped to the wallet-credit topup flow.

Tips:

- Set the merchant's `termsUrl` and `privacyUrl` in the SolvaPay dashboard so they appear inline in the per-purchase mandate sentence rendered by `<PaymentForm.MandateText>`.
- Give each plan a human-readable `name`. `<PlanSelector>` falls back to the plan reference (`pln_…`) when no name is set, which doesn't read well.

## Run

```bash
pnpm dev          # http://localhost:3011
pnpm build
pnpm preview
```

## Test cards

Stripe test cards work in sandbox mode:

| Card | Result |
|---|---|
| `4242 4242 4242 4242` | Succeeds |
| `4000 0000 0000 0002` | Declined |
| `4000 0025 0000 3155` | Requires 3DS |

Use any future expiry, any 3-digit CVC, any postcode.

## How the scenarios map to SolvaPay

| Scenario | Plan type | Checkout primitive (driven by `<CheckoutSteps.*>`) |
|---|---|---|
| Subscription | `recurring` | `<PaymentForm.Root>` |
| Lifetime Access | `one-time` | `<PaymentForm.Root>` |
| Top-up | `usage-based` | `<AmountPicker>` → `<TopupForm.Root>` |

All three scenarios share **one** drawer (`components/InlineCheckout.tsx`). The drawer routes on a discriminated state:

- **`{ mode: 'paywall', content }`** — fired when the chat hits a 402. Renders `<PaywallNotice.Root>` + `<PaywallNotice.Heading>` + `<PaywallNotice.Message>` + `<PaywallNotice.EmbeddedCheckout>`. The notice resolves a web-friendly i18n string for the message (no MCP-flavored "Call the `upgrade` tool…" copy) and `EmbeddedCheckout` ships a stepped `<CheckoutSteps.*>` composition under the hood.
- **`{ mode: 'upgrade', productRef }`** — fired when the user clicks "Upgrade" before hitting a 402. Renders `<CheckoutSteps.Root>` directly with no paywall chrome. Drops the synthetic `payment_required` content the demo used to mint client-side.

### Which component when

| Use case | Import |
|---|---|
| Building any checkout UX (web, chatbot, custom) — want the state engine and pre-styled parts | `useCheckoutFlow` + `CheckoutSteps` from `@solvapay/react` |
| Reacting to a 402 paywall response with the SDK's recommended stepped layout | `<PaywallNotice.EmbeddedCheckout>` |
| Building an MCP App iframe | `<McpApp>` / `<McpCheckoutView>` from `@solvapay/react/mcp` |
| Need full layout control or a custom step ordering | Compose `<CheckoutSteps.*>` parts in your own JSX, or drop to `<PlanSelector>` / `<PaymentForm>` / `<TopupForm>` directly |

`App.tsx` derives the scenario state directly from SDK hooks:

- `usePurchase()` → `isPremium` (any active recurring plan) and `hasLifetimeAccess` (any active one-time plan)
- `useBalance()` → `credits` rendered in the header pill
- `usePlans({ productRef })` → drives the header tooltip pricing and the `X / Y` free-message counter from the active plan's `freeUnits`. No `fetcher` prop is required — `usePlans` defaults to `defaultListPlans` which routes through the SolvaPay transport.

### The chat gate

`/api/chat` uses the SDK's decision-shaped `payable.gate(req, { ctx })` primitive (`src/server/chat.ts`). It pre-checks limits, returns either a 402 `Response` (which the browser routes through `App.tsx`'s `checkoutState = { mode: 'paywall', content }` to `<InlineCheckout>`) or an `allow` decision with bound `trackSuccess` / `trackFail` closures. The closures fire once the Gemini stream finalises, with `ctx.waitUntil` keeping `trackUsage` alive past the response close on Workers.

Once a 402 lands, the SDK's `usePaywallResolver` (mounted inside `<PaywallNotice.Root>`) watches `usePurchase` + `useBalance` and flips `resolved` the moment the customer's entitlement satisfies the gate. The notice's `onResolved` callback then dismisses the drawer and `App.tsx` replays the pending message — no manual 402 retry loop required.

## Anonymous customer flow

There is no login. The first time the app loads it calls `getOrCreateAnonymousCustomerRef()` from `@solvapay/react/adapters/auth`, which mints `anon_<uuid>` and persists it in `localStorage`. The matching `createAnonymousAuthAdapter(ref)` is wired into `<SolvaPayProvider>` so the SDK's auth-poll heuristic stays happy. Every API call sends this value as `x-customer-ref`; the Vite middleware mirrors it to `x-user-id` for the framework-agnostic `*Core` helpers, while the chat path reads it directly via `payable.gate(req)`. The SolvaPay backend upserts the customer using this value as `externalRef`.

Reset the demo by clicking the customer chip in the header → "Reset identity" (or call `resetAnonymousCustomerRef()` in DevTools). Free-tier usage persists across reloads on the SolvaPay backend, so switching scenarios or refreshing won't reset the count — just like in production.

### Swap to real auth

When you wire a real identity provider (Clerk, Supabase, Auth0, …), drop the anonymous helpers and pass a JWT-aware `AuthAdapter` instead. The shape stays the same — only the resolver changes:

```tsx
// src/lib/Providers.tsx (real auth)
import { SolvaPayProvider, type AuthAdapter } from '@solvapay/react'

const jwtAuthAdapter: AuthAdapter = {
  async getToken() { return await yourAuth.getAccessToken() ?? null },
  async getUserId() { return (await yourAuth.getUser())?.id ?? null },
}

<SolvaPayProvider config={{ auth: { adapter: jwtAuthAdapter } }}>{…}</SolvaPayProvider>
```

On the server, drop the `x-customer-ref` middleware and let `payable.gate(req, { getCustomerRef })` resolve the customer from the bearer token:

```ts
// src/server/chat.ts (real auth)
const gate = await payable.gate(req, {
  ctx,
  getCustomerRef: async req => {
    const token = req.headers.get('authorization')?.slice(7)
    if (!token) return 'anonymous'
    const { sub } = await verifyJwt(token)
    return sub
  },
})
```

The SolvaPay backend will dedupe the customer by `externalRef` (the JWT `sub`), so existing anonymous purchases migrate naturally if you map the anon id to the new account at sign-up.

## Deploy to Cloudflare Workers

The `src/worker.ts` entrypoint pairs with `wrangler.jsonc` to deploy the demo as a single Worker that serves both the Vite SPA build (via the Workers Assets binding) and the `/api/*` routes. Mirrors the deploy ergonomics from `examples/cloudflare-workers-mcp` — public-safe placeholders in git, real values in a gitignored `.env` that `scripts/deploy.mjs` forwards as `--var` flags.

> **Two value paths, two different homes.** Build-time vars (anything `VITE_*`) get baked into the SPA at `vite build` time and are read from the root `.env`. Server-side credentials (`SOLVAPAY_SECRET_KEY`, `GEMINI_API_KEY`) are Worker **secrets** — uploaded **once** via `wrangler secret put` and persisted on the Worker. `scripts/deploy.mjs` does NOT re-upload secrets on every deploy; that's by design (secrets out of deploy-time plaintext). If you skip the `wrangler secret put` step, every `/api/*` request returns 500 with `SOLVAPAY_SECRET_KEY is not set` and the page shows Cloudflare's `error code: 1101`.

### Local Worker dev

```bash
# From the SDK monorepo root
pnpm install
pnpm -w build:packages

cd examples/chat-checkout-demo
cp .env.example .env
# Fill in SOLVAPAY_SECRET_KEY and GEMINI_API_KEY in .env

pnpm build              # produces dist/ from the Vite SPA
pnpm serve:local        # wrangler dev on http://localhost:8787
```

`wrangler dev` reads `.env` directly, so no separate secret upload is needed locally.

### Deploy to `*.workers.dev`

**1. Upload the secrets** (one-time per Worker, persists across deploys):

```bash
pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY    # paste the value when prompted
pnpm exec wrangler secret put GEMINI_API_KEY
```

Or pipe from your local `.env` to skip the prompt:

```bash
grep '^SOLVAPAY_SECRET_KEY=' .env | cut -d= -f2- | pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY
grep '^GEMINI_API_KEY=' .env       | cut -d= -f2- | pnpm exec wrangler secret put GEMINI_API_KEY
```

Verify with `pnpm exec wrangler secret list` — should show both names.

**2. Deploy:**

```bash
pnpm deploy   # runs `pnpm -w build:packages && pnpm build`, then `node scripts/deploy.mjs`
```

`scripts/deploy.mjs` sources `.env` and forwards `SOLVAPAY_API_BASE_URL` as a `--var` override. Output ends with the live `*.workers.dev` URL.

### Production deploy (custom domain)

The `[env.production]` block in `wrangler.jsonc` ships a placeholder hostname (`chat-demo.solvapay.app`). Edit it to your own zone (or remove the `routes` block entirely to serve on the default `*.workers.dev` URL).

> **Production secrets are scoped to the production Worker.** They live in a different secret store from the `*.workers.dev` Worker — uploading once for non-prod does NOT cover prod. You always need `--env production` for the prod path.

**1. Upload the prod secrets** (one-time):

```bash
pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY --env production
pnpm exec wrangler secret put GEMINI_API_KEY --env production

# Or pipe from .env.prod:
grep '^SOLVAPAY_SECRET_KEY=' .env.prod | cut -d= -f2- | pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY --env production
grep '^GEMINI_API_KEY=' .env.prod      | cut -d= -f2- | pnpm exec wrangler secret put GEMINI_API_KEY --env production
```

Verify with `pnpm exec wrangler secret list --env production`.

**2. Configure prod overrides:**

```bash
cp .env.prod.example .env.prod
$EDITOR .env.prod   # fill in SOLVAPAY_SECRET_KEY (matches what you just uploaded) and GEMINI_API_KEY
```

**3. Deploy:**

```bash
pnpm deploy:prod   # builds + deploys to the [env.production] Worker
```

`SOLVAPAY_API_BASE_URL` defaults to `https://api.solvapay.com` inside `src/worker.ts`. To point at a staging backend, uncomment it in `.env` (or `.env.prod`); `scripts/deploy.mjs` forwards it as a `--var` override.

### Rotating or fixing secrets

If you uploaded the wrong value, just `wrangler secret put` it again — the most recent value wins, and the Worker picks it up on the next request without a redeploy:

```bash
# Swap a sandbox key for a live key, prod target:
echo -n "sk_live_..." | pnpm exec wrangler secret put SOLVAPAY_SECRET_KEY --env production
```

### Tailing prod logs

When the deployed app misbehaves, `wrangler tail` is the fastest way to see the actual error:

```bash
pnpm exec wrangler tail --env production --format=pretty
```

`requireEnv` errors (`SOLVAPAY_SECRET_KEY is not set` / `GEMINI_API_KEY is not set`) always mean a missing-secret issue — see step 1 of the matching deploy section above.

### How the deploy overrides work

`wrangler.jsonc` ships safe public-starter placeholders so anyone who clones this repo can run `pnpm deploy` without accidentally connecting to someone else's merchant. `scripts/deploy.mjs` sources `.env` (gitignored) and passes real values through to `wrangler deploy --var KEY:VALUE` for `SOLVAPAY_API_BASE_URL`. Worker secrets (`SOLVAPAY_SECRET_KEY`, `GEMINI_API_KEY`) are uploaded once with `wrangler secret put` and persist across deploys; the script intentionally does NOT re-upload them.

### Vite build assets

`VITE_SUBSCRIPTION_PRODUCT_REF`, `VITE_LIFETIME_PRODUCT_REF`, and `VITE_TOPUP_PRODUCT_REF` are baked into the SPA bundle by Vite at `pnpm build` time. They live in the existing root `.env` (alongside `SOLVAPAY_SECRET_KEY` for the Vite dev path) — the Worker never reads them. Changing one of these requires a fresh `pnpm deploy` so the SPA bundle is rebuilt.

## Caveats

- **Auto top-up toggle** is cosmetic only. The SolvaPay top-up payment intent doesn't accept an auto-flag yet.
- **Lifetime access** is enforced server-side as long as the SolvaPay purchase remains active — no `endDate` is set, so it never expires.
- **Tailwind via CDN** matches the original mockup. For a production app you'd swap to a real Tailwind v4 build.
