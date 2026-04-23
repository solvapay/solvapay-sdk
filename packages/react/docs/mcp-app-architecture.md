# MCP App architecture (ADR)

_Status: accepted — lifted in `@solvapay/react` `1.0.x-preview.N`_

## Context

The SolvaPay MCP App reference implementation originally lived entirely inside
`examples/mcp-checkout-app`:

- A single `mcp-app.tsx` owned `app.connect()`, host-context application, the
  `open_*` bootstrap fetch, a `<SolvaPayProvider>` mount, and a 4-way view
  router.
- `views/AccountView.tsx`, `views/TopupView.tsx`, `views/ActivateView.tsx`, and
  an inline `HostedCheckout` / `EmbeddedCheckout` pair composed the per-screen
  UIs from existing SDK primitives.
- `mcp-adapter.ts` exported helper functions (`fetchBootstrap`,
  `createMcpFetch`) plus a re-export of `createMcpAppAdapter`.

This was intentional — we wanted real integrator feedback before committing
the shape to the SDK surface. Three rounds of that feedback in, the shape is
stable: the views compose cleanly from existing primitives, the bootstrap
helpers are generic across MCP hosts, and the only interesting variance is
per-slot styling and an occasional per-view replacement.

## Decision

Lift the views, the bootstrap helpers, and a thin `<McpApp>` compound into
`@solvapay/react/mcp`. Ship three additive primitive seam fixes up front so
the lifted views don't need workarounds.

### API shape: hybrid

Both compound and primitive access are first-class:

- `<McpApp app={app} />` is the turnkey 5-line entrypoint for any MCP App
  built on `@modelcontextprotocol/ext-apps`. It mounts a `SolvaPayProvider`
  and wraps a thin `<McpAppShell>` around `<McpViewRouter>`.
- `<McpAppShell>` — in-iframe layout (header / sidebar / footer / paywall
  takeover) that surface-routes by `bootstrap.view`. There is no tab strip
  and no user-driven cross-surface navigation; the only in-session mutation
  is the paywall / nudge CTA flip back to the checkout surface.
- `<McpViewRouter>` — single `switch` on `McpViewKind` that resolves each
  view from `views?.*` overrides (falling back to the built-in primitive).
  Exported for integrators that own their own shell.
- `<McpCheckoutView />`, `<McpAccountView />`, `<McpTopupView />`,
  `<McpPaywallView />`, and `<McpNudgeView />` are the composable primitives
  underneath. Integrators who want a custom shell use them directly
  alongside `createMcpAppAdapter`, `fetchMcpBootstrap`, and `createMcpFetch`.
- `<McpUpsellStrip>` is the inline nudge primitive. `<McpNudgeView>`
  renders it alongside the merchant tool result; the ctx.respond follow-up
  wires it inline on the other surfaces.

There is **one implementation**: `<McpApp>` is a thin wrapper that composes
the same per-view primitives the custom-shell path uses. That means there is
no "compound tax" — behaviour is identical whether you render `<McpApp>` or
assemble the pieces yourself.

`<McpApp>` accepts a `views?: McpAppViewOverrides` map for per-screen
replacements (swap just `account` to ship a custom account screen) and a
`classNames?: McpViewClassNames` partial for per-slot style overrides.
Defaults render `solvapay-mcp-*` classes from the opt-in
`@solvapay/react/mcp/styles.css`.

### Surface routing

`bootstrap.view` locks the rendered surface for the invocation's lifetime.
The server chooses which surface by invoking the matching `open_*` intent
tool; the host forwards that tool name as part of `McpUiHostContext`;
`fetchMcpBootstrap` maps it to a `McpViewKind` and bakes it into the
bootstrap payload.

Legacy `'about'` / `'activate'` / `'usage'` values (from servers on older
versions) collapse to the nearest surviving surface:

- `'about'` → `checkout` (product info lives in tool descriptions + the
  `docs://solvapay/overview.md` resource; the checkout picker is the
  cold-start destination).
