---
name: Claude payment form CSP fix
overview: useStripeProbe currently only tests `script-src` (via loadStripe), which succeeds on Claude even though nested `js.stripe.com` iframes are refused by `frame-src 'self' blob: data:`. The probe returns 'ready', we commit to the embedded branch, and the Stripe PaymentElement's own skeletons never resolve. Fix: make the probe test what actually matters — mount a real throwaway Stripe element and wait for its `ready` event. One file change, one test file, no view/primitive edits.
todos:
  - id: probe-rewrite
    content: Rewrite useStripeProbe.ts to mount a hidden throwaway Stripe paymentElement after loadStripe resolves; return 'ready' only when the element's ready event fires; return 'blocked' on loaderror or ~2s timeout; always tear down
    status: pending
  - id: tests
    content: Add useStripeProbe.test.ts covering loadStripe-fail, element-ready, element-loaderror, timeout, and unmount-teardown
    status: pending
  - id: changeset
    content: Add @solvapay/react changeset noting the stricter probe
    status: pending
  - id: smoke
    content: Smoke-test examples/cloudflare-workers-mcp on Claude.ai (expect hosted fallback, no Framing-js.stripe.com console errors) and MCPJam (expect embedded flow still works)
    status: pending
isProject: false
---

# Fix Claude.ai stuck payment-form skeletons (minimal)

## Symptom

On claude.ai, any SolvaPay intent tool that ends in a card-capture step shows the surrounding UI fine but 4 gray skeleton rows where the Stripe `PaymentElement` should be — never resolve. Reproduces on production and local ngrok. Works on MCPJam.

Affected flows:
- `manage_account` → "Change plan" → `RecurringPaymentStep`
- `upgrade` → `RecurringPaymentStep`
- `topup` → `TopupForm`

All three mount a Stripe `PaymentElement`, so they all fail identically.

## Root cause

Claude's MCP-app iframe hardcodes `frame-src 'self' blob: data:`. Console on claude.ai:

```
Framing 'https://js.stripe.com/' violates the following Content Security Policy directive:
"frame-src 'self' blob: data:". The request has been blocked.
```

(Fires twice — once per Stripe element iframe.) `loadStripe()` itself resolves because **`script-src`** permits `https://js.stripe.com/v3/`. The failure is strictly **`frame-src`**, on the nested iframes `PaymentElement` creates after mount.

[`useStripeProbe.ts:50-54`](solvapay-sdk/packages/react/src/mcp/useStripeProbe.ts) only races `loadStripe()` vs a 3 s timer — which tests `script-src`, not `frame-src`:

```50:54:solvapay-sdk/packages/react/src/mcp/useStripeProbe.ts
    const load = loadStripe(publishableKey)
      .then(stripe => (stripe ? 'ready' : 'blocked'))
      .catch(() => 'blocked' as const)

    Promise.race([load, timeout]).then(result => {
```

So the probe returns `'ready'`, [`McpCheckoutView`](solvapay-sdk/packages/react/src/mcp/views/McpCheckoutView.tsx) / [`McpTopupView`](solvapay-sdk/packages/react/src/mcp/views/McpTopupView.tsx) commit to the embedded branch, and Stripe's own skeletons (inside the refused iframes) sit there forever.

MCPJam honors our declared `_meta.ui.csp.frameDomains` ([`packages/mcp-core/src/csp.ts:20`](solvapay-sdk/packages/mcp-core/src/csp.ts)), so the nested iframes load and skeletons resolve into real inputs.

```mermaid
flowchart LR
  A["useStripeProbe"] -->|loadStripe OK| B["probe = ready"]
  B --> C["Embedded PaymentElement mounts"]
  C -->|"frame-src 'self' blob: data: refuses nested iframe"| D["skeletons forever"]
```

## Fix (one file)

Rewrite [`packages/react/src/mcp/useStripeProbe.ts`](solvapay-sdk/packages/react/src/mcp/useStripeProbe.ts) to probe what actually matters — mount a real Stripe `paymentElement` on a hidden node and wait for its `ready` event:

