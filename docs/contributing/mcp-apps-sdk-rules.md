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

### Display modes & layout law

Applies to every SolvaPay commerce surface (MCP inline, MCP fullscreen, hosted checkout, hosted account, hosted top-up). Display mode is **host state, not routing**.

Management pages run one full-width column. Only checkout / top-up / plan-switch split, so the split itself signals a transaction. This is a product decision — MCP Apps fullscreen guidance permits sidebars; we do not use one so hosted and the widget share one law.

- **Payment surfaces lead with the summary rail.** Checkout, top-up, and plan-switch. Wide: `grid-template-columns: 340px minmax(0,1fr)`, `gap: 56px`. `SummaryRail` is first in source order, 340px, `border-right`, no fill. Narrow: the same rail stacks above the action column (collapsible on hosted mobile). The action column is Pay / card / CTA.
- **Management surfaces are one column.** Account has no `ContextRail`. Identity is a provenance line in the column. Do not bring back a 300px management rail.
- **DOM order = reading order = source order.** Do not use `order: -1` or Tailwind `order-*` to swap columns. Screen readers and text/CLI-host parity depend on this. Payment puts the rail first because that *is* the reading order.
- **Fluid from 320px.** Two columns only when the container is wide enough for payment (hosted at `lg` / 1000px content). `.solvapay-mcp-main` fills the host so container queries see host width — do not put a max-width on `main`, that kills the 760px density query. Inline chrome, card and shell are one centered `36rem` block (no-op below that width, so Claude/ChatGPT still fill the iframe). Form content inside the card stays start-aligned. The MCP widget has no sidebar grid and no 720px container query — identity is a provenance line. Inline density uses a named `mcp` container query at 760px (wide) with a 420px default (narrow); nothing is dropped between those widths. Fullscreen lifts the inline cap and is a centered 1000px column with `56px 72px 40px` padding on the shell, outside the 1000px; below 1000px of host width it falls back to the inline stack.
- **Fullscreen is the hosted page, not a stretched widget.** Advertise `availableDisplayModes: ['inline', 'fullscreen']` on `new App(info, capabilities)` (`SOLVAPAY_MCP_APP_CAPABILITIES`). Read `displayMode` from host context. Request a switch only from a user action via `app.requestDisplayMode({ mode: 'fullscreen' })`, and only when the host lists `fullscreen` in `availableDisplayModes`. Do not request `pip` — account/checkout are not live sessions. Inline stays compact/content-height. Fullscreen is one centered 1000px column with no SolvaPay header (the host owns window chrome), one scroll owner, and `hostContext.safeAreaInsets` applied as root padding — not `env(safe-area-inset-*)`. Same React tree in both modes.
- **This is not a dashboard.** Fullscreen still renders one surface (`checkout` / `account` / `topup`). It does not add tabs, an about page, or a second navigation.

### Shared token vocabulary (phase-two SDK contract)

Hosted pages and the MCP widget share one custom-property vocabulary. Use the MCP Apps spec names. `--solvapay-*` is only for branding concepts the spec has no word for.

```
--color-background-primary / --color-background-secondary
--color-text-primary / --color-text-secondary
--color-border-primary / --color-border-secondary
--font-sans / --font-mono
--border-radius-sm / --border-radius-md / --border-radius-lg / --border-radius-xl

--solvapay-accent / --solvapay-accent-text
--solvapay-identifier
--solvapay-selection / --solvapay-selection-wash
--solvapay-row-hover / --solvapay-control-hover
--solvapay-danger
```

Do not invent a parallel `--sp-*` namespace or a second hardcoded palette. Stripe `appearance` reads live values off `document.documentElement` via `getComputedStyle` (`buildStripeAppearance`).

**Frame owner sets the font.** `--font-sans` is owned by the frame that mounts the UI:

- Hosted pages: the provider's `fontFamily` feeds `--font-sans` (Inter fallback). `--font-mono` is pinned (IBM Plex Mono) and is not provider-overridable — it carries tabular alignment in ledgers.
- MCP widget: the host (Claude / ChatGPT) injects fonts via `hostContext.styles.css.fonts` and `applyHostStyleVariables`. Do not ship Inter (or any brand face) as an override of `--font-sans`. `--font-mono` may stay pinned.

`font-feature-settings: "ss01","cv11"` is scoped to the Inter / no-provider-font case only.

**Hosted Tailwind → CSS.** When translating a hosted primitive into the widget, map colour utilities onto the same tokens. Do not confuse them with the `fontSize.hosted-*` scale (same `hosted-` prefix, different axis):

| Hosted class | CSS |
| --- | --- |
| `text-hosted-fg` | `color: var(--color-text-primary)` |
| `text-hosted-muted` | `color: var(--color-text-secondary)` |
| `border-hosted-hairline` | `border-color: var(--color-border-secondary)` |
| `border-hosted-border` | `border-color: var(--color-border-primary)` |
| `bg-hosted-bg` | never — inner fills stay transparent. Raised / selected use `--color-background-secondary` or inverse |
| `bg-hosted-surface` | `background: var(--color-background-secondary)` |

`text-hosted-fg` is a colour. `text-hosted-body` is a font size. The widget type scale is a product decision (~10 levels of literal px) — the host publishes three levels and we do not consume `--font-text-*` / `--font-heading-*`.

**Inline density.** Claude's host guidance (not the spec) caps an inline card at 2 actions and 4–5 data points, with no drill-ins. Fullscreen can disclose the rest via `FullViewButton`. Do not re-import fullscreen density into the inline card.

### Text-mode

Grounded in the [MCP 2026-07-28 tools spec](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [SEP-1865 / MCP Apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx), and the [ext-apps overview](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/overview.md). Host-by-host behaviour is recorded in [`mcp-apps-host-contract.md`](./mcp-apps-host-contract.md).

- **Neither field reaches the model reliably; emit both, each self-sufficient.** Claude Desktop chat reads `content` and ignores `structuredContent`. Claude Code prefers `structuredContent` and drops text blocks. Grok Bot keeps only markdown in `content[].text`. There is no normative client-precedence rule (SEP-1624 closed unmerged; SEP-2200 was deferred). The one server-directed SHOULD still in force: a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block (`dataInText`, default on).
- **Every action in `content[].text` must be a markdown `https://` link or a named tool call with arguments.** `resource_link`, `structuredContent`, `_meta` / `ui://`, slash commands, and `docs://` are enrichment — each is dropped by at least one tested host. See [`mcp-apps-host-contract.md`](./mcp-apps-host-contract.md) §1.
- **Anything the model or a text-only user must act on goes in `content[0].text`.** Plan name, remaining included usage, credit balance, reset/renewal date, the recovery viewer (`account` + `view`) or mutator (`activate_plan`), and a https URL. `structuredContent` still carries the `BootstrapPayload` / gate for the widget and for programmatic consumers. It is a bonus for the model, never the only complete copy.
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
