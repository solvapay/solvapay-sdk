---
name: mcp dark mode fix
overview: Restore dark-mode fidelity across the MCP React surface by adding a dark palette to the core primitive stylesheet, bridging the primitive palette onto MCP-Apps spec tokens inside the MCP shell, and providing `[data-theme="dark"]` overrides for the non-spec custom CSS variables. Verify manually inside `examples/mcp-checkout-app` by toggling `data-theme` on `<html>`.
todos:
  - id: core-dark-palette
    content: Add `[data-theme="dark"]` + `prefers-color-scheme` dark palette to `packages/react/src/styles.css`.
    status: pending
  - id: mcp-bridge
    content: Bridge `--solvapay-*` onto MCP spec vars inside `.solvapay-mcp-main` in `packages/react/src/mcp/styles.css` (host palette flows into primitives).
    status: pending
  - id: mcp-dark-overrides
    content: Declare non-spec custom vars in `:root` and override them in `[data-theme="dark"]` inside `packages/react/src/mcp/styles.css`.
    status: pending
  - id: shadow-theme
    content: Replace hardcoded shadows on `.solvapay-mcp-card` and `.solvapay-mcp-tour-popover` with `--shadow-sm` / `--shadow-lg`, with dark overrides.
    status: pending
  - id: verification-doc
    content: Document the manual dark-mode verification recipe in `examples/mcp-checkout-app/README.md`.
    status: pending
isProject: false
---

## Root cause

`applyDocumentTheme("dark")` only sets `data-theme="dark"` and `color-scheme: dark` on `<html>` — swapping CSS variables is the SDK's job. Today neither stylesheet ships a dark palette, so:

- `@solvapay/react/styles.css` primitives (`PlanSelector`, `PaymentForm`, `AmountPicker`, `CurrentPlanCard`, `CancelledPlanNotice`, `UsageMeter`, `TopupForm`, `BalanceBadge`, `CreditGate`, `PaywallNotice`, `CheckoutSummary`) stay light because `--solvapay-surface/accent/muted/border/...` are hardcoded to light HSL values with no override. This is what produces the white "Pay as you go" / "Unlimited" cards in the Claude Desktop screenshot.
- `@solvapay/react/mcp/styles.css` uses a mix of MCP spec vars (good — hosts override those) and **non-spec custom vars** (`--color-background-accent|subtle|elevated|raised|success-subtle`, `--color-border-default`, `--color-text-on-accent|on-primary`) with hardcoded light fallbacks that hosts never populate.
- `.solvapay-mcp-card`, `.solvapay-mcp-tour-popover` also hardcode `rgba(15,23,42,0.05)` / `rgba(16,24,40,0.12)` box-shadows tuned for light surfaces.

## Fix

### 1. Add a dark palette to the primitive stylesheet

File: [packages/react/src/styles.css](packages/react/src/styles.css)

- Append a `[data-theme="dark"]` block immediately after the existing `:root` palette (lines 11–23) that redefines every `--solvapay-*` color var for dark. Proposed (tuned to match the host-dark surfaces ChatGPT/Claude/MCP Jam ship):

```css
[data-theme='dark'] {
  --solvapay-accent: hsl(210 40% 96%);
  --solvapay-accent-foreground: hsl(222 47% 11%);
  --solvapay-accent-hover: hsl(210 40% 86%);
  --solvapay-surface: hsl(222 47% 13%);
  --solvapay-muted: hsl(217 33% 20%);
  --solvapay-muted-foreground: hsl(215 20% 70%);
  --solvapay-border: hsl(217 33% 25%);
  --solvapay-destructive: hsl(0 70% 70%);
  --solvapay-warning: hsl(38 92% 62%);
}
```

