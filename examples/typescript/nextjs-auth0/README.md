# Next.js Auth0 Task Board + SolvaPay

> **Canonical reference** for Auth0 + SolvaPay SDK integration. Copy this pattern for any Auth0 Regular Web Application.

A Next.js App Router example with **Auth0** login, **shadcn/ui**, **Tailwind CSS v4**, a per-user task board, and **SolvaPay** monetization using an **embedded** (non-hosted) **Pay As You Go** checkout.

## What it demonstrates

- Auth0 v4 login/logout via `proxy.ts` (`/auth/login`, `/auth/callback`, `/auth/logout`)
- Auth0 → SolvaPay identity bridge: `proxy.ts` forwards `session.user.sub` as the `x-user-id` header, so the SDK resolves the customer reference automatically
- **Embedded checkout** for the Pay As You Go plan via the SDK's `CheckoutSteps` engine (plan → top-up amount → inline Stripe Elements → success) — no redirect to a hosted checkout page
- **Paywalled, metered** task creation: `POST /api/tasks` runs behind `payable.next`, returning **402** when the customer is out of credits and recording one usage event (`requests`) per task
- shadcn/ui components with Tailwind theme tokens
- In-memory task storage (resets when the dev server restarts)

## How monetization works

Creating a task is the paid action. Each task costs **one request** against the Pay As You Go plan (pre-paid usage-based). The board:

1. Shows the **embedded checkout** until the customer has bought credits.
2. Lets them add tasks once they have credits (each deducts from the balance).
3. Re-surfaces the checkout to top up when `POST /api/tasks` returns **402**.

The `SOLVAPAY_SECRET_KEY` stays server-only. The browser only sees `NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF`. Payments are collected inline with Stripe Elements; the publishable key + client secret come from the payment-intent API responses.

## Identity bridge in depth

This example is the **canonical web reference** for mapping Auth0 users to SolvaPay customers. Read the inline comments in `proxy.ts`, `lib/auth0.ts`, and `components/solvapay-provider.tsx` for the full contract.

| Field | Source | SolvaPay usage | Browser? |
|-------|--------|----------------|----------|
| `externalRef` / customer ref | Auth0 `sub` | Stable billing identity via `x-user-id` | No — set server-side in `proxy.ts` |
| Auth0 ID token | Auth0 session | Optional email/name on first customer create | No — forwarded server-side only |
| Auth0 access token | Auth0 API | **Never** sent to SolvaPay | Stays at integrator edge |
| `SOLVAPAY_SECRET_KEY` | Dashboard | All SDK/server billing calls | Server-only |

**Auth0 app type:** create a **Regular Web Application** in the Auth0 Dashboard (not SPA/Native) so the session uses an httpOnly cookie and `/auth/login|callback|logout` work via `proxy.ts`.

**Token TTL:** if your IdP rotates access tokens on a short TTL at your edge, that does not affect SolvaPay. We key customers on the stable `sub`, not on access-token expiry.

**Further reading:**

- SDK guide: [`docs/guides/customer-linkage.mdx`](../../docs/guides/customer-linkage.mdx) — framework-agnostic linkage with `ensureCustomer(externalRef)`
- Auth0 adapters: [`docs/guides/custom-auth.mdx`](../../docs/guides/custom-auth.mdx)

## Prerequisites

- Node.js 20+
- pnpm (from repo root)
- An [Auth0](https://auth0.com) account
- A SolvaPay account with a product that has a Pay As You Go plan

## Auth0 setup

1. Create a **Regular Web Application** in the Auth0 Dashboard.
2. Configure URLs for local dev (port **3013**):
   - **Allowed Callback URLs:** `http://localhost:3013/auth/callback`
   - **Allowed Logout URLs:** `http://localhost:3013`
3. Copy Domain, Client ID, and Client Secret from the application settings.

## SolvaPay setup

This demo app always runs at `http://localhost:3013` (`APP_BASE_URL`). That is separate from where the **SolvaPay API** lives (`SOLVAPAY_API_BASE_URL`).

**Hosted dev backend:**

```bash
npx -y solvapay@latest init --dev
```

**Local backend** (your ngrok API URL — the app itself stays on localhost):

```bash
SOLVAPAY_API_BASE_URL=https://api.<your-subdomain>.ngrok.app npx -y solvapay@latest init --yes
```

Init authenticates, installs SDK packages, and writes `SOLVAPAY_SECRET_KEY`, `SOLVAPAY_API_BASE_URL`, and `SOLVAPAY_PRODUCT_REF` to `.env`. Then install the Next.js + React packages:

```bash
pnpm add @solvapay/next @solvapay/react
```

Finally, expose the product ref to the browser by adding it to `.env.local`:

```env
NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF=prd_xxxxxxxx   # same value as SOLVAPAY_PRODUCT_REF
```

## Run locally

```bash
pnpm install            # from repo root
cd examples/typescript/nextjs-auth0
cp .env.example .env.local
```

Edit `.env.local` with your Auth0 credentials and the public product ref:

```env
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_CLIENT_ID=your_client_id
AUTH0_CLIENT_SECRET=your_client_secret
AUTH0_SECRET=your_32_byte_hex_secret   # openssl rand -hex 32
APP_BASE_URL=http://localhost:3013
NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF=prd_xxxxxxxx
```

Start the dev server:

```bash
pnpm dev
```

Open [http://localhost:3013](http://localhost:3013).

## Manual test flow

1. Visit `/` — public landing page
2. Click **Log in to dashboard** — Auth0 Universal Login
3. After login, `/dashboard` shows the embedded Pay As You Go checkout
4. Buy credits inline with a [Stripe test card](https://docs.stripe.com/testing) (e.g. `4242 4242 4242 4242`)
5. Add tasks — each one deducts a credit; the remaining balance is shown
6. Spend down to zero — the next add re-opens the embedded checkout to top up
7. Log out / sign in as another user — separate board and balance

## API

All endpoints require an authenticated Auth0 session (401 otherwise).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks` | List tasks for the current user |
| `POST` | `/api/tasks` | Create a task `{ "title": "..." }` — paywalled + metered (402 when out of credits) |
| `DELETE` | `/api/tasks?id={taskId}` | Delete a task |

SolvaPay route wrappers (`@solvapay/next`), all resolving the customer from `x-user-id`:

`check-purchase`, `create-payment-intent`, `process-payment`, `create-topup-payment-intent`, `process-topup-payment`, `customer-balance`, `activate-plan`, `list-plans`, `get-product`, `merchant`, `payment-method`.

## Project structure

```
app/
  page.tsx              # Public landing
  dashboard/page.tsx    # Protected dashboard (renders the gated board)
  api/tasks/route.ts    # Session auth + SolvaPay paywall on POST
  api/<solvapay>/route.ts  # @solvapay/next route wrappers (see table above)
components/
  site-header.tsx       # Login / logout
  task-board.tsx        # Gates on purchase state; embeds checkout
  checkout-panel.tsx    # Embedded CheckoutSteps (plan → amount → Stripe)
  solvapay-provider.tsx # SolvaPayProvider + Auth0 auth adapter (useUser)
lib/
  auth0.ts              # Auth0Client instance
  solvapay.ts           # Shared server SolvaPay client + product ref
  tasks-store.ts        # In-memory Map keyed by user.sub
proxy.ts                # Auth0 middleware + x-user-id identity bridge
```
