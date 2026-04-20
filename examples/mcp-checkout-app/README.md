# MCP checkout app example

An MCP App that launches the SolvaPay **hosted checkout** (and customer
portal) in a new browser tab from inside an MCP host's sandboxed UI
resource. Payment UI lives on `solvapay.com`, not inside the iframe; the
MCP server holds `SOLVAPAY_SECRET_KEY` and exposes five tools
(`open_checkout`, `sync_customer`, `check_purchase`,
`create_checkout_session`, `create_customer_session`).

The earlier iteration of this example tried to embed Stripe Elements
inside the host iframe. That path was abandoned — see
[`solvapay-sdk/.cursor/plans/mcp-checkout-app_hosted-button-pivot_b3d9c1a2.plan.md`](../../.cursor/plans/mcp-checkout-app_hosted-button-pivot_b3d9c1a2.plan.md)
for the rationale. **MCP host iframes block `js.stripe.com` via CSP +
sandbox flags, so embedded Elements cannot render.** Do not re-attempt
the embedded path without new evidence that hosts have relaxed those
constraints.

## Prerequisites

1. SolvaPay backend running (defaults to `http://localhost:3001`; port 3000 is the Next.js frontend)
2. A product with at least one active plan
3. `SOLVAPAY_SECRET_KEY` scoped to that product
4. An MCP host such as [`basic-host`](https://github.com/modelcontextprotocol/basic-host)
   running at `http://localhost:8080`

## Configure

```bash
cp .env.example .env
# Fill in SOLVAPAY_SECRET_KEY and SOLVAPAY_PRODUCT_REF
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
its tool list. The iframe renders a welcome card with an **Upgrade**
button; clicking it opens hosted checkout in a new tab. Complete
payment with a Stripe test card (`4242 4242 4242 4242`) and return to
the host — the card updates to **Manage purchase** automatically.

## Flow

1. Host loads `ui://mcp-checkout-app/mcp-app.html` — a single-file React
   bundle mounting `<SolvaPayProvider>` with the MCP `check_purchase`
   tool as its `checkPurchase` override.
2. On mount the UI calls `open_checkout` to fetch the configured
   `productRef`.
3. `usePurchase` loads the current purchase (via `check_purchase`). The
   UI then pre-fetches a hosted URL for the state it is about to render:
   - No active purchase → `create_checkout_session` → populates the
     Upgrade anchor's `href`
   - Active paid purchase → `create_customer_session` → populates the
     Manage anchor's `href`
   - Cancelled purchase → `create_checkout_session` → populates the
     Purchase Again anchor's `href`
4. The user clicks a real `<a target="_blank">` element. The sandbox
   blocks scripted `window.open` calls that happen after an async tool
   round-trip, but a direct anchor click is permitted.
5. On `focus` / `visibilitychange`, the UI refetches `check_purchase`,
   so returning from the hosted tab flips the card to the up-to-date
   state.

## Tools

| Tool | Purpose |
| --- | --- |
| `open_checkout` | Returns `{ productRef }` so the UI knows which product to charge for |
| `sync_customer` | Ensures the authenticated MCP user exists as a SolvaPay customer |
| `check_purchase` | Fetches the active purchase for the authenticated customer |
| `create_checkout_session` | Returns `{ sessionId, checkoutUrl }` for the SolvaPay hosted checkout |
| `create_customer_session` | Returns `{ sessionId, customerUrl }` for the SolvaPay customer portal |

`returnUrl` on `create_checkout_session` is intentionally unset — there
is no meaningful URL to return to inside an MCP host iframe, so the
SolvaPay backend default is used.

## Known boundaries

- Only the five tools above are shipped. `create_topup_payment_intent`,
  `customer_balance`, `activate_plan`, `cancel_renewal`,
  `reactivate_renewal`, `track_usage`, and `get_merchant` are roadmap —
  see the "After the PoC" section of the superseded PoC plan at
  [`solvapay-sdk/.cursor/plans/mcp-checkout-app_poc_55ffe77e.plan.md`](../../.cursor/plans/mcp-checkout-app_poc_55ffe77e.plan.md).
- Auth comes exclusively from `createMcpOAuthBridge` → `customer_ref`
  on `extra.authInfo`. There is no client-side auth adapter.

## Endpoints

- `GET /health`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `POST /mcp`
- `GET /mcp`
- `DELETE /mcp`
