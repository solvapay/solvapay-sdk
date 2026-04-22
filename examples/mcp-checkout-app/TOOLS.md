# `mcp-checkout-app` — tools cheat-sheet

The server registers 12 SolvaPay tools + (optionally) 2 demo data
tools. Grouped by audience below: what the model sees in `tools/list`
is in the first two tables; the UI-only tools are tagged
`_meta.audience: 'ui'` so hosts that honour the field can hide them
from the agent.

## Intent tools (LLM-callable, dual-audience)

| Tool | Purpose | When to use |
| --- | --- | --- |
| `upgrade` | Start or change a paid plan for the current customer | User says "upgrade", "change plan", "buy", "subscribe" |
| `manage_account` | Show current plan, balance, payment method, cancel/reactivate | User says "my account", "current plan", "cancel", "billing" |
| `topup` | Add SolvaPay credits (pay-as-you-go) | User says "top up", "add credits", "buy credits" |
| `check_usage` | Show used/remaining credits, reset date | User says "how many credits", "usage", "remaining" |
| `activate_plan` | Pick a plan from the picker, or activate a specific `planRef` | User says "activate", or the agent needs to enumerate plans |

All five intent tools now accept an optional `mode: 'ui' | 'text' | 'auto'`
argument:

- `'auto'` (default) — emit both the UI-resource ref on `_meta.ui` and
  the narrated markdown text. Host decides which to render.
- `'text'` — strip the UI-resource ref so UI-capable hosts render text
  only. Useful when the user says "just summarise it in chat".
- `'ui'` — replace the narrated markdown with a short placeholder so
  the transcript stays clean on UI-rendering hosts.

Each returns a `BootstrapPayload` with:

- `view` — which screen to mount (`about` / `checkout` / `account` /
  `topup` / `usage` / `activate`). `manage_account` routes cold-start
  customers (no active purchase) to `'about'` so they land on the
  product description + CTA cards instead of an empty Account body.
- `productRef`, `stripePublishableKey`, `returnUrl` — provisioning for
  the embedded Stripe Elements.
- `merchant`, `product`, `plans`, `customer` — seeded data so the
  iframe never re-fetches.
- `paywall` — populated only when the response is a gate response
  (`view: "paywall"`).

## Shell surface (what the UI renders)

Four tabs render by default (About / Plan / Top up / Account). The
legacy "Credits" and "Activate" tabs are folded away — Credits lives
inside Account; the Activate picker is contextual inside Plan (free /
trial / usage-based cards activate inline, paid cards mount Stripe
Elements).

- **About** — product description (`product.name`, `product.description`,
  `product.imageUrl`), a "Your activity" strip for returning customers
  (four variants: PAYG balance, recurring-unlimited renew date,
  recurring-metered usage bar, free usage bar), two contextual CTA
  cards ("Choose a plan" / "Start free" / "Try without subscribing"),
  and the slash-command hint list.
- **Plan** — picker for cold-start customers; Current plan summary
  with per-variant affordances for returning customers (resolved via
  `resolvePlanActions`).
- **Top up** — three-step flow with shared `BackLink` primitive
  (Amount → Payment → Success; `← Back to my account` on each step).
- **Account** — balance card, usage meter (when present), Current
  plan + Manage billing ↗ + seller details.

A dismissible first-run tour (gated by
`localStorage['solvapay-mcp-tour-seen']`) anchors popovers to the
three core tabs on first launch; a `?` button in the header replays
it.

## Host capability matrix

Which host renders what — important so integrators know which mode to
test against.

| Host | UI iframe | Text | `ui://` resource | Notes |
| --- | --- | --- | --- | --- |
| **Claude Desktop** | ✓ | ✓ (collapsed) | ✓ | Default rendering for the SolvaPay MCP Apps we ship. |
| **Claude Code CLI** | — | ✓ | ignored | Text-only; `**bold**` + `` `code` `` render via ANSI. |
| **Cursor IDE** | ✓ | ✓ | ✓ | Renders UI iframes as of recent builds; falls back cleanly. |
| **ChatGPT MCP connectors** | ✓ | ✓ | via Apps SDK | No slash-command UI; About view lists commands as plain copy. |
| **`basic-host`** | ✓ | ✓ | ✓ | Dev harness; echoes both. |
| **Programmatic (n8n, agents)** | — | ✓ | ignored | Agents parse `structuredContent`; narrated text is secondary. |

## Demo data tools (LLM-callable, paywall-gated)

Enabled when `DEMO_TOOLS !== 'false'` — see
[`src/demo-tools.ts`](src/demo-tools.ts).

| Tool | Purpose | When to use |
| --- | --- | --- |
| `search_knowledge` | Returns 3 deterministic stub snippets for a query | Exercise the paywall from `basic-host` — each call consumes 1 credit |
| `get_market_quote` | Returns a deterministic fake market quote | Second tool so you can show the paywall firing on something other than `search_knowledge` |

Both are wrapped with `solvaPay.payable().mcp()` via `registerPayable`
so the credit balance decrements per call, and the paywall bootstrap
auto-opens when credits hit zero.

## UI-only state-change tools (tagged `_meta.audience: 'ui'`)

| Tool | Purpose |
| --- | --- |
| `create_checkout_session` | Returns `{ sessionId, checkoutUrl }` for hosted checkout (fallback branch) |
| `create_customer_session` | Returns `{ sessionId, customerUrl }` for the SolvaPay customer portal |
| `create_payment_intent` | Creates the Stripe PaymentIntent consumed by the embedded `<PaymentForm>` |
| `process_payment` | Records the Stripe confirmation and creates the SolvaPay purchase |
| `create_topup_payment_intent` | Creates the Stripe PaymentIntent for a top-up |
| `cancel_renewal` | Cancels auto-renewal on an active purchase |
| `reactivate_renewal` | Undoes a pending cancellation |

These are called exclusively by the client-side React primitives
mounted inside the iframe. Hosts that implement `_meta.audience`
should hide them from the agent; hosts that don't see them but are
steered away by the `UI-only; agents should prefer ...` prefix on
their descriptions.

## Slash-command prompts

| Prompt | Args | What it sends |
| --- | --- | --- |
| `/upgrade` | `{ planRef? }` | "Show me the upgrade options" / "Activate plan `planRef`" |
| `/manage_account` | — | "Show me my SolvaPay account" |
| `/topup` | `{ amount? }` | "I want to top up my SolvaPay credits" |
| `/check_usage` | — | "How much SolvaPay credit have I used?" |
| `/activate_plan` | `{ planRef? }` | "What plans can I activate?" / "Activate `planRef`" |
| `/search_knowledge` (demo) | `{ query? }` | "Search the knowledge base for `query`" |
| `/get_market_quote` (demo) | `{ symbol? }` | "Get the current market quote for `symbol`" |

## Docs resource

`docs://solvapay/overview.md` — the narrated "start here" doc. Agents
that call `resources/read` on this URI get a 200-word explanation of
the five intent tools, the dual-audience fallback, and the auth model
before they try any tool. Disable with `registerDocsResources: false`
on `createSolvaPayMcpServer`.
