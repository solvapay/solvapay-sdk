# @solvapay/react changelog

This changelog is hand-maintained for notable consumer-visible changes shipped
on the `preview` tag. Tagged releases on npm follow the
`1.0.x-preview.N` cadence bumped by
[`publish-preview.yml`](../../.github/workflows/publish-preview.yml); entries
below are grouped by the first preview that contains them.

## Unreleased

### `@solvapay/react/mcp` — per-view primitives + `<McpApp>` compound (minor, additive)

The MCP App reference views (`checkout`, `account`, `topup`, `activate`) that
previously lived in `examples/mcp-checkout-app` have been lifted into
`@solvapay/react/mcp` as four composable primitives plus a thin compound
wrapper:

```tsx
import '@solvapay/react/styles.css'
import '@solvapay/react/mcp/styles.css'
import { App } from '@modelcontextprotocol/ext-apps'
import { McpApp } from '@solvapay/react/mcp'

const app = new App({ name: 'my-mcp-app', version: '1.0.0' })
createRoot(rootEl).render(<McpApp app={app} />)
```

Integrators who want a custom shell compose the primitives directly:

```tsx
import {
  McpCheckoutView,
  McpAccountView,
  McpTopupView,
  McpActivateView,
  McpViewRouter,
  fetchMcpBootstrap,
  createMcpFetch,
  createMcpAppAdapter,
  useStripeProbe,
} from '@solvapay/react/mcp'
```

Each view accepts a `classNames?: McpViewClassNames` partial for per-slot
overrides; defaults render the `solvapay-mcp-*` classes from the new
`@solvapay/react/mcp/styles.css` stylesheet. `<McpApp>` also takes a `views`
map for per-screen component overrides without losing routing.

### Seam fixes on primitives that the MCP views needed

Three additive primitive changes landed alongside the lift:

- **`<AmountPicker.Root emit="minor">`** — when set, `onChange` and
  `Confirm.onConfirm` deliver the amount in minor units (respects
  zero-decimal currencies like JPY). Default stays `'major'` for
  back-compat. `useAmountPicker().resolvedAmountMinor` is a new sibling to
  `resolvedAmount` for custom layouts. A new
  `getMinorUnitsPerMajor(currency)` util is exported from
  `@solvapay/react` for integrators doing conversions outside the picker.
- **`<AmountPicker.Root selector={…}>`** — accepts an externally-owned
  `UseTopupAmountSelectorReturn`, letting parent flows share state with
  the inner picker. `ActivationFlow.AmountPicker` now threads the flow's
  selector through this prop, so amounts picked in the sub-picker feed
  straight into `useActivation().retry()` without the old workaround.
- **`<LaunchCustomerPortalButton asChild>`** — renders the ready-state
  anchor via `Slot` so consumers can substitute a real `<button>` inside
  an anchor wrapper (matches the `ActivationFlow.ActivateButton`
  convention). Loading / error fallback buttons are untouched.

All three are additive — no consumer API moves or renames.

### Plans vs balance transactions (minor, behavioural filtering)

Credit top-ups now surface as balance transactions, not plans. `PurchaseInfo`
gains a `metadata?: Record<string, unknown>` field, and two new utilities —
`isPlanPurchase` / `isTopupPurchase` — classify structurally from
`planSnapshot`. The classification is applied inside `usePurchase()` so every
plan-shaped accessor is consistent:

- `activePurchase`, `activePaidPurchase`, `hasPaidPurchase`, `hasProduct`,
  and `cancelledPurchase` / `shouldShowCancelledNotice` (on
  `usePurchaseStatus`) all skip balance transactions.
- A new `balanceTransactions: PurchaseInfo[]` accessor on `usePurchase()`
  returns the complement.
- `purchases` (raw) is unchanged — the full ordering is still available for
  integrators that classify themselves.

`PurchaseInfo.planSnapshot.name` is now surfaced as a first-class field so
`<CurrentPlanCard>` renders a real plan name ("Pro Monthly") instead of the
opaque `planRef`. Legacy purchases without a snapshot name fall back to
`productName`. The `planRef` is retained only as `data-solvapay-current-plan-ref`
on the card root for QA hooks.

