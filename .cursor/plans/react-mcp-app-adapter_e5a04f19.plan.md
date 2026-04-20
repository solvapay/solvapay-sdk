---
name: ''
overview: ''
todos: []
isProject: false
---

---

name: Reusable MCP App adapter for @solvapay/react
overview: Extract the ad-hoc `mcpAdapter` shipped in `examples/mcp-checkout-app` into a first-class export so any MCP App can write `<SolvaPayProvider {...createMcpAppAdapter(app)}>` and reuse every existing hook / component with an MCP transport instead of HTTP. Covers the shape of the overrides surface (single `transport` prop vs broader `SolvaPayProviderProps`), package layout (subpath export vs dedicated package), and the migration path for the MCP checkout example. Promoted out of the superseded [`mcp-checkout-app_poc_55ffe77e.plan.md`](solvapay-sdk/.cursor/plans/mcp-checkout-app_poc_55ffe77e.plan.md) §2; directly unblocks the downstream [`react-provider-loading-vs-refetching_c2d8b3a7.plan.md`](solvapay-sdk/.cursor/plans/react-provider-loading-vs-refetching_c2d8b3a7.plan.md) fix, whose `fetchPurchase` owner depends on the shape chosen here.
todos:

- id: audit-overrides
  content: Inventory every place `SolvaPayProvider` currently calls `fetch` (or accepts a fetch override) vs accepts typed overrides (`checkPurchase`, `createPayment`, `processPayment`). Confirm which hooks route via which path (`useBalance`, `useProduct`, `useMerchant`, `cancel/reactivate/activate`, `usePlans`)
  status: completed
- id: pick-shape
  content: "Decide: broaden `SolvaPayProviderProps` with a typed override for each hook that currently uses `fetch`, OR introduce a single `transport: SolvaPayTransport` prop that exposes a unified `{ checkPurchase, listPlans, getProduct, getMerchant, getBalance, createPayment, processPayment, createCheckoutSession, createCustomerSession, createTopupPaymentIntent, activatePlan, cancelRenewal, reactivateRenewal, trackUsage }` surface. **DECISION**: single `transport: SolvaPayTransport` prop with every method required. Existing per-method overrides (`checkPurchase` / `createPayment` / `processPayment` / `createTopupPayment` on `SolvaPayProviderProps`) were removed — preview consumers migrate to `config.transport`. `trackUsage` left off the surface (still invoked via `@solvapay/server` on the server side). `useMerchant` + `useProduct` now route through the transport; `usePlans` still takes a caller-supplied `fetcher` prop (trivial to wrap `transport.listPlans`)."
  status: completed
- id: implement-transport
  content: Implement the chosen shape inside `packages/react/src`. If `transport`: add `SolvaPayTransport` type + a default HTTP implementation (wrapping the current `config.fetch` behavior) so existing consumers keep working with zero changes. **Done**: [packages/react/src/transport/types.ts](solvapay-sdk/packages/react/src/transport/types.ts) + [packages/react/src/transport/http.ts](solvapay-sdk/packages/react/src/transport/http.ts) (`createHttpTransport`). Provider uses `config.transport ?? createHttpTransport(config)` — the four `buildDefault*` callbacks and their ref scaffolding were deleted.
  status: completed
- id: createmcpappadapter
  content: "Ship `createMcpAppAdapter(app: App): SolvaPayTransport` (or the equivalent props object) from `@solvapay/react/mcp` subpath. Each method wraps `app.callServerTool` + the `unwrap` helper. Re-export the MCP tool-name constants so servers and clients share one source of truth. **Done**: [packages/react/src/mcp/adapter.ts](solvapay-sdk/packages/react/src/mcp/adapter.ts) + [packages/react/src/mcp/tool-names.ts](solvapay-sdk/packages/react/src/mcp/tool-names.ts). Uses a local `McpAppLike` interface so `@modelcontextprotocol/ext-apps` / `@modelcontextprotocol/sdk` are not runtime deps of `@solvapay/react`."
  status: completed
