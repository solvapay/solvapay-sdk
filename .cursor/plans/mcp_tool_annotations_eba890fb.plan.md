---
name: mcp tool annotations
overview: Add portable MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) to every SolvaPay descriptor, flow them through the `@solvapay/mcp-sdk` registrations, expose them on `registerPayableTool` with a sensible default, and make the `mcp-checkout-app` demo tools annotate explicitly.
todos:
  - id: types
    content: Add `SolvaPayToolAnnotations` interface and `annotations?` field on `SolvaPayToolDescriptor` in `packages/mcp/src/types.ts`; export the new type from `packages/mcp/src/index.ts`.
    status: pending
  - id: descriptors
    content: In `packages/mcp/src/descriptors.ts` add the `solvapayTool` helper + `INTENT_TOOL_ANNOTATIONS` map, thread `annotations` through `pushIntentTool`, and annotate every transport `tools.push(...)` block (including `activate_plan`).
    status: pending
  - id: register-app-tool-flow
    content: In `packages/mcp-sdk/src/server.ts`, spread `annotations` into the `registerAppTool` config inside `registerDescriptor`.
    status: pending
  - id: register-payable
    content: "In `packages/mcp-sdk/src/registerPayableTool.ts`, accept `annotations?: SolvaPayToolAnnotations`, apply the `{ readOnlyHint: true, openWorldHint: true, ...annotations }` default, and pass through to `registerAppTool`."
    status: pending
  - id: demo-tools
    content: "In `examples/mcp-checkout-app/src/demo-tools.ts` add explicit `annotations: { readOnlyHint: true, idempotentHint: true }` on both `search_knowledge` and `get_market_quote`."
    status: pending
  - id: tests
    content: "Extend `packages/mcp-sdk/__tests__/create-solvapay-mcp-server.unit.test.ts` with four annotation assertions: intent readOnly+idempotent, transport destructive, `registerPayable` default, `registerPayable` explicit override."
    status: pending
  - id: verify
    content: Run `pnpm typecheck` + the mcp-sdk test suite; fix any lints surfaced by `ReadLints` on changed files.
    status: pending
isProject: false
---

## Context

The `@modelcontextprotocol/ext-apps@1.5.0` `ToolConfig` already exposes `annotations?: ToolAnnotations` (verified in [node_modules/.../ext-apps/dist/src/server/index.d.ts:43-50](solvapay-sdk/node_modules/.pnpm/@modelcontextprotocol+ext-apps@1.5.0_@modelcontextprotocol+sdk@1.29.0_zod@4.3.6__react-dom@19_ezeg7to443u4jdzz3y7begiwke/node_modules/@modelcontextprotocol/ext-apps/dist/src/server/index.d.ts)), and `registerAppTool` passes the config through to `server.registerTool` verbatim except for the `_meta.ui.resourceUri` back-compat. No upstream fix needed.

Every SolvaPay tool hits our backend, so `openWorldHint: true` is universal — a small `solvapayTool` helper keeps it DRY.

## Scope

Touches 4 source files + 1 test file + 1 index re-export:

- [packages/mcp/src/types.ts](solvapay-sdk/packages/mcp/src/types.ts) — add `SolvaPayToolAnnotations`, add optional `annotations` field on `SolvaPayToolDescriptor` (after line 202).
- [packages/mcp/src/index.ts](solvapay-sdk/packages/mcp/src/index.ts) — export the new type alongside existing descriptor-type exports (line 59 block).
- [packages/mcp/src/descriptors.ts](solvapay-sdk/packages/mcp/src/descriptors.ts) — add `solvapayTool` helper, add `INTENT_TOOL_ANNOTATIONS` map, thread through `pushIntentTool`, annotate every transport `tools.push(...)` including `activatePlan`.
- [packages/mcp-sdk/src/server.ts](solvapay-sdk/packages/mcp-sdk/src/server.ts) — spread `annotations` into the `registerAppTool` config inside `registerDescriptor` (line 82).
- [packages/mcp-sdk/src/registerPayableTool.ts](solvapay-sdk/packages/mcp-sdk/src/registerPayableTool.ts) — accept `annotations?` option, default to `{ readOnlyHint: true, openWorldHint: true }`, spread the result into the `registerAppTool` config.
- [examples/mcp-checkout-app/src/demo-tools.ts](solvapay-sdk/examples/mcp-checkout-app/src/demo-tools.ts) — explicit `annotations: { readOnlyHint: true, idempotentHint: true }` on both `search_knowledge` and `get_market_quote` for docs clarity.

Tests land in the existing [packages/mcp-sdk/__tests__/create-solvapay-mcp-server.unit.test.ts](solvapay-sdk/packages/mcp-sdk/__tests__/create-solvapay-mcp-server.unit.test.ts), which already uses `server._registeredTools` for assertions.

## Annotation table

Same as the handoff — reproduced here so the plan is self-contained:

- `manage_account`: readOnly, idempotent
- `check_usage`: readOnly, idempotent
- `upgrade`: destructive
- `topup`: destructive
- `activate_plan`: none (neutral — free plans flip instantly, paid plans surface a checkout link without charging)
- `create_payment_intent`: none
- `create_topup_payment_intent`: none
- `create_checkout_session`: none
- `process_payment`: destructive
- `create_customer_session`: readOnly, idempotent
- `cancel_renewal`: destructive, idempotent
- `reactivate_renewal`: idempotent

All carry `openWorldHint: true` via the `solvapayTool` helper.

## `registerPayableTool` default

```ts
const effectiveAnnotations: SolvaPayToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: true,
  ...annotations,
}
```

80% case (paywalled data tools like `search_knowledge`) is zero-config correct. State-mutating merchant tools override with `annotations: { readOnlyHint: false, destructiveHint: true }`.

## Tests to add

Extend [create-solvapay-mcp-server.unit.test.ts](solvapay-sdk/packages/mcp-sdk/__tests__/create-solvapay-mcp-server.unit.test.ts) with a `describe('tool annotations', ...)` block covering four cases per the handoff:

1. `manage_account` surfaces `{ readOnlyHint: true, idempotentHint: true, openWorldHint: true }`.
2. `upgrade` surfaces `destructiveHint: true` + `openWorldHint: true`.
3. `registerPayable` default yields `{ readOnlyHint: true, openWorldHint: true }` on a tool registered via `additionalTools`.
4. `registerPayable` explicit `annotations: { readOnlyHint: false, destructiveHint: true }` merges with the default `openWorldHint: true`.

Access via `server._registeredTools[name].annotations` — matches the existing test-file convention (see lines 71-89).

## Out of scope (per handoff)

- Pre-built HTML bundle shipped from `@solvapay/mcp-sdk`.
- Config-time validation when neither OAuth bridge nor `getCustomerRef` is configured.
- Documented refresh event contract for custom success handlers.
- No changes to [examples/mcp-checkout-app/src/mcp-app.tsx](solvapay-sdk/examples/mcp-checkout-app/src/mcp-app.tsx) — the annotations are a server-side tool-metadata concern; the client shell doesn't consume them.