---
'@solvapay/server': minor
'@solvapay/react': minor
---

Add first-class chatbot / streaming primitives across `@solvapay/server` and `@solvapay/react`.

### `@solvapay/server`

- **New `solvaPay.payable({ productRef }).gate(req, opts)` primitive.** Decision-shaped paywall surface for streaming, SSE, and multi-step agent flows that don't fit the one-shot `.http()` / `.next()` / `.mcp()` adapter contract. Returns a discriminated union — `{ kind: 'paywall', response, content }` (pre-built 402) or `{ kind: 'allow', decision, customerRef, trackSuccess, trackFail }` with bound usage closures. `trackSuccess` / `trackFail` pre-fill `productRef`, `customerRef`, `requestId` and route through `ctx.waitUntil` when an `ExecutionContext`-shaped `ctx` is provided so Workers keep `trackUsage` alive past the response close. Multiple `trackSuccess` calls per allow decision are supported (per-step metering for AI SDK `onStepFinish`, LangChain `handleLLMEnd`, OpenAI `response.completed`).
- **New `solvaPay.paywall.decide()` factory exposure.** The kernel `paywall.decide()` routine — already used internally by adapters — is now reachable on the public factory return so streaming handlers can consume the verdict directly without re-implementing limit checks + gate construction.
- **New `buildPaywallGate(productRef, limits)` export.** Pure helper that converts a `LimitResponseWithPlan` (or any subset compatible with `apiClient.checkLimits`) into a `PaywallStructuredContent`. Extracted from `paywall.decide()`; both paths share the helper so wire shapes stay in lockstep. Exported from both `./` and `./edge` entrypoints.
- **New types:** `PayableGateOptions`, `PayableGateResult`, `PayablePaywallResult`, `PayableAllowResult`.
- The handler-shaped adapters (`.http`, `.next`, `.mcp`, `.function`) and `paywall.protect()` are unchanged.

### `@solvapay/react`

- **`usePlans({ productRef })` `fetcher` is now optional.** When omitted, the hook reads `_config` via `SolvaPayContext` and routes through `defaultListPlans` — preferring `config.transport.listPlans` when available, falling back to `GET ${config.api.listPlans ?? '/api/list-plans'}`. Matches the existing fallback in `<PlanSelector>` / `<CheckoutLayout>` so consumers no longer need to hand-roll `useTransport()` + a fetcher just to call `usePlans`. Explicit `fetcher` overrides remain supported for advanced cases.
- **New anonymous-auth helpers (`./adapters/auth`):**
  - `getOrCreateAnonymousCustomerRef(storageKey?)` — mints / persists an `anon_<uuid>` customer ref under `localStorage`. Falls back to the deterministic `'anon_ssr'` placeholder server-side.
  - `createAnonymousAuthAdapter(customerRef)` — returns an `AuthAdapter` whose `getToken()` and `getUserId()` both yield the supplied ref. Used to keep the SDK's auth-poll heuristic happy in apps without real authentication.
  - `resetAnonymousCustomerRef(storageKey?)` — clears the persisted ref plus the SDK's cached customer-ref entries so the next call mints a fresh identity.

These are additive — no existing exports change. `chat-checkout-demo` is now built on `payable.gate()` + `<PaywallNotice>` and demonstrates the JWT real-auth migration in its README.
