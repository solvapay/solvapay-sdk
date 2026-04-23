# SolvaPay MCP Apps SDK — direction & refactor

**Audience:** SolvaPay eng team, design, product.
**Status:** Direction call. Supersedes `mcp-app_discoverable_ux_104b7f60.plan.md` in the areas called out below; preserves it elsewhere.
**Companion:** `CLAUDE.md` at repo root — the short rules version used by coding assistants.

---

## Why this exists

We've been building the MCP Apps SDK like a checkout product with a tool surface bolted on. The thing we're actually trying to build is the opposite: a tool surface where commerce is invisible until it's needed, and gets out of the way immediately after. This document names that shift and lists what changes.

---

## North Star

**The merchant's data is the hero. Commerce defers to it.**

Every design decision should serve this. When in doubt: does this make the merchant's tool feel more native to Claude/ChatGPT, or less?

The best-in-class MCP Apps SDK for payments is the one merchants can ship in 60 seconds, where their customers pay without noticing they paid, and where our brand surfaces only at the moments that genuinely require a transaction. Not earlier. Not more often.

---

## The three modes

Every SolvaPay response is in one of three modes:

1. **Silent.** Merchant's tool returned data. No iframe, no card, no upsell. Just the data. **90% of calls.**
2. **Nudge.** Data returned and something is worth flagging — low balance, cycle ending, approaching limit. Small inline strip. Dismissible. Never blocks.
3. **Gate.** Data could not be returned. User is out of credits or needs to upgrade. SDK takes over the surface. Focused, terminal, collapses after completion.

Two of the three modes have no iframe. This is the most important sentence in this document. The majority of SolvaPay's visual footprint in Claude/ChatGPT should be zero pixels.

---

## What changes from the existing plan

The existing plan document (`mcp-app_discoverable_ux_104b7f60.plan.md`) did careful work on the four-tab shell, the About view, the plan-shape matrix, the Top-up sub-flow. Much of it survives. Some of it doesn't. Explicit list:

### What's deprecated

- **The four-tab shell** (`About / Plan / Top up / Account`). Tabs inside an iframe inside a chat interface are navigation three layers deep. Each intent opens a single-purpose surface instead. No tabbed shell.
- **The `McpAboutView`** as a first-class view. In a chat context the user just asked for the tool — they know what it is. The About surface solves a problem that doesn't exist in this medium. Product description lives in tool descriptions, Claude's text response, and the `docs://solvapay/overview.md` resource.
- **The first-run tour** and inline tab hints. These exist to help users navigate the tabbed shell. Without tabs, they have nothing to explain.
- **`McpActivateView` as a distinct surface.** Merged into the single checkout/upgrade surface.

### What survives but changes shape

- **The plan-shape matrix** (PAYG, recurring unlimited, recurring metered, free). Stays. Lives inside the account surface's adaptive rendering. The helpers `resolveActivationStrategy` and `resolvePlanActions` remain; they just drive a single surface instead of a tabbed one.
- **The "Your activity" strip.** Gets *more* valuable in this direction. Becomes the primary summary rendered in account and nudge contexts.
- **The three-step Top-up flow** (Amount → Payment → Success). Survives as a sub-flow inside the top-up surface. `BackLink` primitive and back-nav rules stay.
- **The external-link glyph convention.** Keep it. Still correct.
- **The narrator system.** Gets promoted dramatically. See next section.

### What's promoted to first-class

- **`narratedToolResult`.** Moves from "text-only fallback" to "default response shape." UI rendering becomes opt-in per call, not opt-out. Reverse the default of the `mode` arg.
- **The merchant response envelope.** `ctx.respond(data)` replaces "return a plain object." This is where the silent/nudge/gate branching happens on the server side.
- **The customer state available to handlers.** Balance, tier, usage, plan shape — surfaced to merchant handlers so they can make their own nudge decisions without building components.

### What's added

- **`ctx.respond(data).withNudge({ kind, message })`.** The merchant API for mode 2. No component to import. No iframe to manage.
- **`payable.mcp()` context.** Customer state exposed on the handler context.
- **`npx solvapay init` CLI.** Scaffolds the example server in one command. Target: 60-second onboarding.
- **Prebuilt HTML bundle in `@solvapay/mcp-sdk`.** Merchants who don't theme the UI skip Vite entirely. (Scoped in `bundled-html-open-questions.md`.)

---

## The merchant API, before and after

### Before

```ts
registerPayable('query_sales_trends', {
  title: '...',
  description: '...',
  schema: { range: z.string() },
  handler: async ({ range }) => {
    const data = await fetchFromBackend(range)
    return data  // SDK guesses what to do
  }
})
```

### After

```ts
registerPayable('query_sales_trends', {
  title: '...',
  description: '...',
  schema: { range: z.string() },
  annotations: { readOnlyHint: true },
  handler: async ({ range }, ctx) => {
    const data = await fetchFromBackend(range)

    // Mode 1: silent — 90% of calls
    if (ctx.customer.balance > 1000) {
      return ctx.respond(data)
    }

    // Mode 2: nudge — merchant decides when
    return ctx.respond(data).withNudge({
      kind: 'low-balance',
      message: `Running low on credits`,
    })
  }
})
```

The mode 3 path (gate) is invisible to the merchant — it fires automatically when `ctx` can't grant the call. Merchant never imports a paywall view.

