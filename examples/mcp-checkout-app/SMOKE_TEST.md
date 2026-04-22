# `mcp-checkout-app` — end-to-end smoke test

One reproducible scenario that exercises every layer of the MCP App
(tools, UI shell, prompts, docs resource, demo paywalled tools) and
walks the paid-plan activation UX end-to-end: **Free quota → paywall
→ plan selection → PAYG top-up or recurring subscription → success →
"Back to chat"**.

## Product setup (one-time)

In the SolvaPay admin, create **one product with three plans** so the
activation flow is reachable without admin-side balance zeroing:

- **Free** · `type: free` / `requiresPayment: false` · quota of ~50
  calls / month · auto-activated on sign-in. This is the ambient
  default — customers start here and never see the activation
  surface while they're under quota.
- **Pay as you go** · `type: usage-based` · `$0.01 / query`
  (1 credit per unit) · no monthly fee. Featured as the
  `recommended` card on the activation surface.
- **Pro** · `type: recurring` · `$18 / month` · 2 000 credits
  included · no meter. Auto-renews.

The three-plan shape exercises both activation branches from the
paid-plan-activation brief: PAYG (`plan → amount → payment → success`)
and Recurring (`plan → payment → success`). The Free plan is filtered
out of the plan-selection surface — it shows paid options only.

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

## The walkthrough

Each step pins a specific behaviour of the three-surface framework
(account · checkout · paywall) and the paid-plan activation
state machine.

### 1. Cold start — Free plan active

Fresh customer opens the MCP App in `basic-host`.

**Expect**:

- Shell header shows the **product name** (`bootstrap.product.name`)
  as `<h1>`; the merchant logo + display name sit above as the
  brand marker.
- `bootstrap.view === 'account'` by default → `<McpAccountView>`
  renders: current-plan card showing `Free`, balance / usage row,
  `See plans` link to upgrade.
- Text-only hosts (Claude Code, basic-host stdout) see the narrated
  markdown summary instead of the UI iframe — same data, different
  render.
- Footer shows `Terms ↗ · Privacy ↗ · Provided by SolvaPay` (if the
  merchant has URLs configured).

### 2. First paywalled calls under Free quota

Type `/search_knowledge query: "hi"` a few times.

**Expect**:

- Each call runs silently — tool returns deterministic stub snippets.
- Usage counter ticks up; `activePurchase.limit` (50) caps the month.
- No iframe opens. The tool feels free because the handler runs and
  only the Free-plan quota drains.

### 3. Exhaust Free quota → paywall fires

Call `/search_knowledge` until the counter hits 50. The next call
returns a gate.

**Expect**:

- Host opens the iframe on `view: 'paywall'`. `<McpPaywallView>`
  renders with the `payment_required` copy ("quota exhausted") plus
  the `Upgrade to <plan>` secondary CTA derived from `bootstrap.plans`.
- Chrome suppressed: no sidebar, no footer.

### 4. Click through to activation

Click the `Upgrade to —` CTA.

**Expect**:

- `McpAppShell` flips `paywallDismissed=true`, sets
  `cameFromPaywall=true`, and swaps the body to `<McpCheckoutView>`
  at `step: 'plan'`.
- Amber `Upgrade to continue` banner renders at the top — the
  customer came from the paywall, so the flag is on.
- Plan cards render in the order `Pay as you go` → `Pro` (PAYG first,
  then recurring ascending). **No Free card** — it's filtered out.
- PAYG is auto-selected with the `recommended` badge.
- CTA at the bottom reads `Continue with Pay as you go`. Clicking a
  Recurring card flips the CTA to `Continue with Pro — $18/mo`.
- `Stay on Free` text link sits below the CTA. Clicking it calls
  `app.requestTeardown()` — the iframe closes and the customer
  stays on Free (the triggering call stays failed, but future
  within-quota calls continue to work).

### 5a. PAYG branch — activate → top up → confirm

Select **Pay as you go** and click `Continue with Pay as you go`.

**Expect** *(step transitions: plan → amount → payment → success)*:

