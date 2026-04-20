---
name: Reusable MCP App adapter for @solvapay/react — smoke-test in mcp-checkout-app
overview: The adapter refactor (extract `createMcpAppAdapter`, introduce `SolvaPayTransport`, ship `@solvapay/react/mcp` subpath, migrate the `mcp-checkout-app` example) has fully landed. This plan now tracks the only work still open on that workstream — end-to-end verification in basic-host against the `mcp-checkout-app` example, plus the doc page and changeset that were flagged as partial during the refactor. Unblocks nothing downstream; [`react-provider-loading-vs-refetching_c2d8b3a7.plan.md`](solvapay-sdk/.cursor/plans/react-provider-loading-vs-refetching_c2d8b3a7.plan.md) already shipped against the post-refactor layout.
todos:
  - id: smoke-prep
    content: "Land the in-flight working-tree fixes on `feature/mcp-account-management` so the smoke test runs against a clean tree. From `git status`: remove the double-`onError` re-emit in [useMerchant.ts](solvapay-sdk/packages/react/src/hooks/useMerchant.ts), [useProduct.ts](solvapay-sdk/packages/react/src/hooks/useProduct.ts), [usePaymentMethod.ts](solvapay-sdk/packages/react/src/hooks/usePaymentMethod.ts) (the HTTP transport already calls `config.onError` before throwing); capture `onError` via ref in [LaunchCustomerPortalButton.tsx](solvapay-sdk/packages/react/src/components/LaunchCustomerPortalButton.tsx) so inline-arrow parents don't re-fire the pre-fetch effect on every render; re-export `getPaymentMethodCore` from [packages/server/src/edge.ts](solvapay-sdk/packages/server/src/edge.ts) so the example's server can import it from `@solvapay/server` in Edge runtimes too."
    status: pending
  - id: smoke-run
    content: "Execute the 5-state manual smoke checklist below against a live SolvaPay backend + a fresh basic-host MCP session. Record the result inline under each state (pass/fail, any console noise, any unexpected tool calls observed in the `[mcp-checkout-app]` server trace log). Stop and file a separate plan for anything that fails — this plan only tracks the smoke run itself."
    status: pending
  - id: docs-page
    content: "Add `docs/mcp-server/react-sdk-adapter.mdx` (in the [docs](docs) repo) covering `<SolvaPayProvider config={{ transport: createMcpAppAdapter(app) }}>`. One working code block + the `MCP_TOOL_NAMES` table so server authors know which tool names the adapter expects. Link from the MCP server overview page. Flagged as follow-up during the `docs-and-tests` todo of the adapter refactor."
    status: pending
  - id: changeset
    content: "Add `.changeset/*.md` for `@solvapay/react` marking the breaking change (removal of `SolvaPayProviderProps.checkPurchase` / `createPayment` / `processPayment` / `createTopupPayment` in favour of `config.transport`). Required so the next `publish-preview.yml` run on the headless-v2 train picks it up. Flagged as follow-up during the `release_sequencing` todo of the adapter refactor."
    status: pending
isProject: false
---

## Done (adapter refactor)

The original 9 todos of this plan (`audit-overrides`, `pick-shape`, `implement-transport`, `createmcpappadapter`, `package-layout`, `migrate-example`, `docs-and-tests`, `release_sequencing`, `downstream-unblock`) all shipped. Summary of what landed:

