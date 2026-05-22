# Make chat-checkout-demo a credible chatbot reference

The demo's shape is architecturally fine but it re-invents primitives that every chatbot integrator will need (streaming gate, anonymous auth, transport-defaulted plan fetcher, paywall UI). We extract those into the SDK, then shrink the demo to ~50% of its current size.

## Scope summary

- **SDK Tier 1**: 4 small additions, low risk
- **SDK Tier 2**: 1 new public primitive (`payable.gate()`) + adopt existing `<PaywallNotice>`
- **Demo**: cleanup leveraging both tiers
- **Auth**: anon-only in code, README snippet for real-auth migration path

## SDK Tier 1 — table-stakes additions

### 1. `usePlans({ productRef })` defaults to `defaultListPlans`

The demo repeats this 5x across `examples/chat-checkout-demo/App.tsx`, `components/Paywall.tsx`, `components/CheckoutForm.tsx`, `components/TopUpForm.tsx`, `components/LifetimeAccessForm.tsx`:

```ts
const transport = useTransport()
const fetcher = useCallback(async ref => {
  if (!transport.listPlans) throw new Error('Transport does not support listPlans')
  return transport.listPlans(ref)
}, [transport])
const { plans } = usePlans({ productRef, fetcher })
```

`PlanSelector` already uses `defaultListPlans` (`packages/react/src/transport/list-plans.ts`) as a fallback. Apply the same pattern in `usePlans` itself: read `_config` via `useSolvaPay()` and default the fetcher when omitted. `fetcher` stays optional for advanced overrides.

### 2. Expose `solvaPay.paywall.decide()` publicly

`SolvaPayPaywall.decide()` is already implemented in `packages/server/src/paywall.ts` (line 243) but only reachable via internal adapter wiring. Add a `paywall: { decide }` namespace on the `SolvaPay` factory return so streaming handlers can consume it directly without re-implementing limit checks + gate construction.

### 3. Export `buildPaywallGate(productRef, limits)` from `@solvapay/server`

Extract the gate-construction block from `paywall.ts` (lines 350-381) into a pure helper. The demo's `examples/chat-checkout-demo/src/server/chat.ts` `buildGate` (lines 249-275) is a hand-rolled mirror of this. After this lands, that mirror disappears.

### 4. Export `createAnonymousAuthAdapter(customerRef)` from `@solvapay/react`

Move `examples/chat-checkout-demo/src/lib/anonymousCustomer.ts` into the SDK at `packages/react/src/adapters/auth.ts`:

- `createAnonymousAuthAdapter(customerRef): AuthAdapter`
- `getOrCreateAnonymousCustomerRef(storageKey?): string` (localStorage-persisted, falls back to `'anon_ssr'` server-side)

The "synthetic token to keep auth-poll heuristic happy" workaround documented in the demo's `getToken` comment is exactly the kind of footgun the SDK should hide.

## SDK Tier 2 — the chatbot-specific primitive

### 5. `solvaPay.payable({ productRef }).gate(req, opts)`

A **decision-shaped** primitive. Existing `.http()` / `.next()` / `.mcp()` are handler-shaped ("you write business logic, SDK handles the protocol"). `.gate()` is the inverse: SDK gives you the gate verdict, you handle the protocol. This is the right shape for streaming, SSE, multi-step tool loops, and any flow where the response can't be expressed as "one function returning one value."

Returns a discriminated union with a pre-built 402 response and bound `trackUsage` closures:

```ts
export interface PayablePaywallResult {
  kind: 'paywall'
  /** Pre-built 402 with PaywallStructuredContent body. */
  response: Response
  /** Same content, for callers that format their own response. */
  content: PaywallStructuredContent
}

export interface PayableAllowResult<TArgs = unknown> {
  kind: 'allow'
  decision: Extract<PaywallDecision<TArgs>, { outcome: 'allow' }>
  customerRef: string
  /** Bound closures — productRef, customerRef, requestId pre-filled. */
  trackSuccess: (opts?: { duration?: number; metadata?: Record<string, unknown> }) => void
  trackFail: (err: unknown, opts?: { duration?: number; metadata?: Record<string, unknown> }) => void
}

interface PayableGateOptions {
  getCustomerRef?: (req: Request) => string | Promise<string>
  /** Workers ExecutionContext; floats the promise on Node when omitted. */
  ctx?: { waitUntil(p: Promise<unknown>): void }
}
```