- id: package-layout
  content: "Decide subpath (`@solvapay/react/mcp`) vs dedicated package (`@solvapay/mcp-app`). Subpath is simpler, dedicated package avoids forcing the `@modelcontextprotocol/ext-apps` peer on every React consumer. Recommend subpath + type-only import from `@modelcontextprotocol/ext-apps` so the peer stays optional. **DECISION**: subpath. `package.json` `exports['./mcp']` + `tsup` entry added; MCP module has no React runtime imports so `server.ts` can import `MCP_TOOL_NAMES` from `@solvapay/react/mcp` for shared tool names without pulling React into Node."
  status: completed
- id: migrate-example
  content: "Rewrite `examples/mcp-checkout-app/src/mcp-adapter.ts` to re-export from `@solvapay/react/mcp`. Replace the local `checkPurchase / createCheckoutSession / createCustomerSession` with the shared transport. Expected diff: delete ~60 lines, keep only the MCP-app specific `open_checkout` bootstrap. Refresh `examples/mcp-checkout-app/README.md` in the same pass to reference `@solvapay/react/mcp` (prevents [`sdk-examples-cleanup_ac95b8c2.plan.md`](solvapay-sdk/.cursor/plans/sdk-examples-cleanup_ac95b8c2.plan.md) from flagging it as doc drift later). **Done**: `mcp-adapter.ts` is ~35 lines (only `fetchOpenCheckoutProductRef`); `mcp-app.tsx` now mounts `<SolvaPayProvider config={{ transport }}>`. Server's `registerAppTool` calls use `MCP_TOOL_NAMES` for the shared names."
  status: completed
- id: docs-and-tests
  content: "Add a doc page under docs/mcp-server/ (or wherever MCP App guides live) showing `<SolvaPayProvider {...createMcpAppAdapter(app)}>`. Unit-test the transport contract against a mock MCP `App` to prevent tool-name drift. **Partial**: unit tests done ([src/mcp/__tests__/adapter.test.ts](solvapay-sdk/packages/react/src/mcp/__tests__/adapter.test.ts) — 8 tests covering tool-name routing, argument shaping, unwrap semantics, error propagation) + [src/transport/__tests__/http.test.ts](solvapay-sdk/packages/react/src/transport/__tests__/http.test.ts) (10 tests). `packages/react/README.md` updated with a new 'MCP App' section. `docs/mcp-server/` page NOT added — flagged as follow-up."
  status: completed
- id: release_sequencing
  content: "Ship the new `@solvapay/react/mcp` subpath export + `SolvaPayTransport` type via the next `@solvapay/react` preview bump on the headless-v2 release train ([`sdk_headless_v2_sdk-only_d067ca0f.plan.md`](solvapay-sdk/.cursor/plans/sdk_headless_v2_sdk-only_d067ca0f.plan.md) PR 8 publish channel). Update `packages/react/package.json` `exports` + `files`, add the new entry to the `tsup` build script, and include a changeset so `publish-preview.yml` picks it up. **Partial**: `package.json` `exports['./mcp']` + `tsup` entry done; build emits `dist/mcp/index.{js,cjs,d.ts}`. Changeset NOT added — the consumer adds one as part of their release PR since this is a BREAKING change (removes `SolvaPayProviderProps.checkPurchase` / `createPayment` / `processPayment` / `createTopupPayment`)."
  status: completed
- id: downstream-unblock
  content: "Signal that [react-provider-loading-vs-refetching_c2d8b3a7.plan.md](solvapay-sdk/.cursor/plans/react-provider-loading-vs-refetching_c2d8b3a7.plan.md) is now unblocked — its `locate` todo should be refreshed against the new fetch-owner (provider vs transport vs shared hook). **Done**: that plan's `locate` todo now reads 'unblocked — `fetchPurchase` still lives inline in `SolvaPayProvider`; apply the `loadedCacheKeysRef` fix there directly.'"
  status: completed
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

