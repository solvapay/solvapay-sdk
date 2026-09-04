# SolvaPay MCP Apps SDK — rules

Rules for building and refactoring the SolvaPay payable-MCP surface in every language. Read before writing any code in:

- the shared Rust MCP core — `core/solvapay-mcp` (plus payable decisions in `core/solvapay-core`)
- the language adapters — `sdks/typescript/mcp-core`, `sdks/typescript/mcp` (including `src/express` and `src/fetch`), `sdks/typescript/react/src/mcp`, `sdks/python-mcp`, `sdks/ruby-mcp`, `sdks/go/mcp`, `sdks/rust-mcp`, and the C reference engine `sdks/capi/ctest/mcp_engine.c`
- the shared widget — `tools/mcp-app-widget`
- the fixture corpus and its runner — `contract/mcp-fixtures`, `tools/conformance/mcp-authoring`
- the MCP examples — `examples/typescript/mcp-checkout-app`, `examples/typescript/mcp-time-app`, `examples/typescript/mcp-oauth-bridge`, `examples/typescript/cloudflare-workers-mcp`, `examples/typescript/supabase-edge-mcp`, `examples/python/stock-research-mcp`, `examples/ruby/bitcoin_analytics_mcp`, `examples/go/weather-mcp`, `examples/rust/guerrillamail-mcp`

This document is the product-stance doc: _what_ we build and _why_. The result shapes, usage-outcome projection, and dispatch envelope are specified normatively in [mcp-authoring-adapter-contract.md](./mcp-authoring-adapter-contract.md); where the two disagree, the contract wins.

## Three layers

Every payable-MCP change lands in exactly one of three layers.

1. **Layer 1 — host MCP SDK.** `@modelcontextprotocol/server`, `rmcp`, the `mcp` PyPI package, the `mcp` gem, the Go MCP SDK. Never reimplemented by SolvaPay. C has no host MCP SDK, which is why `sdks/capi/ctest/mcp_engine.c` is the smallest honest expression of the loop.
2. **Layer 2 — shared Rust core.** `core/solvapay-mcp` (crate `solvapay-mcp-core`, `publish = false`) plus payable decisions in `core/solvapay-core`. Descriptors, OAuth, auth gate, narration, the JSON-RPC engine, and all paywall copy.
3. **Layer 3 — thin host glue.** Transport, request/response body conversion, framework routing, host-SDK tool registration, bearer → `authHeader` / `customerRef`, and invoking the merchant handler. Nothing else, and never more than 280 code lines per reference adapter (`pnpm mcp-layer3-budget:check`).

The consequences worth internalising:

- **Any decision expressible as JSON-in → JSON-out belongs in layer 2.** If another language would need the same conditional, it does not go in the adapter you happen to be editing.
- **Gate copy is never authored in an adapter.** It comes from `paywall_tool_result` / `build_paywall_gate` in Rust (`paywallToolResult` / `buildPaywallGate` at the binding boundary). A hand-written fallback string is a bug even when it reads identically.
- **Layer 2 never calls back into the host.** There is no `getCustomerRef` callback into Rust; the host resolves the ref and passes it in as JSON.
- **`mcpDispatch` is the single JSON-RPC entry point,** and hosts branch three ways on `kind` (`rpc` / `challenge` / `invokeHandler`). The one host exception is the widget `resources/read`, which goes through `mcpWidgetResource` because the engine has no access to the vendored HTML.
- **`contract/mcp-fixtures/` is immutable characterization.** A mismatch is a runner or core regression, never a fixture edit. Focused command: `pnpm test:mcp-contract`.

See the adapter contract for the full result-shape, usage-outcome, and protocol-era tables.

## Per-language naming

The same surface under each ecosystem's conventions. Wire tool names stay snake_case everywhere (`upgrade`, `manage_account`, `topup`); widget views are `checkout` / `account` / `topup`.