Use site:

```ts
const payable = solvaPay.payable({ productRef: 'prd_chat' })

export async function handleChat(req: Request, ctx?: ExecutionContext) {
  const gate = await payable.gate(req, { ctx })
  if (gate.kind === 'paywall') return gate.response

  const start = Date.now()
  const stream = new ReadableStream({
    start: async controller => {
      try {
        for await (const chunk of geminiStream) controller.enqueue(encode(chunk))
        controller.close()
        gate.trackSuccess({ duration: Date.now() - start })
      } catch (err) {
        gate.trackFail(err, { duration: Date.now() - start })
        controller.error(err)
      }
    },
  })
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } })
}
```

Internals:

1. Resolve customer ref (option callback > `req.headers.get('x-customer-ref')` > `'anonymous'`).
2. Run `paywall.decide()`.
3. If `gate`: build `Response` from `paywallErrorToClientPayload(...)` with `status: 402`, `content-type: application/json`. Return `{ kind: 'paywall', response, content }`.
4. If `allow`: return `{ kind: 'allow', decision, customerRef, trackSuccess, trackFail }`. The track closures pre-bind `customerRef`, `productRef`, `requestId`, and route the resulting promise through `ctx.waitUntil` when `ctx` is provided.

### Why `.gate()` instead of an opinionated `.stream()`

- **Caller owns the Response.** Works for NDJSON, SSE, raw event-stream, JSON, multipart, anything. Streaming format is application-specific; the SDK shouldn't pick.
- **Explicit success/fail tracking.** Handler knows what success means for an LLM (moderation refusal, partial response, abort) in ways the SDK can't infer from "stream closed".
- **Composes beyond streaming.** Tool-use loops, multi-step responses, webhook fan-out, conditional response shape — anything where you can't return "one value" from "one function" benefits from the same primitive.
- **Smaller surface ages better.** One new primitive instead of multiple opinionated wrappers. A `.stream(handler, opts)` sugar that auto-tracks on stream close can layer on later if usage shows the same `Request → ReadableStream` shape repeated. Hard to retract once published; easy to add.

### Layering with existing adapters

```
                paywall.decide()                 (kernel — pure decision)
                      |
        +---------+---+----+--------+
        |         |        |        |
   (handler-shaped: SDK runs your fn)    (decision-shaped: you run yours)
   .http  .next  .mcp  .function                 .gate
```

- `.http()`, `.next()`, `.mcp()`, `.function()` stay exactly as they are. 95% of routes still use them.
- `.gate()` is the new primitive for the 5% — chatbots, agents, SSE, anything streaming or multi-step.
- `.mcp()` is **not** generalized into `.gate()`. MCP tool results are a structured envelope, not an HTTP `Response`; they don't fit the same shape. If MCP grows streaming/subscription patterns, ship a sibling `.gateMcp()` then.

**Optional follow-up** (not in this plan): rebuild `.http()` / `.next()` internals on top of `.gate()` so the gate-formatting logic has one home. Reduces test surface but isn't required for shipping.

### 6. Adopt `<PaywallNotice.EmbeddedCheckout>` in the demo

Already in the SDK at `packages/react/src/primitives/PaywallNotice.tsx`. Branches on plan type (PAYG → AmountPicker + TopupForm, recurring → PaymentForm) — all three demo scenarios fold into one composition.

## Demo refactor

After SDK lands:

- **Drop `components/Paywall.tsx`** (226 lines) → `<PaywallNotice.Root>` composition inline in `ChatWindow`.
- **Collapse `CheckoutForm.tsx` + `TopUpForm.tsx` + `LifetimeAccessForm.tsx`** (~535 lines) → single `InlineCheckout.tsx` (~80 lines) that renders `<PaywallNotice.EmbeddedCheckout>` with synthetic `payment_required` content for the proactive-upgrade path.
- **Rewrite `src/server/chat.ts`** with `payable.gate()`. Drop `buildGate`, `withUserIdHeader` middleware (replaced by `getCustomerRef` on the gate options), and the auto-activate metered-plan block (keep as a documented comment in the demo for explanatory value, gated behind a flag if we want).
- **Slim `App.tsx`** (370 → ~150 lines):
  - Drop fetcher boilerplate (Tier 1.1).
  - Drop the silent 402-retry-with-backoff loop in `processMessage`. Replace with `<PaywallNotice.Retry>` driven by `usePaywallResolver` (already exists in SDK). On resolve, replay the pending message.
  - Drop the `setTimeout` polling cascade in `handleFormSuccess`. Trust `usePaywallResolver` + the SDK's existing 8s `adjustBalance` grace window.
  - Drop the `creditsPerMessage` duplication between `App.tsx` and `ChatWindow.tsx`.
- **Drop `src/lib/anonymousCustomer.ts`** entirely. Import from `@solvapay/react`.
- **Add a 6-line README block** showing the JWT-shaped real-auth adapter swap.

## Implementation notes

These came out of validating `.gate()` against Vercel AI SDK 5, OpenAI Node SDK, LangChain JS, and against non-streaming + multi-step agent shapes. Not blocking, but address during implementation:

**Cross-cutting**:

- **Standardize `metadata` field names.** Use `inputTokens`, `outputTokens`, `totalTokens`, `finishReason`, `stepType` so cross-provider dashboards aggregate cleanly. Document in JSDoc on `trackSuccess`.
- **`trackSuccess` may be called multiple times per allow decision.** Each call is a separate usage event. This is the canonical pattern for per-step metering in agent loops (AI SDK `onStepFinish`, LangChain `handleLLMEnd`, OpenAI `response.completed`). Document explicitly.
- **Document recipes** for `.gate()` wrapping: `streamText().toUIMessageStreamResponse()`, `generateText` (non-streaming), `openai.responses.stream().toReadableStream()`, LangChain `streamEvents`, multi-tool agent loops with `onStepFinish`, multi-product agents with separate products per tool, mid-stream re-gating via `paywall.decide()`. Stops the chat-checkout-demo from being the only reference.

**Tier 1.5 micro-additions** (cheap, fold in during implementation if scope allows):

- **`paywallToToolResult(content)` helper** exported from `@solvapay/server`. ~10 lines. Converts a `PaywallStructuredContent` into a tool-result-friendly `{ error, kind, message, checkoutUrl }` shape so multi-product agents can return paywall outcomes as tool results that the LLM interprets conversationally instead of 402s that interrupt the stream.

**Optional follow-ups** (defer unless real adoption shows demand):

- **`gate.instrument(stream)`**: wraps a `ReadableStream` / `AsyncIterable` to fire `trackSuccess` on close and `trackFail` on error. Saves ~10 lines for LangChain-shaped flows without explicit completion callbacks.
- **Metadata bubbling for `.http()` / `.next()` / `.mcp()`**: extend the handler context with `trackMetadata({ ... })` and `units(n)` so the auto-tracking adapters can record token counts on AI workloads. Without this, AI integrators reach for `.gate()` even when their handler is one-shot. Re-evaluate after first integrators land.
- **Mid-stream re-gate doc pattern**: explicitly call out that pre-allocating quota at request entry is the default; mid-stream re-checks via `paywall.decide()` should be flagged as advanced because the response body is already in flight when the gate fires.

## Out of scope (deferred)