---

## SDK structural implications

Concrete changes to the codebase.

### `@solvapay/mcp`

- Add `ResponseContext` type with `customer`, `product`, `respond(data)`, `respond(data).withNudge(...)`.
- Change `BuildPayableHandlerContext` to pass the context to the handler as second arg.
- Update `narratedToolResult` to be the default code path for every response, with UI resource injection as the opt-in branch.
- Reverse `mode` arg default: `'auto'` → text-first.
- Deprecate `SolvaPayMcpViewKind = 'about'`. Plan still carries it through one release for back-compat; removed in the one after.

### `@solvapay/mcp-sdk`

- `registerPayableTool` accepts the new context-aware handler signature.
- `createSolvaPayMcpServer` adds config-time validation for `getCustomerRef`.
- Annotations already covered in `tool-annotations-pr-handoff.md` — independent, lands first.
- Prebuilt HTML bundle scoped in `bundled-html-open-questions.md` — independent, lands after annotations.

### `@solvapay/react/mcp`

This is where the biggest surface changes happen.

- **Delete:** `McpAppShell`'s tab strip. The shell becomes a thin wrapper that routes to one surface based on the intent.
- **Delete:** `McpAboutView` export, `McpFirstRunTour`, `TourReplayButton`, `DEFAULT_TOUR_STEPS`, `hasSeenTour`, `resetTourDismissal`, `MCP_TAB_ORDER`, `MCP_TAB_HINTS`, `computeVisibleTabs`.
- **Delete:** `McpActivateView` as a separate surface. Merge its logic into `McpCheckoutView`.
- **Keep and reshape:** `McpAccountView`, `McpCheckoutView`, `McpTopupView`, `McpPaywallView`. Each becomes a single-purpose surface with no tab wrapper.
- **Add:** `McpUpsellStrip` — the inline component for mode 2. Lightweight. Dismissible. One primary CTA.
- **Keep:** `resolveActivationStrategy`, `resolvePlanActions`, `resolveActivityStrip`, `BackLink`. All still useful inside single-purpose surfaces.

### `examples/mcp-checkout-app`

- Default pricing model flips from recurring to usage-based.
- Demo tools stay (`search_knowledge`, `get_market_quote`) but the first-run tour disappears.
- `mcp-app.tsx` becomes shorter — less routing ceremony because no tabs.

---

## Migration plan for merchants who integrated against the old API

We haven't shipped publicly yet, so "migration" means internal:

- Any internal service that imported `McpAboutView` / `McpFirstRunTour` / `MCP_TAB_ORDER` gets a one-line cleanup.
- The existing `McpAppShell` signature changes but the *name* stays — merchants who wrote `<McpApp app={app}>` don't touch their code.
- `mode: 'auto'` default reversal is a behavior change; current beta integrators will see less UI by default. We announce this and provide `mode: 'ui'` opt-in.

If we had public integrators on the old tabs: we'd hold the deprecated exports for one minor version with console warnings, then drop. We don't, so the cut can be clean.

---

## Open questions this document does *not* resolve

Flagging these so they don't get decided implicitly.

- **Admin MCP surface.** The storyboard's frame 4 uses a second MCP app for admin configuration. Its shape isn't covered here; it needs its own direction doc. My guess: same three-mode framework, different tools registered, different (merchant-facing) copy.
- **Multi-product future.** The existing plan's FU-2 scoped this. The three-mode framework supports multi-product naturally — each product is just a different tool. No structural decision needed until we actually ship it.
- **Theming scope for the bundled HTML bundle.** Scoped in `bundled-html-open-questions.md`. Q1–Q4 still open.
- **`ctx.respond()` precise API shape.** The shape above is illustrative. The actual method signatures, return types, and how `withNudge()` composes with other response modifiers needs a small design pass before the first commit.

---

## Immediate next steps

1. **Tool annotations PR lands** (`tool-annotations-pr-handoff.md`). Independent of this direction change. Ships first because it's low-risk and closes a compliance gap.
2. **Team review of this document.** Anyone with strong objections to the deprecation list speaks now. The tabs and About are the two items most likely to get pushback.
3. **Prebuilt HTML bundle Q1–Q4 answered** (`bundled-html-open-questions.md`). Blocker for the 60-second DX story.
4. **`ctx.respond()` design pass.** Small doc, ~1 page, nails the actual method signatures.
5. **Cut the deprecated exports from `@solvapay/react/mcp`.** Single commit, single revert path if something goes sideways.
6. **`registerPayable` handler signature change.** Second commit, landed with a migration note in the example server.
7. **Reshape `McpAppShell` to remove tabs.** Third commit. This is the visible one.

After those six, the SDK matches the direction in this document. Total effort estimate: 3–5 days of one person focused, assuming annotations PR lands in parallel on day 1.

---

## What this document is not

- Not a design spec. Wireframes of the three surviving surfaces come in a separate artifact after this direction is agreed.
- Not a replacement for the admin MCP surface plan. That's its own document.
- Not final. The `ctx.respond()` shape is the one place I'm least confident in; expect iteration on the API before it ships.

## What this document is

- A stance on what we're building and why it's different from a generic MCP checkout.
- A concrete list of what's being kept, changed, promoted, and cut from the existing plan.
- A basis for the `CLAUDE.md` rules file that coding assistants read during implementation.
