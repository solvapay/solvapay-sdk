# `mcp-checkout-app` — end-to-end smoke test

One reproducible scenario that exercises every layer of the MCP App
(tools, UI shell, prompts, docs resource, demo paywalled tools) and
shows usage-based + unlimited plans side-by-side in a single session.

## Product setup (one-time)

In the SolvaPay admin, create **one product with two plans**:

- **Starter — Pay as you go** · `planType: usage-based` · no monthly
  fee · e.g. $0.01 / query (1 credit per unit) · customer tops up
  before first use.
- **Unlimited — Monthly** · `planType: recurring`, no meter · $100 /
  month · cancellable.

The two-plan shape is the minimum configuration that demonstrates
both metered and unlimited behaviour in a single iframe session.

## Prerequisites

- Backend running at `http://localhost:3001` with your product and
  plans created.
- `.env` set: `SOLVAPAY_SECRET_KEY`, `SOLVAPAY_PRODUCT_REF`,
  `DEMO_TOOLS=true`.
- `basic-host` running at `http://localhost:8080`, pointing at
  `http://localhost:3006/mcp`.
- Stripe CLI listening on the webhook so balance updates reach the
  backend.

```bash
pnpm --filter @example/mcp-checkout-app dev
# in another terminal
basic-host --mcp-url http://localhost:3006/mcp
```

## The 9-step walkthrough

Each step pins a specific behaviour. Layer / phase references in
parentheses map the assertion back to where it's implemented.

### 1. Cold start

User opens the MCP App in `basic-host`. No purchase yet.

**Expect** *(Phases 2, 3, 4)*:

- Tab strip renders `Plan · Activate` (Credits hidden — no
  usage/balance; Top up hidden — no usage-based plan activated yet;
  Account hidden at `xl+` into the sidebar).
- Header shows the merchant logo + display name + "My account".
- Footer shows `Terms · Privacy · Provided by SolvaPay` (if the
  merchant has URLs configured).
- Sidebar on wide iframes: Seller details + Your details (credit
  balance row not present yet).

### 2. Activate the Starter plan

Type `/activate_plan` → pick "Starter — Pay as you go" → Activate.

**Expect** *(existing `activate_plan` smart handler)*:

- `activate_plan` returns `{ status: 'topup_required', topupUrl }`
  because the usage-based plan activates with zero balance.
- Shell routes to Top up tab.

### 3. Top up $10

Stripe Elements mounts inside the iframe (`create_topup_payment_intent`
→ confirm → `process_payment`).

**Expect** *(Phase 4 refresh)*:

- Balance updates to 1000 credits.
- Credits tab appears.
- "Credit balance — 1,000 credits" row populates in the sidebar
  (wide iframes) or the in-panel Customer card (narrow iframes).

### 4. First paywalled call

Type `/search_knowledge query: "hi"`.

**Expect** *(Phase 1 tool + Phase 2 prompt)*:

- Stub snippets returned in the host's transcript.
- Balance decrements to 999. Refresh the Credits tab to see it, or
  check the sidebar row.

### 5. Drain credits

Call `/search_knowledge` until balance hits 0. (Admin can also
zero-out the balance for speed.)

**Expect**:

- Credits tab renders `0 credits remaining`.
- The last call completes normally.

### 6. Paywall fires

Next `/search_knowledge` invocation returns the gate.

**Expect** *(Phase 1 gate response, Phase 4 paywall render)*:

- Host opens the iframe on `view: 'paywall'`.
- `McpPaywallView` renders **two CTAs**:
  - `[ Top up $10 ]` — the primary top-up flow.
  - `[ Upgrade to Unlimited — $100/mo ]` — secondary, derived from
    `bootstrap.plans` (first recurring, non-usage-based plan).
- Tab strip and footer hidden.

### 7. Upgrade to Unlimited

Click the upgrade CTA.

**Expect** *(Phase 4 state-machine transition)*:

- Paywall dismisses locally, shell routes to Plan tab.
- `<McpCheckoutView>` renders — Stripe Elements for the Unlimited
  plan.
- Complete payment → `process_payment` → `refreshBootstrap()`.
- Plan tab shows `Current plan: Unlimited — $100/mo`.

### 8. Verify unlimited

Type `/search_knowledge` again.

**Expect** *(Phase 1 tool + plan state)*:

- Tool returns snippets without gating.
- Credits tab now shows `Unlimited — no limits on this plan` (no
  meter, no top-up link). *(Phase 4 gap-credits-unlimited)*

### 9. Sidebar stability check

Tab through Credits / Plan / Top up / Activate on a **wide** iframe
(>=900px).

**Expect** *(Phase 5)*:

- Seller details + Your details stay mounted across every tab.
- Account does not appear as a tab at this width — its content lives
  in the sidebar.
- Resize to narrow (<900px): Account re-appears in the tab strip,
  sidebar hides, and the same two cards render inside the Account
  tab body (phase 3 enrichment).

## What this surfaces that unit tests don't

- Step 2–3: `activate_plan → topup_required → topup → bootstrap
  refresh` produces the right cache seed without a full remount.
- Step 5–6: paywall gate response shape reaches the iframe cleanly
  (the one genuinely cross-package flow).
- Step 7: plan switch mid-session (usage-based → unlimited) correctly
  swaps the visible tabs and the sidebar content.
- Step 8: unlimited-plan customers bypass the gate cleanly (the
  inverse of step 6 — one call going through, on the same tool).
- Step 9: the responsive sidebar is truly persistent and doesn't
  re-layout on tab switches.

## Optional automation

A `pnpm --filter @example/mcp-checkout-app smoke` script can drive
`basic-host` through the walkthrough via a scripted MCP client and
assert per-step outcomes. **Deferred** until the manual walkthrough
has been run a few times and identifies steps that regress
repeatably — script-first tends to freeze behaviour prematurely.