- **`.stream()` sugar** over `.gate()`. Wait for real-world adoption to prove the same shape recurs before committing to opinionated framing.
- **Tier 3 client hook** (`useChatStream` / `usePaywallFetch`). The demo's ~30 lines of NDJSON parsing aren't unreasonable; opinionated stream shapes belong in a follow-up once we know whether NDJSON, SSE, or Vercel AI SDK's `streamText` is the right contract.
- **Rebuild `.http()` / `.next()` on top of `.gate()`.** Internal cleanup, not a shipping requirement.
- **`.gateMcp()` for MCP streaming tools.** MCP spec PR #776 (partial results via `_meta.allowPartial`) merged Feb 2026, but host adoption is still partial in mid-2026 and structured-data merging strategy is undefined. Defer until: (a) major hosts (Claude, Cursor, ChatGPT MCP, Continue) broadly respect `allowPartial`, and (b) the merging-strategy design is settled in spec. When it lands, the shape mirrors `.gate()` but emits MCP envelopes: `{ kind: 'paywall', toolResult } | { kind: 'allow', emit, finalize, allowPartial, trackSuccess, trackFail }`. Existing single-shot `payable.mcp` stays unchanged.
- **Auto-activate metered plan** generalization. Stays demo-local for now; promote later if more integrators ask.
- **Migrating anon → identified customer** flow (when an anon user signs up). Requires backend support, separate plan.

## Estimated line-count impact

- `App.tsx`: 370 → ~150
- `Paywall.tsx`: 226 → 0 (deleted)
- `CheckoutForm.tsx` + `TopUpForm.tsx` + `LifetimeAccessForm.tsx`: ~535 → ~80 (one `InlineCheckout.tsx`)
- `chat.ts`: 302 → ~80
- `handlers.ts`: ~170 → ~120 (drop middleware)
- `anonymousCustomer.ts`: 75 → 0 (moved to SDK)

Net: ~1700 → ~430 lines in the demo (~75% reduction), with the cut weight reappearing as ~150 lines of new public SDK API across 5 files.

## Validation plan

- New SDK exports get unit tests (vitest): `usePlans` default-fetcher path, `paywall.decide` exposure, `buildPaywallGate` snapshot, anon adapter localStorage round-trip, `payable.gate` paywall + allow + trackSuccess/trackFail paths.
- Demo `pnpm test:type` + `pnpm test:format` clean.
- Manual smoke: all 3 scenarios end-to-end (free quota → 402 → checkout → resume) on Vite dev server. Wrangler local mode for the Worker path.
- No regressions in existing examples that use `usePlans` (still accept explicit `fetcher`) or `.http()` / `.next()` / `.mcp()` / `.function()` (untouched).

## Todos

- [ ] **sdk-useplans-default** — `usePlans` defaults to `defaultListPlans` when fetcher omitted (read `_config` via `useSolvaPay`)
- [ ] **sdk-expose-decide** — Expose `paywall.decide` on `SolvaPay` factory return as `solvaPay.paywall.decide(...)`
- [ ] **sdk-build-gate** — Extract and export `buildPaywallGate(productRef, limits)` helper from `@solvapay/server`
- [ ] **sdk-anon-adapter** — Move `createAnonymousAuthAdapter` + `getOrCreateAnonymousCustomerRef` into `@solvapay/react/adapters/auth`
- [ ] **sdk-payable-gate** — Add `solvaPay.payable({...}).gate(req, opts)` returning `{kind:'paywall',response,content} | {kind:'allow',decision,customerRef,trackSuccess,trackFail}`
- [ ] **sdk-tests** — Unit tests for all 5 new SDK surfaces (vitest)
- [ ] **demo-chat-gate** — Rewrite `chat.ts` with `payable.gate()`; drop `buildGate` + `withUserIdHeader` middleware
- [ ] **demo-paywall-notice** — Replace `Paywall.tsx` with `PaywallNotice` composition; delete file
- [ ] **demo-inline-checkout** — Collapse `CheckoutForm` / `TopUpForm` / `LifetimeAccessForm` into single `InlineCheckout` using `PaywallNotice.EmbeddedCheckout`
- [ ] **demo-app-cleanup** — Slim `App.tsx`: drop fetcher boilerplate, retry-with-backoff loop, `setTimeout` polling, `creditsPerMessage` duplication; use `usePaywallResolver` to drive replay
- [ ] **demo-anon-import** — Delete `examples/.../anonymousCustomer.ts`; import from `@solvapay/react`
- [ ] **demo-readme** — Add README section showing JWT real-auth adapter swap
- [ ] **validate** — Run typecheck, lint, unit tests across SDK + demo; smoke-test all 3 scenarios on Vite + Wrangler local
