---
name: dev-refresh-widget-header
overview: Add an optional, dev-only refresh control to the `McpAppShell` header that calls the existing `onRefreshBootstrap`, opt-in via a new `showDevRefresh` prop on `<McpApp>` so the SDK stays framework-agnostic and the example app gates it with `import.meta.env.DEV`.
todos:
  - id: sdk-prop
    content: Add showDevRefresh prop to McpApp + McpAppShell and forward through to ShellHeader
    status: pending
  - id: shell-header
    content: Implement refresh button + spin state inside ShellHeader, gated by showDevRefresh && onRefreshBootstrap and isChrome
    status: pending
  - id: styles
    content: Add .solvapay-mcp-shell-refresh styles, header row wrapper, and spin keyframes in styles.css
    status: pending
  - id: example-wire
    content: Pass showDevRefresh={import.meta.env.DEV} in examples/mcp-checkout-app/src/mcp-app.tsx
    status: pending
  - id: tests
    content: Extend McpAppShell.test.tsx to cover present/absent button and click → onRefreshBootstrap wiring
    status: pending
isProject: false
---

## Why this shape

The SDK already has all the refresh plumbing we need — [McpApp.tsx](solvapay-sdk/packages/react/src/mcp/McpApp.tsx) exposes `refreshBootstrap` to the shell via `onRefreshBootstrap`, which re-calls `fetchMcpBootstrap(app)` and re-seeds hook caches. We just need a user-triggerable entry point for development.

The MCP Apps rules in [.cursor/rules/mcp-apps-sdk.mdc](solvapay-sdk/.cursor/rules/mcp-apps-sdk.mdc) push back on chrome controls in production widgets ("SaaS dashboard embedded in Claude" anti-pattern), so we:

- Keep the button **off by default** in the SDK.
- Expose it via an **opt-in prop**, not by reading `import.meta.env` inside `@solvapay/react` (the SDK ships as a library to consumers who may not use Vite — hard-coding `import.meta.env.DEV` would leak Vite semantics into every build).
- Let the example app flip the prop with `import.meta.env.DEV` because that surface is Vite-built and demo-oriented.
- Only render it on **chrome surfaces** (`checkout`, `account`, `topup`) — the shell already skips mount-refresh on `paywall` / `nudge` for a reason (re-calling `upgrade` would clobber the gate), and the header itself only renders when `isChrome` is true, so this falls out naturally.

## Changes

### 1. `<McpApp>` — new prop `showDevRefresh`

`solvapay-sdk/packages/react/src/mcp/McpApp.tsx`

- Add `showDevRefresh?: boolean` to `McpAppProps` with a short comment: "Dev-only affordance; consumers should gate with `import.meta.env.DEV` (or equivalent)."
- Forward it to `<McpAppShell showDevRefresh={showDevRefresh} ... />` in the existing render around line 533.

### 2. `<McpAppShell>` / `ShellHeader` — render the button

`solvapay-sdk/packages/react/src/mcp/McpAppShell.tsx`

- Extend `McpAppShellProps` and `ShellHeader` props with `showDevRefresh?: boolean` and an `onRefresh?: () => void | Promise<void>`.
- In the component, pass `onRefresh={onRefreshBootstrap}` to `<ShellHeader>` only when `isChrome` and `showDevRefresh && onRefreshBootstrap` are both truthy.
- Inside `ShellHeader`, add a trailing `<button type="button" class="solvapay-mcp-shell-refresh" aria-label="Refresh (dev)" title="Refresh (dev)">` with an inline refresh SVG. Wire a `refreshing` state that:
  - Disables the button while the promise is pending.
  - Applies a `data-refreshing="true"` attribute for the spin animation.
  - Swallows errors (`.catch(() => {})`) to match `onRefreshBootstrap`'s soft-signal contract.

### 3. Styles + icon

`solvapay-sdk/packages/react/src/mcp/styles.css`

- Add `.solvapay-mcp-shell-refresh` (borderless icon button, aligned to the end of the header title row, uses existing CSS variables).
- Add a `@keyframes solvapay-mcp-spin` and `[data-refreshing='true'] svg { animation: ... }` rule.
- Update the `.solvapay-mcp-shell-header` rule (currently `flex-direction: column; gap: 12px`) to keep the brand + title in a column while the refresh button floats top-right — easiest option is to wrap title + button in a new `.solvapay-mcp-shell-header-row` flex row.

Inline refresh glyph lives in `ShellHeader` (matches the inline pattern of `ExternalLinkGlyph` in [components/ExternalLinkGlyph.tsx](solvapay-sdk/packages/react/src/components/ExternalLinkGlyph.tsx)). No separate export needed unless reused.

### 4. Example app wires it dev-only

`solvapay-sdk/examples/mcp-checkout-app/src/mcp-app.tsx`

```tsx
createRoot(rootEl).render(
  <McpApp
    app={app}
    applyContext={applyContext}
    showDevRefresh={import.meta.env.DEV}
  />,
)
```

This is the only place `import.meta.env.DEV` appears; Vite strips it to `false` on `pnpm build` so the button is absent in production bundles.

### 5. Tests

`solvapay-sdk/packages/react/src/mcp/__tests__/McpAppShell.test.tsx`

- New cases:
  - Button is absent when `showDevRefresh` is falsy (default).
  - Button renders on `checkout`/`account`/`topup` when `showDevRefresh && onRefreshBootstrap` are set, and clicking it invokes `onRefreshBootstrap` exactly once.
  - Button is absent on `paywall` / `nudge` (falls out of `isChrome` — sanity assertion).

Existing tests should keep passing since the default is opt-out.

## Non-goals

- No refresh affordance on `paywall` / `nudge` — intentional, per the mount-refresh skip in `McpAppShell` (lines ~148-164).
- No auto-refresh-on-focus or polling — the host already drives re-invocation and `toolresult` notifications.
- No exported `RefreshGlyph` component unless a future consumer asks for it.