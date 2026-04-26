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
2. On success, mounts a hidden throwaway `paymentElement` on a
   visually-hidden host node appended to `document.body` and races its
   `ready` event against a ≤2s timeout + a `loaderror` listener. This
   is the `frame-src` check — the nested Stripe iframe only reaches
   `ready` when the host CSP permits it.
3. Always tears down the element and removes the host node on resolve,
   on effect cleanup, and on `loaderror`. A cancellation flag guards
   StrictMode double-invokes.

Total worst-case budget ≤ 5s. Public return type is unchanged
(`'loading' | 'ready' | 'blocked'`), so every call site
(`McpCheckoutView`, `McpTopupView`, their tests) keeps working as-is.
On Claude the probe now returns `'blocked'` and the views route to
their hosted-checkout fallbacks instead of hanging on Stripe's internal
skeletons.
