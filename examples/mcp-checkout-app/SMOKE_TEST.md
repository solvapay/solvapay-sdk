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

## The 10-step walkthrough

Each step pins a specific behaviour.

### 0. First-run tour

On first launch (`localStorage['solvapay-mcp-tour-seen']` unset), a
3-step popover tour fires, anchoring to the About / Plan / Account
tabs. Skip / Next / Done dismiss it; the flag persists across
sessions. A `?` button in the shell header replays it at any time.

### 1. Cold start

User opens the MCP App in `basic-host`. No purchase yet.

**Expect**:

- Shell header shows the **product name** (`bootstrap.product.name`)
  as `<h1>`; the merchant logo + display name sit above as the
  brand marker.
- Tab strip renders `About · Plan` by default. The `Top up` tab
  joins when a usage-based plan exists on the product; `Account`
  joins once the customer authenticates.
- Active tab is **About**: product description + two contextual CTA
  cards (`Choose a plan` / `Try without subscribing` or `Start free`)
  + slash-command hint list.
- Text-only hosts (Claude Code, basic-host stdout) see the narrated
  markdown summary instead of the UI iframe — same data, different
  render.
- Footer shows `Terms ↗ · Privacy ↗ · Provided by SolvaPay` (if the
  merchant has URLs configured) — trailing `↗` glyph marks links
  that open in a new tab.
- Sidebar on wide iframes: Seller details + Your details (credit
  balance row not present yet).

### 2. Activate the Starter plan (merged Plan tab)

Click the **Plan** tab → select "Starter — Pay as you go" card. The
picker inspects `planType` and branches via `resolveActivationStrategy`:
- Free / trial / zero-priced cards → inline `ActivationFlow` summary +
  Activate button.
- Usage-based cards → `Add credits & start` button that routes to the
  Top up tab (no nested amount picker).
- Paid recurring cards → `PaymentForm` + Stripe Elements inline.

The standalone **Activate** tab is gone; the picker lives inside Plan
and is contextual. The legacy `McpActivateView` component stays
exported as a `views.activate` override for integrators who want the
old surface.

### 3. Top up $10 (three-step flow with back-nav)

Stripe Elements mounts inside the iframe (`create_topup_payment_intent`
→ confirm → `process_payment`).

**Expect**:

- Each step exposes a `← Back to my account` link (BackLink primitive)
  above the body; the Payment step also shows `← Change amount`.
- Balance updates to 1000 credits.
- The former Credits tab is folded into **Account**: the Balance card
  + usage meter render inline there.

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

**Expect**:

- Tool returns snippets without gating.
- About's "Your activity" strip switches to the unlimited variant
  (`<plan> — no limits on this plan` + billing cycle).
- Account tab's plan card shows `Unlimited` + `Manage billing ↗`.

### 9. Sidebar stability check

Tab through About / Plan / Top up on a **wide** iframe (>=900px).

**Expect** *(Phase 5)*:

- Seller details + Your details stay mounted across every tab.
- Account does not appear as a tab at this width — its content lives
  in the sidebar.
- Resize to narrow (<900px): Account re-appears in the tab strip,
  sidebar hides, and the same two cards render inside the Account
  tab body (phase 3 enrichment).

### 10. Replay the tour

Click the `?` button in the shell header.

**Expect**:

- `resetTourDismissal()` clears the `localStorage` flag.
- The 3-step popover overlay re-fires starting on the About tab.
- Skip / Next / Done dismiss the tour and re-persist the flag.

### Narrated text fallback (any step, text-only host)

Run any intent tool from Claude Code or the basic-host stdout mode
(or pass `mode: 'text'` explicitly):

**Expect**:

- `content[0]` is a markdown block: `**<Product> — <view>**` title +
  `Label: value` rows + a single `Commands: /...` line.
- External URLs come through as `resource_link` content blocks
  (portal link when the server provides one).
- `structuredContent` still carries the full `BootstrapPayload` for
  agents to parse.

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