| Language   | Package / module                         | Server construction          | Register payable                                   | Reference layer-3 engine                               |
| ---------- | ---------------------------------------- | ---------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| TypeScript | `@solvapay/mcp` (+ `@solvapay/mcp-core`) | `createSolvaPayMcpServer`    | `registerPayableTool` (`registerPayable` on `ctx`) | `sdks/typescript/mcp-core/src/engine-dispatch.ts`      |
| Python     | PyPI `solvapay-mcp`                      | `create_solvapay_mcp_server` | `register_payable_tool`                            | `sdks/python-mcp/python/solvapay_mcp/server/engine.py` |
| Ruby       | RubyGems `solvapay-mcp`                  | `SolvaPay::Mcp::Engine`      | `Engine#register_payable`                          | `sdks/ruby-mcp/lib/solvapay/mcp/engine.rb`             |
| Go         | `github.com/solvapay/solvapay-go/mcp`    | `NewServer`                  | `(*Server).RegisterPayable`                        | `sdks/go/mcp/handler.go` + `server.go`                 |
| Rust       | crate `solvapay-mcp` (`publish = false`) | `McpHttpServer::new`         | `McpHttpServer::register_payable`                  | `sdks/rust-mcp/src/server.rs`                          |
| C          | `sdks/capi`                              | —                            | — (no payable host SDK)                            | `sdks/capi/ctest/mcp_engine.c` (+ `mcp_json.c`)        |

Each ecosystem gets **one** adapter package. Runtime variants are subpaths or subpackages, never a second package: `@solvapay/mcp/express` and `@solvapay/mcp/fetch` are subpath exports, and `solvapay-go/mcp` is a subpackage of the `solvapay-go` module.

## Generated MCP surfaces

The per-language layer-2 shims are `@generated`. Hand-editing one fails CI.

| Language   | Generated shim                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------- |
| TypeScript | `sdks/typescript/mcp-core/src/native-mcp.generated.ts`                                          |
| Rust       | `sdks/rust-mcp/src/layer2_generated.rs`                                                         |
| Python     | `sdks/python-mcp/python/solvapay_mcp/_layer2.generated.py`                                      |
| Ruby       | `sdks/ruby-mcp/lib/solvapay/mcp/layer2.generated.rb` + `sdks/ruby-mcp/sig/layer2.generated.rbs` |
| Go         | `sdks/go/mcp/layer2_generated.go`                                                               |

Change the manifest, run `pnpm gen`, verify with `pnpm gen:check`.

## North Star

**The merchant's data is the hero. Commerce defers to it.**

Every design decision should serve this. When in doubt, ask: does this make the merchant's tool feel more native to Claude/ChatGPT, or less? If less, don't ship it.

## The three modes

Every SolvaPay response is in one of three modes. Know which before writing code.

1. **Silent.** Merchant's tool returned data. No iframe, no card, no upsell. Just the data. This is 90% of calls for a paying user.
2. **Nudge.** Data returned _and_ something is worth flagging (low balance, cycle ending, approaching limit). Small inline strip. Dismissible. Never blocks.
3. **Gate.** Data could _not_ be returned. User is out of credits or needs to upgrade. SDK takes over the surface. Focused, terminal, collapses after.

If you're building a UI surface that doesn't match one of these three, stop and escalate.

## Rules

### Commerce UI

- **Do not add tabs to the MCP shell.** The four-tab shell is deprecated. Each intent (`/manage_account`, `/topup`, `/upgrade`) opens a single-purpose surface and returns to chat when done.
- **Do not build an About surface.** Product description lives in tool descriptions, the assistant's text response, and the `docs://solvapay/overview.md` resource. Not in an iframe.
- **The UI is a mode, not a primary.** `McpAppShell` is an internal composition. What's exported as primary is intent-specific surfaces.
- **One surface, one job.** No nested navigation. No multi-step wizards except where genuinely unavoidable (card entry, top-up amount selection). If a surface needs tabs to fit its content, the content is too broad.
- **The widget routes on `structuredContent.view`, not tool name.** `<McpApp>` / `<McpAppShell>` pick the surface from the `view` discriminator the server stamps on intent-tool results (`checkout` / `account` / `topup`), not from `toolInfo.tool.name`. The paywall / nudge surfaces were removed in the text-only paywall refactor — merchant paywall / nudge responses narrate in `content[0].text` and never mount the widget; the iframe only opens for a deliberate intent-tool call.
- **Refresh on mount.** `McpAppShell` fires its mount-refresh once per mount so backgrounded iframes see fresh data when re-opened. There are no paywall/nudge surfaces to skip any more.

### Text-mode

