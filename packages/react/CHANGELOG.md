# @solvapay/react changelog

This changelog is hand-maintained for notable consumer-visible changes shipped
on the `preview` tag. Tagged releases on npm follow the
`1.0.x-preview.N` cadence bumped by
[`publish-preview.yml`](../../.github/workflows/publish-preview.yml); entries
below are grouped by the first preview that contains them.

## Unreleased

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