- `step: 'amount'`. BackLink reads `← Back`. Three preset credit
  tiers render (500 / 2 000 / 10 000), with `popular` on the 2 000
  tier. Custom input is available.
- Tap a preset → CTA label updates to `Continue — $18.00`.
- Click Continue. SDK fires `activate_plan({ planRef: <payg> })`,
  then `step: 'payment'`. BackLink reads `← Change amount`. The
  order summary + Stripe Elements render inline; a
  `Save card for future top-ups` checkbox sits below.
- Complete the card. SDK fires `create_topup_payment_intent` then
  `process_payment`. `step: 'success'`.
- Success surface: green check, `Credits added` heading, receipt
  grid (Amount / Credits / Plan / Rate), `Back to chat` CTA.
- Click `Back to chat`. SDK fires `onRefreshBootstrap()` then
  `app.requestTeardown()`. The host unmounts the iframe; the chat
  re-invokes the original `/search_knowledge` call and it runs
  silently.

### 5b. Recurring branch — pay → confirm

Alternative path: select **Pro** in step 4 instead of PAYG.

**Expect** *(step transitions: plan → payment → success)*:

- Click `Continue with Pro — $18/mo`. SDK skips the amount picker
  and jumps straight to `step: 'payment'`.
- BackLink reads `← Change plan`. Order summary shows
  `Pro · monthly` and `2 000 credits included`. No Save-card
  checkbox (the card is required to maintain the subscription).
- Terms line under the Stripe Elements: _"By subscribing, you agree
  Pro renews at $18/month until you cancel."_
- Click `Subscribe — $18.00 / monthly`. SDK fires
  `create_payment_intent` (subscription flag) then `process_payment`.
- Success surface: green check, `Pro active` heading, receipt grid
  (Plan / Credits / Charged today / Next renewal), a muted
  `Manage from /manage_account` pointer (not a CTA), and `Back to
  chat`.
- `Back to chat` → refresh + teardown as in 5a.

### 6. Change-plan re-entry — no banner

After activation, type `/manage_account` → `See plans` on the current-
plan card.

**Expect**:

- Shell flips to `<McpCheckoutView>`, but `cameFromPaywall=false` so
  the amber banner is **absent** and the `Stay on Free` link is
  hidden. One flag, one visual — same surface, different framing.

### 7. Sidebar stability check

Open the app on a **wide** iframe (>=900px) from the account view.

**Expect**:

- Seller details + Your details persistent in the right-hand
  sidebar. Resize to narrow (<900px): sidebar hides, the detail
  cards inline into the account body.

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

- Step 3: paywall gate response shape reaches the iframe cleanly
  (the one genuinely cross-package flow — server `PaywallError`
  serializes through `structuredContent` onto the bootstrap payload
  and the shell takes over the surface on `view: 'paywall'`).
- Step 4: `cameFromPaywall` signal stays on across the paywall →
  checkout surface swap and off on the `McpAccountView` →
  checkout swap — without that, the banner and `Stay on Free` link
  would either never show or always show (both wrong).
- Step 5a: `activate_plan` fires **before** `create_topup_payment_intent`
  so the active plan is PAYG by the time the topup lands — not the
  other way around. Previously the SDK ran activation lazily via
  `ActivationFlow` and relied on the server's `topup_required`
  response to re-sequence the flow; the brief's replacement wires
  the ordering explicitly.
- Step 5a/5b: `app.requestTeardown()` gets called on `Back to chat`
  after `onRefreshBootstrap` finishes, so the host sees a fresh
  bootstrap before unmounting.
- Step 6: change-plan re-entry renders the same surface with the
  banner suppressed — verifies the one-flag invariant from the
  brief's §6.

## Optional automation

A `pnpm --filter @example/mcp-checkout-app smoke` script can drive
`basic-host` through the walkthrough via a scripted MCP client and
assert per-step outcomes. **Deferred** until the manual walkthrough
has been run a few times and identifies steps that regress
repeatably — script-first tends to freeze behaviour prematurely.
