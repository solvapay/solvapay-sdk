# `mcp-checkout-app` — end-to-end smoke test

One reproducible scenario that exercises every layer of the MCP App
(tools, UI shell, prompts, docs resource, demo paywalled tools) and
walks the paid-plan activation UX end-to-end: **Free quota → paywall
→ plan selection → pay-as-you-go top-up or recurring subscription →
success receipt + auto-sent chat follow-up**.

## Where to run it

Three ways in, from closest to a real customer to most local:

| Target                                                                       | MCP endpoint                                                        | Tools you get                                                                                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Deployed dev demo** (`examples/cloudflare-workers-mcp`, `pnpm deploy:dev`) | `https://goldberg-demo-dev.solvapay.app/mcp`                        | `account`, `activate_plan`, `predict_price_chart`, `predict_direction`. No `search_knowledge`, `get_market_quote` or preview tools. |
| **This example against dev**                                                 | `http://localhost:3006/mcp`, backend `https://api-dev.solvapay.com` | All of them (see `TOOLS.md`).                                                                                                       |
| **This example against a local platform stack**                              | `http://localhost:3006/mcp`, backend `http://localhost:3010`        | All of them. Create the product below on your local merchant first.                                                                 |

To run this example against dev, put the dev merchant's values in `.env`
(the server reads `.env`, not `.env.dev`):

```
SOLVAPAY_SECRET_KEY=sk_sandbox_…        # the Goldberg dev merchant's sandbox key
SOLVAPAY_PRODUCT_REF=prd_UAZ0BMM4       # "The Oracle"
SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com
MCP_PUBLIC_BASE_URL=http://localhost:3006
```

Keep `MCP_PUBLIC_BASE_URL` on your local address. A copied `.env.dev` that
points it at `goldberg-demo-dev.solvapay.app` sends OAuth to the deployed
worker instead of this server. `DEMO_TOOLS` defaults to on.

```bash
pnpm --filter @example/mcp-checkout-app dev
# in another terminal
basic-host --mcp-url http://localhost:3006/mcp
```

Any MCP client works in place of `basic-host` (MCP Inspector, MCPJam,
Claude, ChatGPT). Sign-in is SolvaPay's customer sign-in on dev
(`customer-dev.solvapay.com`, email code). Use a new email address so the
customer starts on the Free plan. Payments are Stripe test mode: card
`4242 4242 4242 4242`, any future expiry and CVC.

## The dev product

"The Oracle" (`prd_UAZ0BMM4`) on the Goldberg Inc. dev merchant has three
plans:

| Plan              | Type          | Price             | Notes                                                                      |
| ----------------- | ------------- | ----------------- | -------------------------------------------------------------------------- |
| **Free**          | recurring, $0 | —                 | 3 requests per month, blocks when used up. Assigned to every new customer. |
| **Pay as you go** | usage-based   | $2.00 per request | 20,000 credits per request. No monthly fee.                                |
| **Unlimited**     | recurring     | $500.00 per month | No meter.                                                                  |

On a local stack, create the same three plans, or adjust the counts below
to your own. The walkthrough needs one free plan with a small cap, one
usage-based plan and one recurring plan.

## The walkthrough

Each step pins a specific behaviour of the three-surface framework
(account · checkout · paywall) and the paid-plan activation state
machine. Tool names are the ones this example registers; on the deployed
dev demo, use `predict_direction` wherever a step says `search_knowledge`
or `get_market_quote`.

### 1. Cold start — Free plan active

A new customer opens the MCP App and calls `account`.

**Expect**:

