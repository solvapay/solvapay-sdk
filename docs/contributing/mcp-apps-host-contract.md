# MCP Apps host contract — what applies to the SolvaPay SDK

Research companion to [DEV-867](https://linear.app/solvapay/issue/DEV-867/improve-mcp-gating-user-flow-for-text-only-hosts). Records what the MCP specs and Anthropic's guidance say about tool-result flow, host capability detection, and payment handoff, and what each item validates or contradicts in our design.

§5 is the product bar — the script a change has to pass before it is done. Sources are listed in full at the end. Where something is a SEP still in flight rather than settled normative text, it is marked as such.

## 1. Field destinations — the finding that drives everything else

Anthropic's MCP Apps talk states that a tool result's three fields have three different audiences:

- **`content` goes to the model** and to text-only hosts. Keep it short. When the app renders the output, the model needs just enough to know what was displayed.
- **`structuredContent` is typed data the app reads**, optimised for UI rendering. The model *may or may not* see it — **when `content` is also present, `structuredContent` is hidden from the model.**
- **`_meta` goes to the app only.** The model never sees it.

This is not one team's convention. Two clarification SEPs say the same in normative language:

- **SEP-1624** — `content` is "model-oriented output optimized for readability and token efficiency"; `structuredContent` is "machine-oriented output for programmatic tool use." When both are present they **MUST be semantically equivalent** — same information, different presentation.
- **SEP-2200** — "Clients SHOULD use `content` for model context, fall back to `structuredContent` only if `content` is empty" and "Clients SHOULD NOT forward both fields verbatim to the model." The C# SDK is inverting its existing precedence to match.

### What this means for us

We had built the opposite assumption into the contributor rules ("agent grounding lives on `structuredContent`"). That sentence has been removed from [`mcp-apps-sdk-rules.md`](./mcp-apps-sdk-rules.md) and the matching `.cursor/rules` copy.

The assumption is still in the source — `paywallToolResult.ts:69-77`, `payable-handler.ts:151-157`, and `helpers.ts:270-286`, where `mode: 'ui'` puts `uiPlaceholder(...)` in `content[0]` and the entire `BootstrapPayload` on `structuredContent`. That is the Grok Bot failure mode: the model receives `"Opened … upgrade. Plans and checkout are shown in the panel."` and, on a conforming host, nothing else — precisely because `content` was present.

A second violation worth naming: semantic equivalence. A one-line placeholder against a full bootstrap payload is not "the same information in a different presentation."

**Rule: anything the model or a text-only user must act on goes in `content[0].text`.** `structuredContent` serves the widget and programmatic consumers, and is never the only copy.

## 2. Graceful degradation is normative, not advisory

The MCP Apps specification (2026-01-26) is explicit, and this is the strongest external backing for the ticket:

> - Servers SHOULD provide text-only fallback behavior for all UI-enabled tools
> - **Tools MUST return meaningful content array even when UI is available**
> - Servers MAY register different tool variants based on host capabilities

And on the host side: *"If host does not support MCP Apps, tool behaves as standard tool (text-only fallback)."*

A one-line "shown in the panel" placeholder does not satisfy "meaningful content array." The Ruby SDK's MCP Apps guide states the same rule as a one-liner: *"The extension is optional: always return a meaningful text result."*

## 3. What this changes in implementation

### 3a. Keep the narration short, not just present

*"content goes to the model. Keep it short."* Our narrators emit a full markdown block (title, plan list, balance row, commands line). Sending that on every intent call, including on hosts that also render the iframe, is the token waste MCP Apps exists to eliminate.

The resolution is not to go back to a placeholder. The short line must be **self-sufficient**: plan, remaining or balance, reason, one recovery tool, and the https URL, in one or two lines. Trim the narrators rather than adding rows to them.

### 3b. The checkout URL is a 15-minute bearer credential

Verified against the platform, not assumed:

- **TTL is 15 minutes**, set in `payment-service/src/handlers/checkout-command.handler.ts:131`, enforced on read in `checkout-hydrated-session.flow.ts:73-78` and by a 5-minute cron sweep. `expired` is terminal.
- **Nothing external forces this.** The platform never creates Stripe Checkout Sessions — it uses PaymentIntents with Elements. The 15 minutes is entirely our own choice.
- **Price is not the reason.** `selectPlanForCheckoutSessionFlow` re-resolves the plan and overwrites the frozen `amount`/`metadata.plan` on selection, and the customer-app triggers that on page load. A stale link would not sell at a stale price.
- **The session id is an unauthenticated bearer capability.** `CheckoutSessionPublicController` (`checkout-session.ui.controller.ts:112-137`) carries no guard, where its siblings have `JwtAuthGuard` and `SecretKeyAuthGuard`. Possession of the 32-hex id alone exposes the customer's name, email and `externalRef`, and permits `select-plan`, `select-topup-amount`, `business-details` and payment.
- **There is no stable entry point.** `createCustomerSession` produces `/customer/manage?id=<id>` on the identical bearer design, also defaulting to 15 minutes. No URL keyed by `productRef` + `customerRef` exists anywhere.

So expiry is not incidental — it is the mitigation that makes a guardless bearer URL acceptable. Which reframes the problem: putting this URL in `content[0].text` is not primarily an expiry annoyance, it is **placing a credential into model context and the chat transcript**, where the host may log it, retain it, or render it to someone else. Anthropic's "don't pass tokens through tool results" is about exactly this, and our URL is a token.

This is pre-existing, not introduced here: `buildGateMessage` already inlines `checkoutUrl`, and `mcp-virtual-tool.service.ts:383` emits it as a markdown link. The change makes it more prominent, which is why it is the right moment to decide.

Do not extend the TTL as the fix — that trades security for convenience and does nothing about transcript retention. In scope: state validity inline, and make sure an expired link offers a real re-entry rather than a 404 or a silent redirect. Out of scope but worth raising: 15 minutes is a redirect-flow TTL applied to a conversational flow. The durable fix is a non-credential entry point — a stable link keyed to product plus customer that authenticates the customer and mints the session server-side. That is platform work.

### 3c. Capability detection has a real API — follow-up, not this ticket

MCP Apps support is negotiated through the standard extensions mechanism (SEP-1724) under the identifier `io.modelcontextprotocol/ui`. Clients advertise it at `initialize`:

```json
{
  "capabilities": {
    "extensions": {
      "io.modelcontextprotocol/ui": { "mimeTypes": ["text/html;profile=mcp-app"] }
    }
  }
}
```

Servers are told to check it before registering UI-enabled tools, via a provided helper:

```ts
server.server.oninitialized = () => {
  const uiCap = getUiCapability(server.server.getClientCapabilities())
  if (uiCap?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) {
    // register UI-enabled variant
  } else {
    // register text-only variant
  }
}
```

The Python SDK ships this as `client_supports_apps(ctx)`, Ruby as `MCP::Apps.client_supports?`. The logic is a lookup in `capabilities.extensions` plus a MIME-type check.

We do none of it — `hideToolsByAudience.ts:110-141` matches `/openai-mcp/i` against the user agent or client name instead, which is why `mastercard-mcp-demo` needs a hand-ported `bypassWhen` for Claude.ai web. Two constraints when this is picked up: the ChatGPT user-agent bypass must stay (ChatGPT uses its own Apps SDK and may not advertise the extension, so this is an addition, not a swap), and client capabilities must be verified reachable under `responseMode: 'json'` before anything is built on them.

**Deliberately out of scope for DEV-867.** Text-first narration must land regardless of what any host advertises; capability detection is an optimisation on top of a floor that has to work anyway.

## 4. URL-mode elicitation — the protocol-native checkout handoff

SEP-1036 added `mode: 'url'` to elicitation in spec revision 2025-11-25, with payments as an explicit motivating case; the normative text forbids using form mode for payment credentials. The server sends `elicitation/create` with `{ mode: 'url', url, message, elicitationId }`, the client asks the user to consent to opening it, and the server later fires `notifications/elicitation/complete` with the same id. A tool may also reject up front with `-32042`. The TypeScript SDK's official example for this is a payment confirmation flow.

This is a better handoff than a pasted URL — explicit, live, user-consented — and it largely dissolves §3b, because the link is opened in the moment rather than recovered from a transcript.

It is capability-gated (clients declare `elicitation: { url: {} }`), so it layers on top of the text path rather than replacing it:

1. Host declares MCP Apps → open the widget.
2. Host declares `elicitation.url` → URL-mode elicitation.
3. Neither → checkout URL in `content[0].text`.

Also a follow-up, not DEV-867. Two unknowns first: whether `@modelcontextprotocol/server` v2 exposes URL-mode elicitation, and how to correlate `elicitationId` with completion in a stateless Workers deployment.

## 5. The product bar — the script a change must pass

Run against a host that does **not** mount `ui://` (Claude Code, MCP Inspector with UI off, a raw JSON-RPC client). No `mode` override on any call.

1. **Paywalled tool → gate.** `content[0].text` states the limit, why the call was blocked, exactly one recovery intent tool, and a https URL. It does not say "in the panel" and does not require a second tool call to reach the URL.
2. **`manage_account`.** `content[0].text` states the signed-in customer's plan and remaining included usage or credit balance.
3. **`upgrade`.** `content[0].text` lists at least one plan with a price, a `planRef`, and a https checkout or activation path.
4. **`resources/read docs://solvapay/overview.md`** returns the capability overview, so a text host can discover what the server does without guessing.

Supporting requirements: every gate carries machine-readable fields (`planRef`, `productRef`, `checkoutUrl`, counters, unit price) on `structuredContent` as well as in the text; checkout links state their validity; and no required field is silently defaulted when the backend omits it — a narrator that claims to print a field must fail loudly if it is missing.

The scaffolder's `scripts/verify.mjs` `paywallGate` check asserts this against a flat `structuredContent.kind` (`payment_required` | `activation_required`): https URL in `content[0].text` and `checkoutUrl`, plan refs, included counters when present, no "in the panel", and no `_meta.ui` on the gate. Probe args include dummy required strings (`query` / `symbol`) so Zod-validated tools reach the paywall instead of failing argument validation.

## 6. `outputSchema` on the gate and intent tools

The tools spec: when `outputSchema` is provided, servers MUST populate `structuredContent` conforming to it and clients SHOULD validate. The MCP Apps guidance is blunter — if a tool returns `structuredContent`, declare an `outputSchema`.

Intent tools declare `BootstrapPayloadSchema`. The paywall gate declares `PaywallStructuredContentSchema` (Node entry only — the Zod object is not exported from the edge bundle). Fields the backend omits are optional in the schema, never required-with-a-default.

The core spec also says a tool returning structured content SHOULD return the serialized JSON in a text block for backwards compatibility. Read with SEP-1624's semantic-equivalence rule, the sensible reading is a readable summary carrying the same facts, not a JSON dump.

## 7. What we already do correctly

`updateModelContext` is implemented at [`packages/react/src/mcp/bridge.tsx`](../../packages/react/src/mcp/bridge.tsx) with the properties the talk calls for: feature-detected, errors swallowed so a non-compliant host cannot break the user flow, and emitted at committed milestones (plan select, payment success, top-up confirmed), covered by `__tests__/update-model-context.emissions.test.tsx`. `app.sendMessage` is wired for user-visible follow-ups. This is what tells the model a plan went active without spending a tool call.

Our app-only transport tools are correct in kind: `visibility: ["app"]` is the spec's own mechanism, defaulting to `["model", "app"]`, with hosts required to exclude non-model tools from the agent's list.

One thing to check rather than assume: `notifyModelContext` prefers `structuredContent` when supplied (`bridge.tsx:122-128`). Given §1, emitting `content` text — as the checkout and top-up views already do — is the safe form.

## 8. Adjacent ecosystem: x402

A parallel monetization approach solving a different problem (autonomous wallet settlement, no human in the loop). Two transferable ideas:

- **Advertise price in tool metadata, not only in the gate response.** "An agent planning a task reads `tools/list` and needs cost as an input to tool selection, before it commits to a call." We surface price only after a call is blocked.
- **Keep discovery free.** `initialize`, `tools/list`, `resources/list` are the shop window — which we already honour.

Relevant to §3a: Claude Code triggers MCP Tool Search once a server's tool descriptions exceed ~10% of context, at which point the server-level `instructions` field drives discovery. We register 12 tools, so description bytes are a real budget.

## 9. Follow-ups this research adds

- **Handshake capability detection** (§3c) — retires the user-agent sniff and the per-host `bypassWhen` patches. Largest payoff of anything here.
- **URL-mode elicitation** (§4) for checkout on non-UI hosts that support it.
- **Non-credential checkout entry point** (§3b) — platform work, not SDK.
- **`outputSchema`** for the gate payload and bootstrap (§6).
- **Price annotation in payable tool metadata** (§8).
- **View-local tools** and **host-push to the view** — upcoming spec changes that would retire most of our eight UI transport tools and the polling pattern.

## Sources

Specification and SEPs:

- [MCP Apps specification, 2026-01-26 (`apps.mdx`)](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) — capability negotiation, `_meta.ui`, visibility, graceful-degradation requirements
- [MCP Apps overview docs](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/overview.md) — tool-UI linkage and tool visibility
- [Elicitation, spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation) — form vs URL mode
- [SEP-1036: URL Mode Elicitation for secure out-of-band interactions](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1036)
- [SEP-1624: Clarify `structuredContent` vs `content` usage guidance](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1624)
- [SEP-2200 SDK impact analysis (csharp-sdk #1552)](https://github.com/modelcontextprotocol/csharp-sdk/issues/1552) — client precedence between the two fields
- [Tools, spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) — `outputSchema`, structured content
- [Lifecycle, spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle) — capability negotiation at `initialize`

Implementation references:

- [`getUiCapability` API reference](https://apps.extensions.modelcontextprotocol.io/api/functions/server-helpers.getUiCapability.html) and [`McpUiClientCapabilities`](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiClientCapabilities.html)
- [MCP Python SDK — `client_supports_apps`](https://py.sdk.modelcontextprotocol.io/v2/api/mcp/server/apps/)
- [MCP Ruby SDK — MCP Apps extension](https://ruby.sdk.modelcontextprotocol.io/extensions/mcp-apps/) — "always return a meaningful text result"
- [TypeScript SDK — `elicitationUrlExample.ts`](https://github.com/modelcontextprotocol/typescript-sdk/blob/327243ce/examples/server/src/elicitationUrlExample.ts) — payment confirmation via URL elicitation
- [MCP Apps launch post](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)
- [Three-party architecture (DeepWiki, ext-apps)](https://deepwiki.com/modelcontextprotocol/ext-apps/2.1-three-party-architecture)

Commentary and practice:

- [Anthropic's Lessons from Building MCP Apps](https://aaif.io/blog/anthropics-lessons-from-building-mcp-apps) — Chafik & Pidkuiko, MCP Dev Summit NA 2026
- [MCP App Tool Results: content, structuredContent, and `_meta`](https://sunpeak.ai/blogs/mcp-app-tool-results-content-structuredcontent-meta/)
- [MCP elicitation URL mode for out-of-band input](https://connector.zone/guides/elicitation-url-mode/) and [How MCP capability negotiation works](https://connector.zone/guides/capability-negotiation-in-mcp/)
- [Elicitation: When the Server Needs to Ask the User](https://imti.co/mcp-elicitation/)
- [Monetize an MCP Server with x402](https://systemprompt.io/guides/monetize-mcp-server-x402) — price-in-metadata argument
- [MCP Tool Schema Bloat: The Hidden Token Tax](https://layered.dev/mcp-tool-schema-bloat-the-hidden-token-tax-and-how-to-fix-it/) — Claude Code tool-search threshold
