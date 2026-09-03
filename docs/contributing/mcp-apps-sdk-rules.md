# SolvaPay MCP Apps SDK — rules

Rules for building and refactoring the SolvaPay SDK for MCP Apps. Read before writing any code in `packages/mcp-core`, `packages/mcp`, `packages/mcp-express`, `packages/mcp-fetch`, `packages/react/mcp`, or `examples/mcp-checkout-app` / `examples/supabase-edge-mcp`.

## North Star

**The merchant's data is the hero. Commerce defers to it.**

Every design decision should serve this. When in doubt, ask: does this make the merchant's tool feel more native to Claude/ChatGPT, or less? If less, don't ship it.

## The three modes

Every SolvaPay response is in one of three modes. Know which before writing code.

1. **Silent.** Merchant's tool returned data. No iframe, no card, no upsell. Just the data. This is 90% of calls for a paying user.
2. **Nudge.** Data returned *and* something is worth flagging (low balance, cycle ending, approaching limit). Small inline strip. Dismissible. Never blocks.
3. **Gate.** Data could *not* be returned. User is out of credits or needs to upgrade. SDK takes over the surface. Focused, terminal, collapses after.

If you're building a UI surface that doesn't match one of these three, stop and escalate.

## Rules

### Commerce UI

- **Do not add tabs to the MCP shell.** The four-tab shell is deprecated. Each `view` (`checkout`, `account`, `topup`) opens a single-purpose surface and returns to chat when done.
- **Do not build an About surface.** Product description lives in tool descriptions, Claude's text response, and the `docs://solvapay/overview.md` resource. Not in an iframe.
- **The UI is a mode, not a primary.** `McpAppShell` is an internal composition. What's exported as primary is intent-specific surfaces.
- **One surface, one job.** No nested navigation. No multi-step wizards except where genuinely unavoidable (card entry, top-up amount selection). If a surface needs tabs to fit its content, the content is too broad.
- **The widget routes on `structuredContent.view`, not tool name.** `<McpApp>` / `<McpAppShell>` pick the surface from the `view` discriminator the server stamps on `account` viewer results (`checkout` / `account` / `topup`), not from `toolInfo.tool.name`. Merchant paywall / nudge responses narrate in `content[0].text` and never mount the widget; the iframe only opens for a deliberate `account` viewer call (slash prompts `/upgrade`, `/manage_account`, `/topup` remap onto it with the matching `view`).
- **Refresh on mount.** `McpAppShell` fires its mount-refresh once per mount so backgrounded iframes see fresh data when re-opened. There are no paywall/nudge surfaces to skip any more.

### Text-mode