- **UI is the default for intent tools; text is opt-in per call.** `narratedToolResult` ships a one-line placeholder in `content[0]` under the default `mode: 'ui'`. The full narrated markdown is behind `mode: 'text'` for CLI / text-only hosts, or `mode: 'auto'` when the caller wants both. This keeps UI-rendering hosts (MCP Inspector, ChatGPT Apps, Claude Desktop) from double-marking the surface the iframe already carries.
- **Agent grounding lives on `structuredContent`, not `content[0]`.** The full `BootstrapPayload` rides on `structuredContent` under every mode, so agents parsing JSON are never starved of context — even when the placeholder text is only one line.
- **Narrated blocks are annotated `audience: ['assistant']` in `'text'` and `'auto'` modes.** Audience-aware hosts hide them from the user pane while still feeding them to the model. Inspector ignores the hint; default `'ui'` mode already keeps Inspector clean.
- **UI fires only when the interaction genuinely needs pixels.** Listing plans, checking usage, confirming a cancel: prefer `mode: 'text'`. Selecting a payment method, entering card details, comparing plans before paying: default `'ui'` is correct.

### Merchant API

These read identically in every language; substitute the names from the table above.

- **The merchant registers a payable tool, not components.** The 90% path is a business-logic handler. If a merchant has to touch a view to ship a paid tool, the SDK has failed. A Ruby or Go merchant gets the same deal as a TypeScript one.
- **The handler context carries customer state.** Balance, tier, usage, plan shape. Merchants make their own judgments about when to nudge, without building a component.
- **Paywall is automatic and text-only.** The merchant never imports a paywall view, never wires a `_meta.ui.resourceUri`, never constructs a bootstrap payload. Layer 2 emits a text narration on `content[0].text` that names the recovery intent tool.
- **The response envelope is context-aware and mandatory.** Merchants call `ctx.respond(data)`, optionally with a nudge; `ctx.gate(reason)` stops the handler; `ctx.emit(block)` queues a content block flushed before the text block. Returning a raw value instead of the branded envelope is a loud error, not a silent wrap.
- **Usage outcomes are fixed.** Allow → one `success`. Pre-check gate → one `paywall`. `ctx.gate()` → no usage call at all. Handler throw → one `fail`.

### Pricing stance

- **Usage-based is the opinionated default.** The example server ships with usage-based pricing. The admin MCP suggests usage-based for new products. The checkout UI features usage-based when both are offered.
- **Recurring is supported but not featured.** It exists for merchants whose customers want predictable budgets.
- **Free tier is a first-class option, not an afterthought.** It should be the easiest to activate, not a footnote.

### Package boundaries

- **`@solvapay/mcp-core` has zero `@modelcontextprotocol/*` dependencies.** This invariant is load-bearing. It stays framework-neutral so alternative adapters (`fastmcp`, raw JSON-RPC) can consume the tool names, descriptors, and paywall meta. If you need MCP types there, declare them as structural aliases.
- **`@solvapay/mcp` is the only package that imports the official SDK.** It peers `@modelcontextprotocol/core` and `@modelcontextprotocol/server` (v2). Runtime-specific OAuth middleware lives on its subpath exports — `@solvapay/mcp/express` (Node `(req, res, next)`) and `@solvapay/mcp/fetch` (Web-standards `(Request) => Response`). They are subpaths, not separate packages: there is no `@solvapay/mcp-express` or `@solvapay/mcp-fetch`.
- **`@solvapay/react/mcp` is a subpath export.** Merchants using SolvaPay for non-MCP React surfaces do not pay the ext-apps peer dep cost.
- **Do not ship a `@solvapay/sdk` umbrella package.** Three-package imports are fine. An umbrella adds maintenance without clarity.
- **The sibling adapters keep the same shape.** One adapter package per ecosystem — crate `solvapay-mcp` (`sdks/rust-mcp`, `publish = false`), PyPI `solvapay-mcp`, RubyGems `solvapay-mcp`, and `github.com/solvapay/solvapay-go/mcp` as a subpackage of the `solvapay-go` module rather than a module of its own. Do not add a second package to any ecosystem to host a runtime variant.

### Spec compliance

