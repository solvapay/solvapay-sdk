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

Each returns a `BootstrapPayload` with:

- `view` — which screen to mount (`checkout` / `account` / `topup` /
  `usage` / `activate`).
- `productRef`, `stripePublishableKey`, `returnUrl` — provisioning for
  the embedded Stripe Elements.
- `merchant`, `product`, `plans`, `customer` — seeded data so the
  iframe never re-fetches.
- `paywall` — populated only when the response is a gate response
  (`view: "paywall"`).

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
