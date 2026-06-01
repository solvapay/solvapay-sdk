# `mcp-checkout-app` — end-to-end smoke test

One reproducible scenario that exercises every layer of the MCP App
(tools, UI shell, prompts, docs resource, demo paywalled tools) and
walks the paid-plan activation UX end-to-end: **Free quota → paywall
→ plan selection → PAYG top-up or recurring subscription → success
receipt + auto-sent chat follow-up**.

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

- `<AppHeader>` shows the merchant logo + display name when the host
  does not paint its own chrome mark. Product name/description are
  **not** repeated inside the account iframe.
- `bootstrap.view === 'account'` by default → `<McpAccountView>`
  renders one primary card (current plan, credits, or pick-a-plan
  empty state). Seller + **Your account** detail cards sit in the
  persistent sidebar on wide iframes (or inline below the card on
  narrow frames).
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

- The response is text-only: `isError: false`,
  `content[0].text` is a narration like _"You don't have an active
  plan for this tool. Call the `upgrade` tool to pick a plan, or
  open https://.../checkout in a browser."_, and
  `structuredContent` carries the `kind: 'payment_required'` gate.
- **No widget iframe opens** — merchant payable tools no longer
  advertise `_meta.ui.resourceUri`.

### 4. Recover via the `upgrade` intent tool

Say "upgrade me" (or have the LLM call `upgrade` directly) based on
the gate narration.

**Expect**:

- `/upgrade` returns a `BootstrapPayload` and the host mounts the
  widget iframe on `McpCheckoutView` at `step: 'plan'`.
- Plan cards render in the order `Pay as you go` → `Pro` (PAYG first,
  then recurring ascending). **No Free card** — it's filtered out.
- PAYG is auto-selected with the `recommended` badge.
- CTA at the bottom reads `Continue with Pay as you go`. Clicking a
  Recurring card flips the CTA to `Continue with Pro — $18/mo`.
- `Stay on Free` text link sits below the CTA. Clicking it sends a
  user message `Sticking with the free tier for now.` to the chat
  and best-effort calls `app.requestTeardown()` — on hosts that
  honor it the iframe closes; on hosts that don't (e.g. MCPJam) the
  iframe lingers but the chat message still signals the agent that
  the customer declined. The triggering call stays failed; future
  within-quota calls continue to work.

### 5a. PAYG branch — activate → top up → confirm

Select **Pay as you go** and click `Continue with Pay as you go`.

**Expect** *(step transitions: plan → amount → payment → success)*:

- Click fires `activate_plan({ planRef: <payg> })` immediately. The
  active PAYG purchase is created server-side (eager activation — no
  credit-balance gate), and the widget advances to `step: 'amount'`.
  BackLink reads `← Back`. Three preset credit tiers render (500 /
  2 000 / 10 000), with `popular` on the 2 000 tier. Custom input is
  available.
- Tap a preset → CTA label updates to `Continue — $18.00`.
- Click Continue. Purely a local transition to `step: 'payment'` —
  activation already happened at the plan step, so the SDK does NOT
  fire `activate_plan` again here. BackLink reads `← Change amount`.
  The order summary + Stripe Elements render inline; a
  `Save card for future top-ups` checkbox sits below.
- Complete the card. SDK fires `create_topup_payment_intent`
  (purpose: `credit_topup`) then `process_payment`. `step: 'success'`.
- Success surface: green check, `Credits added` heading, receipt
  grid (Amount / Credits / Plan / Rate). No CTA — the receipt is
  the terminal state.
- The SDK has already fired `notifySuccess({ kind: 'topup' })` ->
  `app.sendMessage` posting `Topped up $18.00. Ready to keep
  working.` to the chat. The agent picks that up and re-invokes
  the original `/search_knowledge` call automatically.

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
  (Plan / Credits / Charged today / Next renewal), and a muted
  `Manage from /manage_account` pointer. No CTA.
- The SDK has already fired
  `notifySuccess({ kind: 'plan-activated' })` -> `app.sendMessage`
  posting `Activated Pro.` to the chat, so the agent continues
  the conversation as in 5a.

### 6. Change-plan re-entry — no banner

After activation, type `/manage_account` → `See plans` on the current-
plan card.

**Expect**:

- Shell flips to `<McpCheckoutView>`, but `cameFromPaywall=false` so
  the amber banner is **absent** and the `Stay on Free` link is
  hidden. One flag, one visual — same surface, different framing.

### 7. Sidebar stability check

Open the app on a **wide** iframe (>=816px) from the account view.
Switch **Account → Top up → Account**.

**Expect**:

- **Seller** + **Your account** cards stay in the left sidebar on
  wide frames — widgets do not jump when swapping surfaces.
- Resize to narrow (<816px): sidebar hides; the primary action card
  renders first, then **Your account**, then **Seller** inline below.
- No account screen shows product description or a `Current plan and
  usage` overline.

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

- Step 3: gate response ships as a text-only narration — the server's
  state engine (`classifyPaywallState` + `buildGateMessage`)
  produces a message that names the correct recovery intent tool,
  and the host never opens an uninvited iframe on a merchant data
  tool.
- Step 4: `/upgrade` bootstraps the checkout surface on demand; the
  round-trip from gate narration → LLM tool choice → widget mount
  exercises the full cross-package contract.
- Step 5a: `activate_plan` fires on the plan-step `Continue` click —
  one user-visible activation action, and it completes before any
  topup intent is created. For usage-based plans the backend
  activates eagerly (no credit-balance gate), so clicking Continue
  lands an active PAYG purchase even when the balance is zero. The
  subsequent amount-step Continue is purely a local transition. If
  payment later fails, the plan purchase stays live with zero
  balance and the next paywalled tool call classifies as
  `topup_required` (via `paywall-state.ts`), not
  `activation_required` — so the LLM recovers with `topup`, not
  another round of plan picking.
- Step 5a/5b: the success surface has no CTA. The auto-sent
  `notifySuccess` chat message (`Topped up …` / `Activated …`) is
  what continues the conversation, so the flow works on every
  host — including ones that don't honor `app.requestTeardown()`.
- Step 6: change-plan re-entry renders the same surface with the
  banner suppressed — verifies the one-flag invariant from the
  brief's §6.

## Optional automation

A `pnpm --filter @example/mcp-checkout-app smoke` script can drive
`basic-host` through the walkthrough via a scripted MCP client and
assert per-step outcomes. **Deferred** until the manual walkthrough
has been run a few times and identifies steps that regress
repeatably — script-first tends to freeze behaviour prematurely.