1. `const stripe = await loadStripe(publishableKey)` — keep existing step, fast-fail on `script-src`-blocked hosts. If `loadStripe` rejects or times out, return `'blocked'`.
2. `const elements = stripe.elements({ mode: 'setup', currency: 'usd' })`
3. `const el = elements.create('paymentElement')`
4. Create a hidden host node (absolute, `width:1px; height:1px; opacity:0; pointer-events:none; left:-9999px`) and append to `document.body`.
5. `el.mount(node)`, then `el.on('ready', …)` → `'ready'`; `el.on('loaderror', …)` → `'blocked'`; ~2 s timeout → `'blocked'`.
6. Always `el.unmount()` + remove the host node on resolve or effect cleanup; guard against StrictMode double-invoke with a cancellation flag.

Total new budget ≤ 5 s (script load up to 3 s + iframe mount up to 2 s). Public return type unchanged: still `'loading' | 'ready' | 'blocked'`. All call sites (`McpCheckoutView`, `McpTopupView`, their tests) stay untouched.

Header comment updated to say the probe exercises `script-src` and `frame-src`.

### Why nothing else changes

Both views already have hosted fallbacks wired to the probe result:
- [`McpCheckoutView.tsx:141-149`](solvapay-sdk/packages/react/src/mcp/views/McpCheckoutView.tsx) → `HostedCheckout`
- [`McpTopupView.tsx:83`](solvapay-sdk/packages/react/src/mcp/views/McpTopupView.tsx) → `HostedTopupFallback`

Fix the probe, and both paths route correctly on Claude automatically. No `PaymentForm` / `TopupForm` / view edits, no new context fields, no runtime-degrade machinery.

## Tests

Add `packages/react/src/mcp/__tests__/useStripeProbe.test.ts` (mock `@stripe/stripe-js`'s `loadStripe` + a stub `Stripe`/`Elements`/`Element` with `on`/`mount`/`unmount`):

- `publishableKey === null` → `'blocked'` synchronously.
- `loadStripe` rejects → `'blocked'`.
- Element `ready` fires → `'ready'`; host node is removed.
- Element `loaderror` fires → `'blocked'`; host node is removed.
- Neither fires within 2 s → `'blocked'`; host node is removed.
- Unmount before resolution cancels state update (no "can't set state on unmounted component" warning).

Existing tests stay as-is: [`McpCheckoutView.test.tsx:97`](solvapay-sdk/packages/react/src/mcp/views/__tests__/McpCheckoutView.test.tsx) and [`update-model-context.emissions.test.tsx:77`](solvapay-sdk/packages/react/src/mcp/__tests__/update-model-context.emissions.test.tsx) both mock `useStripeProbe` directly — no change needed.

## Changeset

`@solvapay/react` patch: "useStripeProbe now waits for a hidden PaymentElement's `ready` event, so partial-CSP hosts (Claude today: `frame-src 'self' blob: data:`) route to hosted checkout instead of hanging on Stripe's internal skeletons."

## Verification

1. `pnpm -F @solvapay/react test`
2. Run `examples/cloudflare-workers-mcp`, exercise `upgrade`, `topup`, `manage_account` → "Change plan" on:
   - **Claude.ai**: hosted fallback shows immediately; zero `Framing 'https://js.stripe.com/'` CSP errors in console.
   - **MCPJam**: embedded `PaymentElement` still renders inputs normally.

## Out of scope (explicit)

- `PaymentForm` / `TopupForm` `onReady` runtime timeout — not needed once the probe is correct; revisit only if a new host surfaces a partial-CSP variant the probe misses.
- Host-sniffing for `claude.ai` — brittle, rejected.
- Claude's upstream CSP fix (`anthropics/claude-ai-mcp#40`) — when they honor `_meta.ui.csp.frameDomains` the new probe will simply return `'ready'` faster. No code change needed on our side.
- Unrelated `link rel="preload"` warnings for `api-dev.solvapay.com/.../icons/*.stripe.1` — separate PR.