- **Every tool has annotations.** `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` are required. Not optional. Default for `registerPayable` is `{ readOnlyHint: true, openWorldHint: true }`.
- **Every UI resource uses `mimeType: RESOURCE_MIME_TYPE`.** Never hardcode the string. Import it — along with `registerAppTool` / `registerAppResource` — from `@solvapay/mcp`, which vendors the server-side ext-apps helpers because `@modelcontextprotocol/ext-apps` has no SDK v2 build. The client-side `@modelcontextprotocol/ext-apps` entrypoint that runs inside the iframe is unaffected and stays a direct dependency.
- **`_meta.ui.resourceUri` lives only on the three intent-tool descriptors.** Merchant payable tools (`registerPayable`) deliberately do NOT advertise it — SEP-1865 says hosts MUST open the iframe on every call when the descriptor advertises it, which means auto-stamping flashed an empty widget on every silent data-tool success. Paywall / nudge / activation responses ship as plain-text narrations on `content[0].text` (naming the recovery intent tool) with `structuredContent = gate` for programmatic consumers. SolvaPay intent tools (`/upgrade`, `/manage_account`, `/topup`) keep descriptor-level `_meta.ui.resourceUri` because calling them is the user's explicit intent to open the UI.
- **Stripe.js is loaded from `js.stripe.com/v3` at runtime.** Never bundled. The CSP baseline allows this origin.

### Developer experience

- **Target: `npx solvapay init` to working paid tool in 60 seconds.** Every decision that adds a step to this path needs justification.
- **The examples are the primary docs surface.** A merchant copy-pasting `examples/typescript/mcp-checkout-app`, `examples/python/stock-research-mcp`, `examples/ruby/bitcoin_analytics_mcp`, `examples/go/weather-mcp`, or `examples/rust/guerrillamail-mcp` should get best practices automatically. Keep them minimal and correct.
- **Errors point at solutions.** If a merchant forgets to mount the OAuth bridge, the error message names the fix. No cryptic 402s.
- **Config-time validation over runtime failures.** If a required integration step is missing, server construction throws, not the first paid call.

### Demo

- **Demo is not the SDK.** The hero demo uses the Vite-build path because "I built this UI" is a stronger engineering story. Merchants use the bundled-HTML path because it's the 60-second onboarding.
- **The SDK widget is vendored, not copied by hand.** The canonical source is `tools/mcp-app-widget/src/mcp-app.tsx`. It builds to `tools/mcp-app-widget/dist/mcp-app.html`, and `tools/mcp-app-widget/vendor.ts` fans that one file out to `tools/mcp-app-widget/mcp-app.html` plus the five SDK destinations — `sdks/typescript/mcp/mcp-app.html`, `sdks/python-mcp/python/solvapay_mcp/data/mcp-app.html`, `sdks/ruby-mcp/lib/solvapay/mcp/data/mcp-app.html`, `sdks/go/mcp/mcp-app.html`, `sdks/rust-mcp/mcp-app.html`. Never edit a vendored copy: fix the source and re-vendor. `tools/mcp-app-widget/check.ts` gates drift (`pnpm --filter @solvapay/mcp-app-widget check`).
- **Example widget copies are a separate, deliberate duplication.** The four TypeScript `mcp-app.html` / `src/mcp-app.tsx` copies (Cloudflare Workers, Supabase Edge, `mcp-checkout-app`, and `tools/create-solvapay/templates/mcp/ts/_base`) are duplicated on purpose, not leftover. Each copy is a standalone project — a `workspace:*` shared package would make the examples uncopyable. The two edge examples cannot use the SDK default at all: the edge `defaultMcpAppHtml` throws by design, so they must build and ship their own HTML. The scaffold template is the canonical integrator shape; the examples add a monorepo-only Vite `@solvapay/*` alias block because they build SDK packages from source rather than `node_modules`. Do **not** extract a shared package. `tools/repo/example-widget-parity.test.ts` gates HTML byte-identity and TSX identity from the first `import` onward; if it fails, update every copy (or the gate).
- **Pre-render chart PNGs for the demo.** Do not rely on live chart generation during a live demo. Bulletproof > impressive.
- **First-run tour is disabled in the demo bootstrap.** Presenter talks over the UI, not against it.

## When in doubt

Ask: **is this making the merchant's tool feel more native to Claude, or more like a SaaS dashboard embedded in Claude?** The first is right. The second is what you're refactoring away from.

## Escape hatches

Every rule above is a strong default. If you think you need to violate one:

1. Write down the specific case.
2. Check whether the case is really what the rule is pointing away from, or an edge the rule doesn't cover.
3. If it's an edge, extend the rule; do not add an exception.
4. If it's really a violation, write down _why_ and keep the diff small enough to revert.