Grounded in the [MCP 2026-07-28 tools spec](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [SEP-1865 / MCP Apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx), and the [ext-apps overview](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/overview.md). Host-by-host behaviour is recorded in [`mcp-apps-host-contract.md`](./mcp-apps-host-contract.md).

- **`content[0].text` is the only reliable model and text-host lane.** Official MCP Apps copy: `content` is "text representation for model context and text-only hosts"; `structuredContent` is "optimized for UI rendering (not added to model context)"; `_meta` never reaches the model. Anthropic's host write-up is stricter still: when `content` is present, `structuredContent` is hidden from the model. The 2026-07-28 tools spec independently requires a text block whenever you return `structuredContent` (backwards compatibility for clients that do not read it).
- **Anything the model or a text-only user must act on goes in `content[0].text`.** Plan name, remaining included usage, credit balance, reset/renewal date, the recovery viewer (`account` + `view`) or mutator (`activate_plan`), and a https URL. `structuredContent` still carries the `BootstrapPayload` / gate for the widget and for programmatic consumers. It is a bonus for the model, never the only copy.
- **The first text block must be self-sufficient.** `"Plans and checkout are shown in the panel."` is a bug on Claude Code, CLI hosts, Grok, n8n, and any host that ignores `ui://`. Keep it short (one or two lines) — the official guidance is "keep it short" — but the line has to name the limit and the next step without an iframe.
- **UI is the default for the `account` viewer when pixels are needed; the text lane is not optional.** `narratedToolResult` may still emit a short `content[0]` under `mode: 'ui'` so UI-rendering hosts (MCP Inspector, ChatGPT Apps, Claude Desktop) do not double-mark the iframe. That short line is still the model/text-host copy, not a pointer at the panel. Full markdown stays behind `mode: 'text'` / `'auto'`.
- **Narrated blocks may be annotated `audience: ['assistant']` in `'text'` and `'auto'` modes.** Audience-aware hosts hide them from the user pane while still feeding them to the model. Do not rely on the annotation — hosts that ignore it must still see a useful `content[0]`.
- **UI fires only when the interaction genuinely needs pixels.** Listing plans, checking usage, confirming a cancel, reading current limits: the text lane is enough. Selecting a payment method, entering card details, comparing plans before paying: default `'ui'` is correct.
- **Text-only hosts must still inform, upgrade, and discover.** A gated call without an iframe has to (1) state current limits, (2) name `` `account` `` with the right `view` (or `` `activate_plan` `` when a `planRef` is known) plus a https URL, (3) point at `docs://solvapay/overview.md`.

### Merchant API

- **The merchant writes `registerPayable`, not components.** The 90% path is a business-logic handler. If a merchant has to touch a view to ship a paid tool, the SDK has failed.
- **The handler context carries customer state.** Balance, tier, usage, plan shape. Merchants make their own judgments about when to nudge, without building a component.
- **Paywall is automatic and text-only.** The merchant never imports a paywall view, never wires a `_meta.ui.resourceUri`, never constructs a bootstrap payload. The SDK emits a text narration on `content[0].text` that names `` `account` `` with the right `view` (or `` `activate_plan` `` when a `planRef` is known).
- **Response envelope is context-aware.** Merchants call `ctx.respond(data)` or `ctx.respond(data).withNudge(...)`. They do not return plain objects that the SDK has to guess about.

### Pricing stance

- **Usage-based is the opinionated default.** The example server ships with usage-based pricing. The admin MCP suggests usage-based for new products. The checkout UI features usage-based when both are offered.
- **Recurring is supported but not featured.** It exists for merchants whose customers want predictable budgets.
- **Free tier is a first-class option, not an afterthought.** It should be the easiest to activate, not a footnote.

### Package boundaries

- **`@solvapay/mcp` has zero `@modelcontextprotocol/*` runtime dependencies.** This invariant is load-bearing. Do not violate it.
- **`@solvapay/mcp` is the only package that imports the official SDK (`@modelcontextprotocol/core` / `/server`).** If you need MCP types elsewhere, re-export them through `@solvapay/mcp-core` as structural aliases. `@solvapay/mcp-core` is intentionally framework-neutral with zero `@modelcontextprotocol/*` runtime dep — OAuth bridge middleware lives in `@solvapay/mcp-express` (Node) and `@solvapay/mcp-fetch` (fetch-first runtimes).
- **`@solvapay/react/mcp` is a subpath export.** Merchants using SolvaPay for non-MCP React surfaces do not pay the ext-apps peer dep cost.
- **Do not ship a `@solvapay/sdk` umbrella package.** Three-package imports are fine. An umbrella adds maintenance without clarity.

### Spec compliance

- **Every tool has annotations.** `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` are required. Not optional. Default for `registerPayable` is `{ readOnlyHint: true, openWorldHint: true }`.
- **Never render a bare `<a target="_blank">` or call `window.open()`.** Claude's iframe sandbox omits `allow-popups`, so both are dropped silently — the control looks alive and does nothing, and the only trace is a line in the iframe's own console. Every outbound link goes through `useExternalLinkClick()` (anchors) or `useOpenExternal()` (post-`await` flows), which prefer the host's `ui/open-link` when it declares the `openLinks` capability and fall back to native navigation everywhere else. Keep the real `href` on the anchor so the link role, "copy link address" and middle-click survive on permissive hosts. The capability is read at click time, not render time — the bridge can mount before `connect()` populates it.
- **Every UI resource uses `mimeType: RESOURCE_MIME_TYPE`.** Never hardcode the string. Import it — along with `registerAppTool` / `registerAppResource` — from `@solvapay/mcp`, which vendors the server-side ext-apps helpers because `@modelcontextprotocol/ext-apps` has no SDK v2 build. The client-side `@modelcontextprotocol/ext-apps` entrypoint that runs inside the iframe is unaffected and stays a direct dependency.
- **`_meta.ui.resourceUri` lives only on the `account` viewer descriptor.** Merchant payable tools deliberately do NOT advertise it. Paywall / nudge responses ship as plain-text narrations naming `` `account` `` + `view` or `` `activate_plan` `` with `structuredContent = gate`. `` `activate_plan` `` is a mutator only — no `resourceUri`, no bootstrap payload.
- **Stripe.js is loaded from `js.stripe.com/v3` at runtime.** Never bundled. The default CSP baseline permits Stripe origins and host-injected font origins (for example `assets.claude.ai` via `hostContext.styles.css.fonts`).

### Developer experience

- **Target: `npx solvapay init` to working paid tool in 60 seconds.** Every decision that adds a step to this path needs justification.
- **The example server is the primary docs surface.** If a merchant copy-pastes `examples/mcp-checkout-app`, they get best practices automatically. Keep it minimal and correct.
- **Errors point at solutions.** If a merchant forgets to mount the OAuth bridge, the error message names the fix. No cryptic 402s.
- **Config-time validation over runtime failures.** If a required integration step is missing, `createSolvaPayMcpServer` throws at construction, not on the first paid call.

### Demo

- **Demo is not the SDK.** The hero demo uses the Vite-build path because "I built this UI" is a stronger engineering story. Merchants use the bundled-HTML path because it's the 60-second onboarding.
- **Pre-render chart PNGs for the demo.** Do not rely on live chart generation during a live demo. Bulletproof > impressive.
- **First-run tour is disabled in the demo bootstrap.** Presenter talks over the UI, not against it.

## When in doubt

Ask: **is this making the merchant's tool feel more native to Claude, or more like a SaaS dashboard embedded in Claude?** The first is right. The second is what you're refactoring away from.

## Escape hatches

Every rule above is a strong default. If you think you need to violate one:

1. Write down the specific case.
2. Check whether the case is really what the rule is pointing away from, or an edge the rule doesn't cover.
3. If it's an edge, extend the rule; do not add an exception.
4. If it's really a violation, write down *why* and keep the diff small enough to revert.
