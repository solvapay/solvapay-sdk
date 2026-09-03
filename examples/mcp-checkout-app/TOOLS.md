# `mcp-checkout-app` — tools cheat-sheet

The server registers **10 SolvaPay tools** + (optionally) 3 demo data tools.
Grouped by audience below: what the model sees in `tools/list` is in the
first two tables; the UI-only tools are tagged `_meta.audience: 'ui'` so
hosts that honour the field can hide them from the agent.

## Intent tools (LLM-callable)

| Tool | Purpose | When to use |
| --- | --- | --- |
| `account` | Read-only billing viewer — checkout, account, or topup | User says "upgrade", "change plan", "buy", "subscribe", "my account", "current plan", "cancel", "billing", "top up", "add credits", or "buy credits". Pass optional `view: 'checkout' \| 'account' \| 'topup'`; omit `view` and the server picks (no plan → checkout, out of credits → topup, else account). |
| `activate_plan` | Activate a specific plan by `planRef` | User says "activate" **and** a `planRef` is known. Requires `planRef` — to list plans, call `account` with `view: "checkout"`. |

Slash-command prompts (`/upgrade`, `/manage_account`, `/topup`, `/activate_plan`)
remap onto these two tools with the matching `view` or `planRef`. Prompts cost
zero tool budget.

The viewer accepts an optional `mode: 'ui' | 'text' | 'auto'` argument.
Official MCP Apps / 2026-07-28 tools guidance: `content` is the model and
text-only-host lane; `structuredContent` is for the widget and is often hidden
from the model when `content` is present.
See [`docs/contributing/mcp-apps-host-contract.md`](../../docs/contributing/mcp-apps-host-contract.md).

- `'auto'` (default) — narrated markdown in `content[0]` plus `_meta.ui` on UI
  hosts. `structuredContent` holds the full `BootstrapPayload`.
- `'text'` — strip `_meta.ui` and emit the full narrated markdown for CLI /
  text-only hosts.
- `'ui'` — one-line placeholder in `content[0]` plus `_meta.ui`.

`account` returns a `BootstrapPayload` with:

- `view` — which screen to mount (`checkout` / `account` / `topup`)
- `productRef`, `stripePublishableKey`, `returnUrl` — provisioning for Stripe
  Elements
- `merchant`, `product`, `plans`, `customer` — seeded data so the iframe never
  re-fetches

`activate_plan` is a mutator only — it does **not** return a bootstrap payload
and does not advertise `_meta.ui.resourceUri`.

Merchant paywalled data tools do not return a `BootstrapPayload` — their gate
response is a text-only narration on `content[0].text` (limit + reason +
`` `account` `` with a `view` hint, or `` `activate_plan` `` when a `planRef`
is known) plus the structured gate on `structuredContent`. The model acts from
the text. See the "How paywalls work" section in the `@solvapay/mcp` README.

## Shell surface (what the UI renders)

Each `view` opens a **single-purpose surface** — no tab strip. The widget
cross-navigates between checkout, account, and topup inside the shell without
new tool calls.

- **Checkout** — plan picker / upgrade flow (Stripe Elements or hosted
  checkout fallback).
- **Account** — current plan, balance, usage, payment method, customer portal
  CTA, seller details in the sidebar.
- **Top up** — amount → payment → success with `Back to my account` on each
  step.

There is no About tab — product copy lives in tool descriptions, narrated
`content[0].text`, and `docs://solvapay/overview.md`.

## Host capability matrix

| Host | UI iframe | Text | `ui://` resource | Notes |
| --- | --- | --- | --- | --- |
| **Claude Desktop** | ✓ | ✓ (collapsed) | ✓ | Default rendering for SolvaPay MCP Apps. |
| **Claude Code CLI** | — | ✓ | ignored | Text-only; markdown renders via ANSI where supported. |
| **Cursor IDE** | ✓ | ✓ | ✓ | Renders UI iframes; falls back cleanly. |
| **ChatGPT MCP connectors** | ✓ | ✓ | via Apps SDK | Slash commands surface as prompts, not tool names. |
| **`basic-host`** | ✓ | ✓ | ✓ | Dev harness; echoes both. |
| **Programmatic (n8n, agents)** | — | ✓ | ignored | Read `content[0].text`; treat `structuredContent` as a bonus. |

## Demo data tools (LLM-callable, paywall-gated)

Enabled when `DEMO_TOOLS !== 'false'` — see [`src/demo-tools.ts`](src/demo-tools.ts).

| Tool | Purpose |
| --- | --- |
| `search_knowledge` | Deterministic stub snippets — exercises the paywall |
| `get_market_quote` | Deterministic fake quote — second paywall demo |
| `query_sales_trends` | Sales rows + optional low-balance **nudge** |

When credits hit zero the tool returns a **text-only gate** naming
`` `account` `` with the appropriate `view` (or `` `activate_plan` `` when
activation is the recovery path).

## UI-only state-change tools (tagged `_meta.audience: 'ui'`)

| Tool | Purpose |
| --- | --- |
| `create_hosted_session` | Hosted checkout or customer portal URL (`kind: "checkout" \| "portal"`) |
| `create_payment_intent` | Stripe PaymentIntent for plan checkout or top-up (`purpose: "plan" \| "topup"`) |
| `process_payment` | Confirm payment + create purchase |
| `attach_business_details` | Tax computation on the Payment step |
| `set_renewal` | Toggle auto-renewal (`enabled: true \| false`) |

Called exclusively from the iframe via `createMcpAppAdapter`. Descriptions
steer agents toward `` `account` `` / `` `activate_plan` `` instead.

## Slash-command prompts

| Prompt | Maps to |
| --- | --- |
| `/upgrade` | `account` with `view: "checkout"` |
| `/manage_account` | `account` with `view: "account"` |
| `/topup` | `account` with `view: "topup"` |
| `/activate_plan` | `activate_plan` when `planRef` known; else `account` + checkout |

Demo prompts (`/search_knowledge`, etc.) are unchanged — see source.

## Docs resource

`docs://solvapay/overview.md` — narrated "start here" for the two intent tools,
dual-audience fallback, and auth. Disable with `registerDocsResources: false`.