- `'activate'` → `checkout` (the Plan + Activate tabs merged; activation
  dispatch lives inside `PlanActivationDispatcher`).
- `'usage'` → `account` (credits + usage fold inline into the account
  view).

### Seam fixes — all three, up front

Three additive primitive changes landed as standalone commits before the lift
so the lifted views are pure refactor, not code with workarounds baked in:

1. **`AmountPicker.Root emit="minor"`** — moves the `Math.round(amount * 100)`
   dance off every integrator's first top-up. Default stays `'major'`
   (back-compat) and zero-decimal currencies (JPY, KRW, …) are respected.
2. **`AmountPicker.Root selector={…}`** — accepts an externally-owned
   selector so `ActivationFlow.AmountPicker` can share its
   `useTopupAmountSelector` instance with the inner picker. Pre-fix, the
   sub-picker had an isolated selector and its selection never reached the
   retry path.
3. **`LaunchCustomerPortalButton asChild`** — matches the
   `ActivationFlow.ActivateButton` convention so consumers can substitute a
   real `<button>` inside the anchor wrapper without DOM gymnastics.

All three are additive (new optional prop / new option value). No
consumer-facing rename, no behavioural change under the old defaults.

### Host integration stays in the example

`createMcpAppAdapter` already lived in `@solvapay/react/mcp`.
`fetchMcpBootstrap`, `createMcpFetch`, and `useStripeProbe` lifted. Server-
side `open_*` tool registration (`examples/mcp-checkout-app/src/server.ts`)
**stays put** — that's a host integration concern, not a SDK concern, and
the plumbing differs enough per-host that a generic wrapper would obscure
more than it simplifies. A separate follow-up
(`createSolvaPayMcpServer`) may lift that wiring later.

## Consequences

**Positive.**

- Integrators building a SolvaPay MCP App write ~10 lines of client code
  instead of ~700.
- Drop-in override surface (`views`, `classNames`) covers 90% of the
  customisation consumers actually ask for.
- The example shrinks to a verbatim demonstration of the public API —
  diverging from the SDK becomes obvious in review.
- The three seam fixes remove friction that was only being hit in the MCP
  views today but was always latent in the primitives.

**Neutral / managed.**

- `@solvapay/react/mcp` now directly renders copy from the default English
  bundle (`Loading account…`, `You're already subscribed`, …). Localising
  requires overriding those views via `McpAppViewOverrides` today; a
  follow-up can move the strings into the copy bundle if integrator demand
  warrants it.
- `@solvapay/react/mcp/styles.css` is a second opt-in stylesheet alongside
  `@solvapay/react/styles.css`. Consumers who want the turnkey look import
  both; consumers bringing their own CSS skip the MCP sheet.

**Rollback.** Every change is additive — reverting the commits restores the
previous example layout without breaking any consumer API. The seam-fix
props are new additions (not signature changes), so revert is clean.

## Escape hatch — raw `structuredContent` via `useMcpToolResult`

Integrators who don't mount `<McpApp>` or `<McpAppShell>` (e.g. they are
composing a fully custom widget on top of `createMcpAppAdapter`) can still
observe the host's `ui/notifications/tool-result` stream with the public
`useMcpToolResult` hook:

```tsx
import { App } from '@modelcontextprotocol/ext-apps'
import { useMcpToolResult } from '@solvapay/react/mcp'

function MyCustomWidget({ app }: { app: App }) {
  const { structuredContent, content, toolName } =
    useMcpToolResult<{ orderId: string }>(app)

  if (!structuredContent) return <p>Waiting for a tool result…</p>
  return (
    <section>
      <h2>{toolName}</h2>
      <pre>{JSON.stringify(structuredContent, null, 2)}</pre>
    </section>
  )
}
```

The hook subscribes via `app.addEventListener('toolresult', …)` when
available and falls back to the legacy DOM-style `ontoolresult` setter;
internally it uses `useSyncExternalStore` so concurrent renders always
observe a coherent snapshot. Error notifications are filtered out — the
consumer pairs the hook with whatever error UI they want driven off the
adapter promise.