- **`SolvaPayTransport` contract** — [packages/react/src/transport/types.ts](solvapay-sdk/packages/react/src/transport/types.ts) declares a single unified surface (`checkPurchase`, `createPayment`, `processPayment`, `createTopupPayment`, `getBalance`, `cancelRenewal`, `reactivateRenewal`, `activatePlan`, `createCheckoutSession`, `createCustomerSession`, `getMerchant`, `getProduct`, `listPlans`, `getPaymentMethod`). `trackUsage` is intentionally off-surface (stays server-side via `@solvapay/server`).
- **HTTP transport** — [packages/react/src/transport/http.ts](solvapay-sdk/packages/react/src/transport/http.ts) `createHttpTransport` wraps the old `config.fetch` behavior. `SolvaPayProvider` uses `config.transport ?? createHttpTransport(config)`; the previous four `buildDefault*` callbacks + ref scaffolding were deleted. The per-method overrides (`SolvaPayProviderProps.checkPurchase` / `createPayment` / `processPayment` / `createTopupPayment`) were removed — **breaking change**, consumers migrate to `config.transport`.
- **MCP App adapter** — [packages/react/src/mcp/adapter.ts](solvapay-sdk/packages/react/src/mcp/adapter.ts) + [packages/react/src/mcp/tool-names.ts](solvapay-sdk/packages/react/src/mcp/tool-names.ts). `createMcpAppAdapter(app)` routes every transport call through `app.callServerTool` + an `unwrap` helper. Uses a local `McpAppLike` interface so `@modelcontextprotocol/ext-apps` / `@modelcontextprotocol/sdk` are not runtime deps of `@solvapay/react`.
- **Subpath export** — [packages/react/package.json](solvapay-sdk/packages/react/package.json) `exports['./mcp']` + matching `tsup` entry in the `build` script emit `dist/mcp/index.{js,cjs,d.ts}`. Consumers import with `@solvapay/react/mcp`.
- **Example migration** — [examples/mcp-checkout-app/src/mcp-adapter.ts](solvapay-sdk/examples/mcp-checkout-app/src/mcp-adapter.ts) collapsed to ~39 lines (only `fetchOpenCheckoutProductRef`). [mcp-app.tsx](solvapay-sdk/examples/mcp-checkout-app/src/mcp-app.tsx) mounts `<SolvaPayProvider config={{ auth, transport }}>`. [server.ts](solvapay-sdk/examples/mcp-checkout-app/src/server.ts) uses `MCP_TOOL_NAMES` for every `registerAppTool` name so client/server can't drift.
- **Tests** — 8 adapter tests in [packages/react/src/mcp/__tests__/adapter.test.ts](solvapay-sdk/packages/react/src/mcp/__tests__/adapter.test.ts) + 10 HTTP-transport tests in [packages/react/src/transport/__tests__/http.test.ts](solvapay-sdk/packages/react/src/transport/__tests__/http.test.ts). Full suite: 436/436 passing. `packages/react/README.md` has a new "MCP App" section.

## Manual basic-host smoke checklist

### Prerequisites

Mirrors [examples/mcp-checkout-app/README.md](solvapay-sdk/examples/mcp-checkout-app/README.md):

1. SolvaPay backend running on `http://localhost:3001` with a product that has ≥ 1 active plan.
2. `examples/mcp-checkout-app/.env` populated with `SOLVAPAY_SECRET_KEY` + `SOLVAPAY_PRODUCT_REF` scoped to that product.
3. `basic-host` running at `http://localhost:8080`.
4. From the `solvapay-sdk` repo root:

```bash
pnpm install
pnpm --filter @example/mcp-checkout-app dev
```

Point `basic-host` at `http://localhost:3006/mcp` and open the SolvaPay checkout app from its tool list.

### States to verify

