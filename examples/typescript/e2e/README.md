# Example checkout e2e suite

Playwright coverage for the TypeScript checkout examples, driven end to end
against a **live local platform stack** with real Stripe test-mode payments.

Playwright starts the demos. It does **not** start the platform, and there are no
stubs, request mocks or conditional skips: if the stack or the merchant
environment is missing, the run fails in global setup with an actionable message.

```
Playwright ──webServer──▶ demo (Next/Vite, :3030+)
                              │ SOLVAPAY_API_BASE_URL=http://127.0.0.1:3010
                              ▼
                         provider-app /v1 proxy ──▶ local platform services
                              │
                              ▼ Stripe.js iframe
                         Stripe (test mode)
```

## What each project covers

| Project                | Port | Flow under test                                                       |
| ---------------------- | ---- | --------------------------------------------------------------------- |
| `shadcn-checkout`      | 3030 | `PlanSelector` + `PaymentForm` over shadcn/ui (`asChild`)              |
| `tailwind-checkout`    | 3031 | Same primitives, Tailwind `data-[state=…]` variants                    |
| `chat-checkout-demo`   | 3032 | Anonymous customer, inline `CheckoutSteps` drawer                      |
| `checkout-demo`        | 3033 | Stepped checkout on its own route, dashboard reflects the purchase     |
| `hosted-checkout-demo` | 3034 | Redirect to SolvaPay's hosted checkout and back                        |

Ports sit in the 3030+ band because the platform stack occupies 3001–3012 (and
the demos' own `dev` scripts default into that range).

## Prerequisites

1. **The platform stack, running locally.** From the platform repo:

```bash
npm run local
```

That also starts the Stripe webhook forwarder. The demos need it: every spec
asserts on an _activated purchase_, which only lands once the platform has
processed the payment webhook.

2. **A payable merchant on Stripe test mode.** In the local provider console
   (http://localhost:3010), pick the environment whose Stripe account is in test
   mode — normally **sandbox** — and in it:
   - create a product with at least one **paid, non-usage-based** plan;
   - create a secret key.

Global setup asks the platform for its Stripe publishable key and fails the run
if it is live mode, because the `4242…` test card would be declined there (and a
real card would be a real charge). It checks the platform rather than the key
prefix on purpose: on some local stacks the `live` environment is itself wired to
a Stripe test account, so the prefix proves nothing.

3. **Browsers**: `pnpm exec playwright install chromium`.

## Configure

Copy `.env.example` to `.env` in this directory (gitignored), or export the same
variables:

```bash
SOLVAPAY_API_BASE_URL=http://127.0.0.1:3010   # optional; this is the default
SOLVAPAY_SECRET_KEY=sk_sandbox_...
SOLVAPAY_PRODUCT_REF=prd_...                   # same environment as the key
```

`SOLVAPAY_API_BASE_URL` must point at the **provider-app proxy on :3010** — the
only local process that fans `/v1/*` out across the provider, payment, billing
and commerce services. `:3001` is identity-service alone and will 404.

## Run

```bash
pnpm test:e2e:examples          # from the repo root
pnpm test                       # from this directory
pnpm test --project=shadcn-checkout
pnpm test:headed
pnpm report                     # open the HTML report
```

Projects run serially (`workers: 1`): they share one merchant and one product, so
parallel runs would race each other's purchase state.

## Not part of CI

This suite needs a live stack, a real Stripe test-mode account and a provisioned
merchant, so it is a **manual, local gate** — it is deliberately absent from the
CI pipeline and from `turbo run test`.

## Anonymous mode

`checkout-demo` and `hosted-checkout-demo` document a Supabase integration. The
suite runs them with `NEXT_PUBLIC_SOLVAPAY_DEMO_AUTH=anonymous`, so no Supabase
project is needed: the browser mints a customer ref and each demo's `proxy.ts`
promotes it to the `x-user-id` header the SolvaPay route helpers read. See
`app/lib/auth-mode.ts` in either demo.