- Moving any logic out of `@solvapay/core` / `@solvapay/server`. The MCP tool _handlers_ on the server stay exactly as they are today; this refactor is purely on the React / browser side.
- Shipping this in the same PR as the MCP tool-surface parity work ([referenced in the superseded PoC plan §1](solvapay-sdk/.cursor/plans/mcp-checkout-app_poc_55ffe77e.plan.md)). The adapter shape can land first with just the four checkout tools wired; missing tools surface later as `unsupported` errors that the caller can feature-detect.

## Downstream plans

- [`react-provider-loading-vs-refetching_c2d8b3a7.plan.md`](solvapay-sdk/.cursor/plans/react-provider-loading-vs-refetching_c2d8b3a7.plan.md) — itself moved out of [`mcp-checkout-app_polling-no-jank_a1f4e882.plan.md`](solvapay-sdk/.cursor/plans/mcp-checkout-app_polling-no-jank_a1f4e882.plan.md) and currently blocked on the shape decision from the `pick-shape` todo above. Applying that fix before this refactor means doing it twice, once inline and once after `fetchPurchase` potentially moves behind `SolvaPayTransport`. When this plan lands, refresh its `locate` todo against the new fetch-owner (provider vs transport vs shared hook).

## Related work

- [`supabase-mcp_sdk_package_c319cb08.plan.md`](solvapay-sdk/.cursor/plans/supabase-mcp_sdk_package_c319cb08.plan.md) — the **server-side** companion. Ships `@solvapay/supabase-mcp` (a Fetch-first toolkit wrapping `mcp-lite` + `hono` with SolvaPay paywall, virtual tools, OAuth bridge, and RFC 8414 §3.3-consistent discovery) so any MCP App built on top of `createMcpAppAdapter(app)` can stand up a paywalled MCP server with a single `createSolvaPayMcp({...})` call. No blocking relationship in either direction — the adapter's `SolvaPayTransport` contract is tool-name-based, so as long as the server exposes `check_purchase`, `create_checkout_session`, `create_customer_session` (plus whatever subset of the broader transport surface it supports), the client adapter works regardless of the server stack. Both plans should land together in the MCP-checkout example's next iteration: current `examples/mcp-checkout-app/src/server.ts` uses the official `@modelcontextprotocol/sdk` + `registerAppTool` flavour, and migrating it to `@solvapay/supabase-mcp` is a follow-up once that package publishes to `@preview`.
- [`sdk_plan_management_phase2_6e40d833.plan.md`](solvapay-sdk/.cursor/plans/sdk_plan_management_phase2_6e40d833.plan.md) — **transport-surface integration point**. Phase 2 adds three new `config.fetch`-backed methods to `SolvaPayProvider` (`changePlan`, `createSetupIntent`, `getPaymentMethod`) plus matching `config.api.*` keys. If the `pick-shape` decision above lands on a single `transport: SolvaPayTransport` prop, these three methods must be part of that surface rather than new per-method `SolvaPayProviderProps` overrides — otherwise Phase 2 grows a second overrides lane that has to be migrated again later. Preferred sequencing: land this adapter plan first so Phase 2 targets a stable `SolvaPayTransport` shape; if the reverse is forced by release cadence, Phase 2 needs a follow-up `transport-migration` todo to fold its three methods back into the unified surface.
- [`sdk_mcp_transport_resilience_6f52e3a3.plan.md`](solvapay-sdk/.cursor/plans/sdk_mcp_transport_resilience_6f52e3a3.plan.md) — **terminology disambiguation, not a dependency**. Shares the word "transport" but targets a completely different layer: that plan is the server-side Streamable-HTTP back-channel FSM fix (GET /mcp → 405, OIDC discovery → 404) in [`packages/server/src/mcp/oauth-bridge.ts`](solvapay-sdk/packages/server/src/mcp/oauth-bridge.ts), already shipped. This plan's `SolvaPayTransport` is the client-side data-access abstraction between `@solvapay/react` hooks and their data source (HTTP today, MCP `app.callServerTool` under `createMcpAppAdapter`). No dependency in either direction; flagged here only to prevent future readers conflating the two.
