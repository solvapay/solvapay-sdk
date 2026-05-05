# Chat Checkout Demo

A Vite-only chat app that demonstrates the SolvaPay React primitives for **three monetization scenarios** in a single chrome:

- **Subscription** — recurring plan via `<PaymentForm.*>`
- **Day Pass** — one-time plan via `<PaymentForm.*>`
- **Top-up** — credit balance via `<TopupForm.*>` + `<AmountPicker>` styling

The chat itself is powered by Google Gemini, and every browser gets an anonymous SolvaPay customer (random UUID in `localStorage`) so the demo runs without any login screen.

## Architecture

The app is a single Vite process. SolvaPay API routes (`/api/list-plans`, `/api/create-payment-intent`, …) are mounted as Vite middleware in `vite.config.ts` and dispatch to the framework-agnostic `*Core` helpers from `@solvapay/server`. `SOLVAPAY_SECRET_KEY` stays server-side; the browser only forwards an `x-customer-ref` header.

```
Browser (App.tsx, components/*, SolvaPay primitives)
   │
   │  fetch /api/* with x-customer-ref header
   ▼
Vite middleware (src/server/*)
   │
   │  @solvapay/server *Core helpers
   ▼
SolvaPay API
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
| `VITE_GEMINI_API_KEY` | Gemini API key from [aistudio.google.com](https://aistudio.google.com/app/apikey). |
| `VITE_SUBSCRIPTION_PRODUCT_REF` | A product intended to back the subscription scenario (typically a **recurring** plan). |
| `VITE_DAYPASS_PRODUCT_REF` | A product intended to back the day-pass scenario (typically a **one-time** plan). |
| `VITE_TOPUP_PRODUCT_REF` | Optional product ref to scope top-up analytics. |

The demo lists plans for each product on demand and auto-picks when there's only one. Multiple plans render an inline picker so the user can choose before paying. Each scenario can be configured independently — the demo will display an inline notice when env vars are missing, so you can try the chat / paywall flow with just one scenario set up.

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

| Scenario | UI element | SolvaPay primitive | Plan type |
|---|---|---|---|
| Subscription | `components/CheckoutForm.tsx` | `<PaymentForm.Root>` | `recurring` |
| Day Pass | `components/DayPassForm.tsx` | `<PaymentForm.Root>` | `one-time` |
| Top-up | `components/TopUpSelection.tsx` + `components/TopUpForm.tsx` | `<TopupForm.Root>` | n/a (balance) |

`App.tsx` derives the scenario state directly from SDK hooks:

- `usePurchase()` → `isPremium` (any active recurring plan) and `hasDayPass` (any active one-time plan)
- `useBalance()` → `credits` rendered in the header pill

The 2-message free tier is a demo-side business rule and lives in `App.tsx` (`FREE_MESSAGE_LIMIT`). It is intentionally not pushed into SolvaPay since we don't want plan resolution to block free chat.

## Anonymous customer flow

There is no login. The first time the app loads it generates `anon_<uuid>` and stores it under `chat-checkout-demo:customerRef` in `localStorage`. Every API call sends this value as `x-customer-ref`; the Vite middleware rewrites it to `x-user-id`, which is what `getAuthenticatedUserCore` reads. The SolvaPay backend upserts the customer using this value as `externalRef`.

Reset the demo by clearing the key in DevTools → Application → Local Storage.

## Caveats

- **Auto top-up toggle** is cosmetic only. The SolvaPay top-up payment intent doesn't accept an auto-flag yet.
- **Day-pass expiry** uses the SolvaPay purchase's `endDate`. The mockup never expired the pass; here it expires whenever the backend says so.
- **Tailwind via CDN** matches the original mockup. For a production app you'd swap to a real Tailwind v4 build.