`<CurrentPlanCard>` also uses `copy.currentPlan.cycleUnit` to render
"500 kr / month" rather than "500 kr / monthly". Override any of
`weekly` / `monthly` / `quarterly` / `yearly` in your copy bundle to localise
the interval label.

Behavioural note for integrators who previously relied on top-ups surfacing on
`activePurchase`: drop to `purchases` (raw) to restore the old most-recent
ordering, or read from `balanceTransactions` directly.

### BREAKING: Unified `transport` replaces per-method provider overrides

`SolvaPayProvider` now takes a single `config.transport: SolvaPayTransport`
prop. The old per-method `SolvaPayProviderProps` overrides have been removed:

- `checkPurchase`
- `createPayment`
- `processPayment`
- `createTopupPayment`

Consumers passing any of those props must migrate to `config.transport`.

**Before:**

```tsx
<SolvaPayProvider
  checkPurchase={myCheckPurchase}
  createPayment={myCreatePayment}
  processPayment={myProcessPayment}
  createTopupPayment={myCreateTopupPayment}
>
  {children}
</SolvaPayProvider>
```

**After:**

```tsx
const transport: SolvaPayTransport = {
  checkPurchase: myCheckPurchase,
  createPayment: myCreatePayment,
  processPayment: myProcessPayment,
  createTopupPayment: myCreateTopupPayment,
  // ...plus every other required method; see types/transport.ts
}

<SolvaPayProvider config={{ transport }}>{children}</SolvaPayProvider>
```

HTTP consumers who never set those overrides are unaffected — the provider
falls back to `createHttpTransport(config)` automatically.

### Added: `@solvapay/react/mcp` subpath

Ships `createMcpAppAdapter(app)` which returns a `SolvaPayTransport` that
tunnels every data call through `app.callServerTool` instead of HTTP. Use it
when hosting the React tree inside an MCP App, where direct HTTP to your
backend is blocked by the host sandbox:

```tsx
import { createMcpAppAdapter } from '@solvapay/react/mcp'
<SolvaPayProvider config={{ transport: createMcpAppAdapter(app) }}>
  {children}
</SolvaPayProvider>
```

See the [MCP App integration guide](https://docs.solvapay.com/sdks/typescript/guides/mcp-app)
for the full walkthrough. Re-exports `MCP_TOOL_NAMES` so client and server
share a single source of truth for tool names.

### Added: account management components

- `<CurrentPlanCard>` — plan-type-aware summary card (recurring / one-time /
  usage-based), payment-method display, Update card + Cancel plan actions.
  Returns `null` when there is no active purchase.
- `<LaunchCustomerPortalButton>` — pre-fetches `createCustomerSession` on
  mount and renders a real `<a target="_blank">` anchor (MCP sandbox-safe).
- `<UpdatePaymentMethodButton mode="portal">` — thin wrapper around
  `<LaunchCustomerPortalButton>`. The `mode` prop reserves space for a
  future `"inline"` value without breaking the API.

### Added: `usePaymentMethod` hook

Fetches the customer's default payment method through
`transport.getPaymentMethod()`. Transport-keyed single-flight cache, mirrors
the `useMerchant` pattern. Returns `null` on error (graceful hide, no
`onError` re-emit — the HTTP transport already invokes `config.onError`
before throwing).

### Fixed

- `SolvaPayProvider` no longer flips `loading: true` for polling refetches
  when the customer has no purchases yet. `usePurchase` now exposes a
  separate `isRefetching` flag for background polls; gate initial skeletons
  on `loading` and render subtle refresh indicators on `isRefetching`.
- `LaunchCustomerPortalButton` captures `onError` via ref so parents passing
  an inline arrow no longer re-fire the pre-fetch effect on every render.
- `useMerchant`, `useProduct`, and `usePaymentMethod` no longer double-call
  `config.onError` — the HTTP transport already calls it before throwing.