For each state, confirm the **UI** matches the expected screen AND the **server log** (`[mcp-checkout-app] -> tool_name` / `<- tool_name ok in Nms` lines from [server.ts's `traceTool`](solvapay-sdk/examples/mcp-checkout-app/src/server.ts)) shows exactly the listed tool calls — no extras, no repeats inside a single transition.

- **State 1 — Upgrade (no purchase)**: card shows `<UpgradeBody>` with an `Upgrade` anchor enabled. Server log shows `open_checkout`, `check_purchase`, `create_checkout_session` once each on initial mount.
- **State 2 — Awaiting (after clicking Upgrade)**: new tab opens to `solvapay.com` hosted checkout. Back in the iframe, the card flips to `<AwaitingBody>` (spinner + "Reopen checkout" + "Didn't complete? Cancel"). Server log shows `check_purchase` polling every ~3s while the iframe tab is visible, pauses when hidden, and resumes on focus.
- **State 3 — Manage (after paying `4242 4242 4242 4242` and returning to the host)**: card flips to `<ManageBody>` rendering `<CurrentPlanCard>` with plan name, "Visa •••• 4242", Update / Cancel buttons. Server log shows one `check_purchase` (from the focus/visibility refetch) that now returns a paid purchase, then `get_payment_method`, `get_merchant`, `get_product`, and `create_customer_session` (pre-fetched by `<UpdatePaymentMethodButton>` → `<LaunchCustomerPortalButton>`).
- **State 4 — Cancelled (after clicking Cancel in `<CurrentPlanCard>` and confirming)**: card shows `<CancelledBody>` with the end-date notice + `Purchase again` anchor. Server log shows `cancel_renewal`, follow-up `check_purchase`, `create_checkout_session`.
- **State 5 — Error paths**: stop the SolvaPay backend mid-session → next refetch fails; each failing call surfaces as **a single** `onError` invocation (no duplicate from the hook-level re-emit that `smoke-prep` removed). Restart the backend → next focus/visibility refetch recovers state without a manual reload.

## Non-goals

- Moving any logic out of `@solvapay/core` / `@solvapay/server`. The MCP tool _handlers_ on the server stay exactly as they are; this plan is purely verification on the React / browser side.
- Automated integration tests against a mock MCP App driving full UI transitions. Unit coverage of the adapter + transport already exists; the state-machine + polling logic in the example is out of scope for this plan. If a specific transition in the smoke run turns out to be painful to test by hand, file it as a separate plan.
- Expanding the transport surface. Any new hook (e.g. plan management Phase 2 `changePlan` / `createSetupIntent` / `getPaymentMethod`) slots into `SolvaPayTransport` under its own plan — see "Related work" below.

## Downstream plans

- [`react-provider-loading-vs-refetching_c2d8b3a7.plan.md`](solvapay-sdk/.cursor/plans/react-provider-loading-vs-refetching_c2d8b3a7.plan.md) — **shipped**. `fetchPurchase` stayed inline in `SolvaPayProvider` post-adapter refactor, and the `loadedCacheKeysRef` fix landed there directly. The two unit tests under `loading vs isRefetching` in [packages/react/src/__tests__/SolvaPayProvider-purchase.test.tsx](solvapay-sdk/packages/react/src/__tests__/SolvaPayProvider-purchase.test.tsx) assert `isRefetching: true, loading: false` during empty-state and non-empty refetches. No further action on that plan.

## Related work

- [`supabase-mcp_sdk_package_c319cb08.plan.md`](solvapay-sdk/.cursor/plans/supabase-mcp_sdk_package_c319cb08.plan.md) — the **server-side** companion. Ships `@solvapay/supabase-mcp` (a Fetch-first toolkit wrapping `mcp-lite` + `hono` with SolvaPay paywall, virtual tools, OAuth bridge, and RFC 8414 §3.3-consistent discovery) so any MCP App built on top of `createMcpAppAdapter(app)` can stand up a paywalled MCP server with a single `createSolvaPayMcp({...})` call. No blocking relationship in either direction — the adapter's `SolvaPayTransport` contract is tool-name-based, so as long as the server exposes `check_purchase`, `create_checkout_session`, `create_customer_session` (plus whatever subset of the broader transport surface it supports), the client adapter works regardless of the server stack. Both plans should land together in the MCP-checkout example's next iteration: current `examples/mcp-checkout-app/src/server.ts` uses the official `@modelcontextprotocol/sdk` + `registerAppTool` flavour, and migrating it to `@solvapay/supabase-mcp` is a follow-up once that package publishes to `@preview`.
- [`sdk_plan_management_phase2_6e40d833.plan.md`](solvapay-sdk/.cursor/plans/sdk_plan_management_phase2_6e40d833.plan.md) — **transport-surface integration point**. Phase 2 adds three new methods to `SolvaPayProvider` (`changePlan`, `createSetupIntent`, `getPaymentMethod`). With `SolvaPayTransport` now landed, those three methods must be added to the transport interface (and the MCP adapter) rather than reintroducing per-method `SolvaPayProviderProps` overrides — otherwise the unified-transport invariant breaks.
- [`sdk_mcp_transport_resilience_6f52e3a3.plan.md`](solvapay-sdk/.cursor/plans/sdk_mcp_transport_resilience_6f52e3a3.plan.md) — **terminology disambiguation, not a dependency**. Shares the word "transport" but targets a completely different layer: that plan is the server-side Streamable-HTTP back-channel FSM fix (GET /mcp → 405, OIDC discovery → 404) in [`packages/server/src/mcp/oauth-bridge.ts`](solvapay-sdk/packages/server/src/mcp/oauth-bridge.ts), already shipped. This plan's `SolvaPayTransport` is the client-side data-access abstraction between `@solvapay/react` hooks and their data source (HTTP today, MCP `app.callServerTool` under `createMcpAppAdapter`). No dependency in either direction; flagged here only to prevent future readers conflating the two.
