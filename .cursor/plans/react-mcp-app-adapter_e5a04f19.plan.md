---
name: Reusable MCP App adapter for @solvapay/react
overview: Extract the ad-hoc `mcpAdapter` shipped in `examples/mcp-checkout-app` into a first-class export so any MCP App can write `<SolvaPayProvider {...createMcpAppAdapter(app)}>` and reuse every existing hook / component with an MCP transport instead of HTTP. Covers the shape of the overrides surface (single `transport` prop vs broader `SolvaPayProviderProps`), package layout (subpath export vs dedicated package), and the migration path for the MCP checkout example.
todos:
  - id: audit-overrides
    content: Inventory every place `SolvaPayProvider` currently calls `fetch` (or accepts a fetch override) vs accepts typed overrides (`checkPurchase`, `createPayment`, `processPayment`). Confirm which hooks route via which path (`useBalance`, `useProduct`, `useMerchant`, `cancel/reactivate/activate`, `usePlans`)
    status: pending
  - id: pick-shape
    content: "Decide: broaden `SolvaPayProviderProps` with a typed override for each hook that currently uses `fetch`, OR introduce a single `transport: SolvaPayTransport` prop that exposes a unified `{ checkPurchase, listPlans, getProduct, getMerchant, getBalance, createPayment, processPayment, createCheckoutSession, createCustomerSession, createTopupPaymentIntent, activatePlan, cancelRenewal, reactivateRenewal, trackUsage }` surface"
    status: pending
  - id: implement-transport
    content: Implement the chosen shape inside `packages/react/src`. If `transport`: add `SolvaPayTransport` type + a default HTTP implementation (wrapping the current `config.fetch` behavior) so existing consumers keep working with zero changes
    status: pending
  - id: createmcpappadapter
    content: "Ship `createMcpAppAdapter(app: App): SolvaPayTransport` (or the equivalent props object) from `@solvapay/react/mcp` subpath. Each method wraps `app.callServerTool` + the `unwrap` helper. Re-export the MCP tool-name constants so servers and clients share one source of truth"
    status: pending
  - id: package-layout
    content: "Decide subpath (`@solvapay/react/mcp`) vs dedicated package (`@solvapay/mcp-app`). Subpath is simpler, dedicated package avoids forcing the `@modelcontextprotocol/ext-apps` peer on every React consumer. Recommend subpath + type-only import from `@modelcontextprotocol/ext-apps` so the peer stays optional"
    status: pending
  - id: migrate-example
    content: "Rewrite `examples/mcp-checkout-app/src/mcp-adapter.ts` to re-export from `@solvapay/react/mcp`. Replace the local `checkPurchase / createCheckoutSession / createCustomerSession` with the shared transport. Expected diff: delete ~60 lines, keep only the MCP-app specific `open_checkout` bootstrap"
    status: pending
  - id: docs-and-tests
    content: "Add a doc page under docs/mcp-server/ (or wherever MCP App guides live) showing `<SolvaPayProvider {...createMcpAppAdapter(app)}>`. Unit-test the transport contract against a mock MCP `App` to prevent tool-name drift"
    status: pending
  - id: downstream-unblock
    content: "Signal that [react-provider-loading-vs-refetching_c2d8b3a7.plan.md](solvapay-sdk/.cursor/plans/react-provider-loading-vs-refetching_c2d8b3a7.plan.md) is now unblocked — its `locate` todo should be refreshed against the new fetch-owner (provider vs transport vs shared hook)"
    status: pending
isProject: false
---

## Why this plan exists

Promoted out of [`mcp-checkout-app_poc_55ffe77e.plan.md`](solvapay-sdk/.cursor/plans/mcp-checkout-app_poc_55ffe77e.plan.md) §2 ("Reusable React adapter") so the refactor has a stable home: the PoC plan it used to live in is now marked Superseded by the [hosted-button pivot](solvapay-sdk/.cursor/plans/mcp-checkout-app_hosted-button-pivot_b3d9c1a2.plan.md). Leaving the refactor inside a superseded plan makes the dependency graph fragile for downstream plans (like the loading-vs-refetching fix that is explicitly blocked on this work).

## Status in-example today

`examples/mcp-checkout-app/src/mcp-adapter.ts` already demonstrates the pattern end-to-end:

- `checkPurchase` is a typed `SolvaPayProviderProps` override → feeds `usePurchase`
- `createCheckoutSession` / `createCustomerSession` are ad-hoc wrappers the example calls directly to populate hosted-checkout `<a target="_blank">` hrefs
- Stripe-flow overrides (`createPayment`, `processPayment`) were removed in the pivot — they are not exercised by the MCP App because Stripe Elements is blocked inside the host sandbox

So in practice the MCP App only needs a subset of the overrides surface today: "read purchase state" + "mint hosted-URL sessions". A proper refactor still needs to cover the Stripe-flow tools because other MCP hosts (not `basic-host`) may allow Elements — the shared transport should be complete, not "just what this example needs".

## Non-goals

- Moving any logic out of `@solvapay/core` / `@solvapay/server`. The MCP tool *handlers* on the server stay exactly as they are today; this refactor is purely on the React / browser side.
- Shipping this in the same PR as the MCP tool-surface parity work ([referenced in the superseded PoC plan §1](solvapay-sdk/.cursor/plans/mcp-checkout-app_poc_55ffe77e.plan.md)). The adapter shape can land first with just the four checkout tools wired; missing tools surface later as `unsupported` errors that the caller can feature-detect.

## Downstream plans

- [`react-provider-loading-vs-refetching_c2d8b3a7.plan.md`](solvapay-sdk/.cursor/plans/react-provider-loading-vs-refetching_c2d8b3a7.plan.md) — blocked on the shape decision from the `pick-shape` todo above. Applying that fix before this refactor means doing it twice, once inline and once after `fetchPurchase` potentially moves behind `SolvaPayTransport`.