- `<AppHeader>` shows the merchant logo and display name ("Goldberg
  Inc.") when the host doesn't draw its own. Product name and
  description are **not** repeated inside the account iframe.
- With no `view`, the server picks one (no plan → checkout, out of
  credits → top-up, otherwise account). On the Free plan that's
  `<McpAccountView>`: one primary card under **Your plan**, with the
  plan name and its facts in the card itself, not in a nested box.
- Text-only hosts (Claude Code, `mode: "text"`) get the narrated
  markdown instead of the iframe. On dev it reads like:
  _"The Oracle is on the free plan: 3 of 3 calls left this month,
  resetting …. Credits are not used on Free. Call `account` with view:
  'checkout' for more calls."_ followed by `Signed in as`, and
  **Manage** and **Checkout** links that expire in 15 minutes.
- Footer shows `Terms ↗ · Privacy ↗ · Provided by SolvaPay` when the
  merchant has those URLs configured.

### 2. Paid calls under the Free quota

Call `/search_knowledge query: "hi"` (or `predict_direction symbol:
"NVDA"`) three times.

**Expect**:

- Each call runs and returns the tool's result.
- No iframe opens. The tool feels free because the handler runs and
  only the Free plan's included requests are used.

### 2b. Shared free allowance — mix the preview tools

_This example only, not the deployed dev demo._

The two preview tools share one free allowance of five calls per 30
days, separate from the Free plan's requests. Mix them so sharing is
what you test, not a per-tool cap.

1. Call `/preview_market_quote symbol: "AAPL"` three times.
2. Call `/preview_company_profile symbol: "AAPL"` twice. The second of
   these is the fifth call overall and carries the last-preview
   **nudge**.
3. Call either preview tool a sixth time.

**Expect**:

- The first five calls return preview data (`isError: false`).
- The fifth call adds the nudge naming `get_market_quote` and `account`
  with `view: "checkout"`.
- The sixth call is a text-only gate: `paywallReason: 'limit_reached'`,
  `used` / `limit` on the free meter, and the paid plans. No iframe.
- `get_market_quote` still runs on the Free plan's requests afterwards:
  preview calls don't use them up.

### 3. Free quota used up → paywall

Make a fourth paid call.

**Expect**:

- A text-only gate: `isError: false`, `structuredContent.kind` is
  `payment_required`. On dev the narration reads like _"You've used 3
  of 3 included requests this period. Or switch plan: [Pay as you
  go](…) · [Unlimited](…) (first link used closes the rest; links
  expire in 15 minutes). Call the `account` tool with view: 'account'
  for usage and recovery."_
- **No widget iframe opens**: merchant paid tools don't advertise
  `_meta.ui.resourceUri`.

### 4. Pick a plan

Say "upgrade me", or use the `/upgrade` prompt. Both end up as
`account` with `view: "checkout"`. `/upgrade`, `/manage_account` and
`/topup` are prompts, not tools.

**Expect**:

- The widget opens `<McpCheckoutView>` on the plan step, headed
  **Choose a plan**, with the amber **Upgrade to continue** banner,
  because the customer came from a paywall.
- Paid plans only, pay-as-you-go first: **Pay as you go**, then
  **Unlimited**. No Free card.
- A `Stay on Free` link sits under the button. Clicking it posts
  `Sticking with the free tier for now.` to the chat and asks the
  host to close the iframe (`app.requestTeardown()`). Hosts that ignore
  that (MCPJam) leave the iframe open; the chat message still tells the
  agent. The refused call stays refused.
- Text mode lists the plans with their `planRef`s and a checkout link.

### 5a. Pay as you go — activate, then top up

Pick **Pay as you go** and continue (or call `activate_plan` with
`planRef: "pln_QAU9YZSD"`).

**Expect**:

- `activate_plan` **activates the plan straight away, even with a $0
  balance** (`status: "activated"` and a `purchaseRef`). Usage-based
  plans activate first and meter at use (platform DEV-690, since 12 Aug
  2026). They no longer answer `topup_required` here.
- The widget moves to the amount step. USD presets are **$10, $50,
  $100 and $500**, plus a custom amount. The back link reads
  `← Change amount` once you're past it.
- Make a paid call before topping up: it's refused with
  `reason: "topup_required"`, `nextAction: "topup"`. On dev: _"Out of
  credits for this call. Balance 0 credits (~$0.00); this call costs
  20,000 credits (~$2.00) — 20,000 short. [Add credits](…) …, or call
  the `account` tool with view: 'topup'."_
- Pay with the test card. The success screen is headed
  **Credits added**, with no button: the receipt is the end state.
- The SDK posts `Topped up $<amount>. Ready to keep working.` to the
  chat (`notifySuccess({ kind: 'topup' })`), and the agent retries the
  refused call.
- The retried call runs and uses 20,000 credits.

### 5b. Recurring — pay, then confirm

Alternative to 5a: pick **Unlimited**.

**Expect**:

- No amount step: straight to payment.
- The terms line starts _"By subscribing, you authorize Goldberg Inc.
  to charge $500.00 …"_.
- After paying, the success screen is headed **Unlimited active**, with
  **Charged today** and **Next renewal** in the receipt and a pointer
  to `/manage_account`. No button.
- The SDK posts `Activated Unlimited.` to the chat
  (`notifySuccess({ kind: 'plan-activated' })`), so the agent carries
  on as in 5a.

### 6. Change plan later — no banner

After activating, open `/manage_account` and click **Change plan** (or
**Upgrade** on Free) on the plan card.

**Expect**:

- The checkout view opens without the amber banner and without the
  `Stay on Free` link, because the customer didn't come from a
  paywall.

### 7. Paying as

From the account view, open **Top up** and go to the payment step, then
back to the amount step.

**Expect**:

- `Paying as {email}` appears only on the payment step, in the form
  column.
- The amount step, plan picker and account view don't show it, and
  there's no **Seller** or **Your account** sidebar.

### Narrated text fallback (any step, text-only host)

Call `account` with `mode: "text"` from Claude Code or another
text-only client.

**Expect**:

- `content[0]` is markdown: a `**The Oracle — …**` title, `Label: value`
  rows, then links.
- External URLs also come as `resource_link` content blocks.
- `structuredContent` still carries the full `BootstrapPayload`.

## What this surfaces that unit tests don't

- **Step 3:** the gate is a text-only narration from the server
  (`classifyPaywallState` + `buildGateMessage`) that names the right
  recovery, and the host never opens an uninvited iframe on a merchant
  data tool.
- **Step 4:** the checkout opens on demand from the gate. The round
  trip from narration to the model's tool choice to the widget
  exercises the contract across packages.
- **Step 5a:** a usage-based plan activates at a $0 balance and the
  next paid call asks for credits (`topup_required`, via
  `paywall-state.ts`), so the model recovers with a top-up, not another
  round of plan picking.
- **Steps 5a/5b:** the success screen has no button. The chat message
  `notifySuccess` sends (`Topped up …` / `Activated …`) is what carries
  the conversation on, so the flow works on hosts that ignore
  `app.requestTeardown()`.
- **Step 6:** the same checkout view renders with the banner
  suppressed when the customer didn't come from a paywall.

## Last checked against dev

26 Nov 2026, on the deployed dev demo (SDK `dev` at `08f39582`):

- Steps 1–3 passed.
- 4 passed in text mode.
- 5a passed up to the top-up: activation at $0 and the `topup_required` refusal.

The top-up payment, 5b, 6, 7 and the widget screens weren't run then.

## Optional automation

A `pnpm --filter @example/mcp-checkout-app smoke` script could drive
`basic-host` through the walkthrough via a scripted MCP client and
assert per-step outcomes. **Deferred** until the manual walkthrough has
been run a few times and identifies steps that regress repeatably —
script-first tends to freeze behaviour prematurely.
