# MCP checkout app example

An MCP App that runs a **hybrid checkout** inside an MCP host's sandboxed
UI resource. On compliant hosts (hosts that honour the
[MCP Apps spec](https://modelcontextprotocol.io/docs/spec/app)'s
`_meta.ui.csp` extension, e.g. `basic-host`, ChatGPT) the UI mounts
Stripe Elements inline via the SolvaPay SDK's `<PaymentForm>` compound
primitive. On non-compliant hosts (today: Claude, which hardcodes
`frame-src 'self' blob: data:` and ignores `frameDomains`) the UI
detects the block via a runtime probe and falls back to launching
**SolvaPay hosted checkout** in a new browser tab.

The MCP server holds `SOLVAPAY_SECRET_KEY` and exposes the tool set
needed by both paths — hosted
(`open_checkout`, `sync_customer`, `check_purchase`,
`create_checkout_session`, `create_customer_session`,
`get_payment_method`) plus the data-access tools the embedded form
consumes (`create_payment_intent`, `process_payment_intent`,
`list_plans`, `get_product`, `get_merchant`).

Earlier iterations gave up on the embedded path because older host
versions blocked `js.stripe.com` unconditionally — see
[`solvapay-sdk/.cursor/plans/mcp-checkout-app_hosted-button-pivot_b3d9c1a2.plan.md`](../../.cursor/plans/mcp-checkout-app_hosted-button-pivot_b3d9c1a2.plan.md)
for the original rationale. The spec's new `_meta.ui.csp` extension
makes that path viable again on hosts that implement it, and the
runtime probe keeps us safe on hosts that don't.

## Prerequisites

1. SolvaPay backend running (defaults to `http://localhost:3001`; port 3000 is the Next.js frontend)
2. A product with at least one active plan
3. `SOLVAPAY_SECRET_KEY` scoped to that product
4. An MCP host such as [`basic-host`](https://github.com/modelcontextprotocol/basic-host)
   running at `http://localhost:8080`

## Configure

```bash
cp .env.example .env
# Fill in SOLVAPAY_SECRET_KEY and SOLVAPAY_PRODUCT_REF. The Stripe
# publishable key used for embedded Elements is fetched from the
# SolvaPay backend at boot (GET /sdk/platform-config) — no local
# config needed.
```

## Run

```bash
pnpm install
pnpm --filter @example/mcp-checkout-app build
pnpm --filter @example/mcp-checkout-app serve
```

Watch mode (rebuilds the UI bundle and restarts the server on changes):

```bash
pnpm --filter @example/mcp-checkout-app dev
```

Point `basic-host` at `http://localhost:3006/mcp` and open the app from
its tool list. On `basic-host` and ChatGPT the iframe renders inline
Stripe Elements; enter the test card `4242 4242 4242 4242` and pay
without leaving the host. On Claude the probe detects that
`js.stripe.com` cannot iframe and the UI falls back to an **Upgrade**
button that opens hosted checkout in a new tab — returning to the host
refetches `check_purchase` and flips the card to **Manage purchase**.

## Flow

1. Host loads `ui://mcp-checkout-app/mcp-app.html`. The resource
   registration declares `_meta.ui.csp` with Stripe's required
   `resourceDomains` / `connectDomains` / `frameDomains` — hosts that
   implement the spec propagate these to the iframe's CSP.
2. The bundle mounts `<SolvaPayProvider config={{ transport, fetch }}>`.
   `transport = createMcpAppAdapter(app)` from
   [`@solvapay/react/mcp`](../../packages/react/src/mcp) tunnels every
   provider data-access call through `app.callServerTool`. The
   `fetch` prop is a small [shim](./src/mcp-adapter.ts) that reroutes
   the two SDK hooks that still go through HTTP (`usePlan`'s
   `/api/list-plans`, `useProduct`/`useMerchant`'s `/api/get-product`
   and `/api/merchant`) into the same tool calls.
3. On mount the UI calls `open_checkout`. The tool fetches SolvaPay's
   platform Stripe pk from the backend (`GET /sdk/platform-config`,
   resolved sandbox/live against the authenticated provider) and
   returns `{ productRef, stripePublishableKey }`. A `useStripeProbe`
   hook races `loadStripe(publishableKey)` against a 3 s timeout to
   classify the host as `'ready'` (embedded), `'blocked'` (fallback) or
   `'loading'` (spinner). If `/sdk/platform-config` is unreachable or
   the key is unconfigured the tool returns `null` and the hosted
   fallback renders.
4. **Embedded branch (`probe === 'ready'`):** renders the SDK's
   `<PaymentForm.Root>` compound (`Summary` / `PaymentElement` /
   `Error` / `MandateText` / `SubmitButton`). Card entry happens in a
   nested `js.stripe.com` iframe; confirmation goes through
   `create_payment_intent` → Stripe.js `confirmPayment` →
   `process_payment_intent`. Post-purchase the card switches to
   `<CurrentPlanCard>`.
5. **Hosted branch (`probe === 'blocked'`):** the original hosted-button
   experience — `create_checkout_session` populates an
   `<a target="_blank">` anchor, the user completes payment in a new
   tab, and `focus`/`visibilitychange` listeners refetch
   `check_purchase` to auto-flip to **Manage purchase**.

## Tools

| Tool | Purpose |
| --- | --- |
| `open_checkout` | Returns `{ productRef, stripePublishableKey }` so the UI can pick a product and probe Stripe Elements |
| `sync_customer` | Ensures the authenticated MCP user exists as a SolvaPay customer |
| `check_purchase` | Fetches the active purchase for the authenticated customer |
| `create_checkout_session` | Returns `{ sessionId, checkoutUrl }` for the SolvaPay hosted checkout (used by the fallback branch) |
| `create_customer_session` | Returns `{ sessionId, customerUrl }` for the SolvaPay customer portal |
| `get_payment_method` | Returns `{ kind: 'card', brand, last4, expMonth, expYear }` or `{ kind: 'none' }` for the `<CurrentPlanCard>` payment line |
| `create_payment_intent` | Creates the PaymentIntent consumed by the embedded branch's `<PaymentForm>` |
| `process_payment_intent` | Records the Stripe-side confirmation after `confirmPayment` resolves |
| `list_plans` | Returns the plans the embedded `<PaymentForm>` lists for the product |
| `get_product` | Product metadata (name, image, plan refs) for the summary card |
| `get_merchant` | Merchant display data for the summary card |

`returnUrl` on `create_checkout_session` is intentionally unset — there
is no meaningful URL to return to inside an MCP host iframe, so the
SolvaPay backend default is used.

### A note on `stripePublishableKey`

The publishable key `open_checkout` returns is **SolvaPay's platform
key**, sourced from the SolvaPay backend via `GET /sdk/platform-config`
(resolved sandbox/live against the authenticated provider's
environment). It is not the connected merchant's own pk. SolvaPay uses
Stripe Connect direct charges, so the browser-side pattern everywhere
in the SDK is `loadStripe(platformPk, { stripeAccount: connectedAccountId })`
— the merchant's own publishable key is never touched.

The key is forwarded via `open_checkout` purely so `useStripeProbe`
has a syntactically valid pk to pass to `loadStripe()` when testing
whether the host's CSP `frameDomains` lets `js.stripe.com` mount.
The real payment flow re-fetches the same pk (plus the `accountId`
the probe never sees) from `create_payment_intent`, so the probe
value is never fed into `confirmPayment`. If the backend doesn't have
a platform pk configured for the provider's environment, or the
`/sdk/platform-config` call fails for any reason, the tool returns
`null` and every host falls back to the hosted-button branch.

## Known boundaries

- Plan switching (`change_plan`) and inline card-update
  (`create_setup_intent`) are in flight as follow-ups — see
  [`sdk_plan_management_phase2_6e40d833.plan.md`](../../.cursor/plans/sdk_plan_management_phase2_6e40d833.plan.md)
  for the deferred scope. `create_topup_payment_intent`,
  `customer_balance`, `activate_plan`, `cancel_renewal`,
  `reactivate_renewal`, and `track_usage` are roadmap.
- Auth comes exclusively from `createMcpOAuthBridge` → `customer_ref`
  on `extra.authInfo`. There is no client-side auth adapter.
- Post-purchase account management (update card / cancel) stays on the
  hosted customer portal in both branches. The portal isn't safe to
  embed.
- The embedded branch depends on the host honouring `_meta.ui.csp`. The
  runtime probe handles today's non-compliant hosts, but a host that
  declares compliance yet silently strips `frame-src` will cause
  Stripe.js to fail mid-confirmation. If that happens, degrade the probe
  further (e.g. add an explicit `fetch('https://js.stripe.com')` ping)
  rather than disabling the embedded branch.

## Endpoints

- `GET /health`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `POST /mcp`
- `GET /mcp`
- `DELETE /mcp`
