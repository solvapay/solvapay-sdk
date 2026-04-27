---
'@solvapay/react': patch
---

**`useStripeProbe` now exercises `frame-src`, not just `script-src`.**

The previous probe only raced `loadStripe()` against a 3s timeout, which
tests whether Stripe's parent script is allowed to load — i.e.
`script-src`. That check succeeds on Claude today (the iframe CSP
permits `https://js.stripe.com/v3/`), so `useStripeProbe` returned
`'ready'` and `<McpCheckoutView>` / `<McpTopupView>` committed to the
embedded `PaymentElement` branch. Stripe's `PaymentElement` then tried
to open its own nested `js.stripe.com` iframes, Claude's
`frame-src 'self' blob: data:` refused them, and the user saw four
empty skeleton rows forever:

```
Framing 'https://js.stripe.com/' violates the following Content Security
Policy directive: "frame-src 'self' blob: data:".
```

The probe now:

1. Races `loadStripe()` against a ≤3s timeout (unchanged script-src
   check).
2. Registers a scoped `securitypolicyviolation` listener on
   `document` *before* mounting. Chrome dispatches this event when it
   refuses the nested `js.stripe.com` iframe; we filter to
   `frame-src` violations with a `stripe.com` `blockedURI` so
   unrelated CSP noise on the host page is ignored. A matching
   violation resolves `'blocked'` immediately.
3. Mounts a hidden throwaway Payment Element on a visually-hidden
   host node appended to `document.body` and races the element's
   `ready` event against a ≤2s timeout + a `loaderror` listener.
   **`ready` is ignored when a stripe-domain CSP violation has already
   fired** — on Claude, Chrome inserts the iframe but swaps its
   content for a `chrome-error://chromewebdata/` placeholder, which
   Stripe misreads as a successful mount and fires `ready` anyway.
4. Always tears down the element, removes the host node, and removes
   the CSP listener on resolve, on effect cleanup, and on
   `loaderror`. A cancellation flag guards StrictMode double-invokes.

Total worst-case budget ≤ 5s. Public return type is unchanged
(`'loading' | 'ready' | 'blocked'`), so every call site
(`McpCheckoutView`, `McpTopupView`, their tests) keeps working as-is.
On Claude the probe now returns `'blocked'` and the views route to
their hosted-checkout fallbacks instead of hanging on Stripe's internal
skeletons.