- Add a `prefers-color-scheme` guard so web consumers who don't call `applyDocumentTheme` still opt in without regressing explicit `data-theme="light"` sites:

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    /* same overrides as above */
  }
}
```

- (Optional nicety) Audit the handful of `rgba(...)` literals that are used for shadows or disabled surfaces — none today in `styles.css`, so no changes needed.

### 2. Bridge `--solvapay-*` onto MCP-Apps spec vars inside the MCP shell

File: [packages/react/src/mcp/styles.css](packages/react/src/mcp/styles.css)

- Inside `.solvapay-mcp-main` (the wrapper from `[packages/react/src/mcp/McpApp.tsx](packages/react/src/mcp/McpApp.tsx)` line 507), remap the primitive palette onto the host-supplied spec vars. Host-provided `--color-*` inlined on `<html>` wins automatically, so ChatGPT/Claude palettes flow into every primitive:

```css
.solvapay-mcp-main {
  --solvapay-surface: var(--color-background-secondary, var(--solvapay-surface));
  --solvapay-muted: var(--color-background-tertiary, var(--solvapay-muted));
  --solvapay-border: var(--color-border-secondary, var(--solvapay-border));
  --solvapay-accent: var(--color-text-primary, var(--solvapay-accent));
  --solvapay-accent-foreground: var(
    --color-background-primary,
    var(--solvapay-accent-foreground)
  );
  --solvapay-muted-foreground: var(--color-text-secondary, var(--solvapay-muted-foreground));
  --solvapay-destructive: var(--color-text-danger, var(--solvapay-destructive));
  --solvapay-warning: var(--color-text-warning, var(--solvapay-warning));
}
```

The bridge is theme-agnostic — when `data-theme="dark"` is set without host vars, the step-1 dark palette is the fallback, so primitives still render correctly.

### 3. Add dark fallbacks for the non-spec custom vars used only by the MCP shell

File: [packages/react/src/mcp/styles.css](packages/react/src/mcp/styles.css)

- Declare the non-spec vars once in `:root` (alongside the existing implicit light fallbacks) and add a `[data-theme="dark"]` block with dark values. Cites: current hardcoded usages at lines 226, 276, 332, 336–338, 442, 446, 587, 643, 660, 664, 737, 739, 775, 785, 820, 844, 885, 933 in [packages/react/src/mcp/styles.css](packages/react/src/mcp/styles.css).

```css
:root {
  --color-background-accent: #0f172a;
  --color-background-subtle: #f9fafb;
  --color-background-elevated: #ffffff;
  --color-background-raised: #eef2f6;
  --color-background-success-subtle: #ecfdf5;
  --color-border-default: #e4e7ec;
  --color-text-on-accent: #ffffff;
  --color-text-on-primary: #ffffff;
}

[data-theme='dark'] {
  --color-background-accent: #f8fafc;
  --color-background-subtle: #1e293b;
  --color-background-elevated: #0f172a;
  --color-background-raised: #1f2937;
  --color-background-success-subtle: #064e3b;
  --color-border-default: #334155;
  --color-text-on-accent: #0f172a;
  --color-text-on-primary: #0f172a;
  --color-text-success: #6ee7b7;
}
```

- Keep the existing `var(--color-background-accent, #0f172a)` etc. call sites untouched — the `:root` declaration turns the hardcoded fallback into a dead path for the default light theme, and the `[data-theme="dark"]` block provides the dark override.

### 4. Fix the two hardcoded shadows

File: [packages/react/src/mcp/styles.css](packages/react/src/mcp/styles.css)

- `.solvapay-mcp-card` (line 74): rely solely on the `--shadow-sm` spec var with a transparent fallback so dark cards don't ship a light-only shadow:

```css
box-shadow: var(--shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.05));
```

  Then add a dark fallback via the `[data-theme="dark"]` block:

```css
[data-theme='dark'] {
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
}
```

- `.solvapay-mcp-tour-popover` (line 738): swap the inline `0 8px 24px rgba(16,24,40,0.12)` for `var(--shadow-lg, 0 8px 24px rgba(16,24,40,0.12))` and declare `--shadow-lg` in both light and dark blocks.

### 5. Manual verification recipe

- In [examples/mcp-checkout-app/mcp-app.html](examples/mcp-checkout-app/mcp-app.html), no code change needed. Document the toggle in `examples/mcp-checkout-app/README.md` (one short paragraph):

  1. `pnpm --filter mcp-checkout-app dev`.
  2. Open the preview, then in DevTools run `document.documentElement.setAttribute('data-theme','dark')` to simulate a dark host. Run again with `'light'` to return.
  3. Walk the four surfaces that regress today (plan grid, top-up amount picker, account details, success receipt) — each should now render on a dark surface with legible text.
  4. For a palette-override pass, additionally run:

     ```js
     Object.assign(document.documentElement.style, {
       '--color-background-primary': '#0b1220',
       '--color-background-secondary': '#0f172a',
       '--color-text-primary': '#e2e8f0',
       '--color-text-secondary': '#94a3b8',
       '--color-border-secondary': '#1e293b',
     })
     ```

     to confirm the primitive bridge picks up host-provided spec vars.

### Out of scope (flag as follow-ups)

- Renaming the non-spec `--color-background-accent/subtle/elevated/raised/success-subtle`, `--color-border-default`, `--color-text-on-accent/on-primary` to a `--solvapay-mcp-*` namespace so they don't shadow spec names. Mechanical but noisy; worth a separate PR.
- Adding a Storybook/Chromatic theme matrix (you opted for manual verification).

## Affected files

- [packages/react/src/styles.css](packages/react/src/styles.css) — add dark palette + `prefers-color-scheme` fallback.
- [packages/react/src/mcp/styles.css](packages/react/src/mcp/styles.css) — bridge `--solvapay-*` to spec vars inside `.solvapay-mcp-main`, declare non-spec custom vars in `:root`, add `[data-theme="dark"]` block, add theme-aware shadows.
- [examples/mcp-checkout-app/README.md](examples/mcp-checkout-app/README.md) — short "Verifying dark mode" section.