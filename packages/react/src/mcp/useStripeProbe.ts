/**
 * Probe whether `@stripe/stripe-js` can mount inside the current MCP host
 * sandbox. Compliant hosts (basic-host, ChatGPT, MCPJam) honour the
 * declared `_meta.ui.csp.frameDomains` and Stripe loads normally;
 * non-compliant hosts (Claude today — see anthropics/claude-ai-mcp#40)
 * hardcode `frame-src 'self' blob: data:` and the nested Stripe iframes
 * are refused even though the parent script loads fine.
 *
 * The probe therefore has to exercise **both** `script-src` (via
 * `loadStripe`) **and** `frame-src` (by mounting a real Stripe
 * `paymentElement` on a hidden host node and waiting for its `ready`
 * event). A probe that only tests `loadStripe` succeeds on Claude —
 * because `https://js.stripe.com/v3/` is allowed under `script-src` —
 * and commits the caller to the embedded branch even though every
 * nested `js.stripe.com` iframe is about to be refused by `frame-src`.
 * We then sit on Stripe's own skeleton rows forever.
 *
 * Flow:
 *
 *   1. `loadStripe(publishableKey)` with a ≤3s timeout. Reject /
 *      timeout → `'blocked'`.
 *   2. `stripe.elements({ mode: 'setup', currency: 'usd' })` +
 *      `elements.create('payment')` (the Payment Element — Stripe.js
 *      names it `'payment'`; `@stripe/react-stripe-js`'s
 *      `<PaymentElement>` wraps the same thing).
 *   3. Mount the element on a visually-hidden host node appended to
 *      `document.body`; race the element's `ready` event against a
 *      ≤2s timeout and a `loaderror` listener.
 *   4. Resolve once (whichever fires first) and always tear down the
 *      element + host node — on resolve, on effect cleanup, and
 *      defensively on re-renders.
 *
 * Total worst-case budget ≤ 5s (script load up to 3s + iframe mount
 * up to 2s). Public return type unchanged: `'loading' | 'ready' |
 * 'blocked'`.
 *
 * Note on the key: `publishableKey` is SolvaPay's **platform** Stripe pk
 * (same one the backend returns from `create_payment_intent`). It is used
 * here only to satisfy `loadStripe()`'s validator so we can exercise
 * `script-src` + `frame-src` — we never feed it into `confirmPayment`.
 * The real payment flow re-fetches the pk (and the connected
 * `accountId`) from `create_payment_intent` and boots its own `Stripe`
 * instance via the SDK's `useCheckout`/`useTopup`. SolvaPay is a Stripe
 * Connect direct-charge platform, so all browser-side Stripe calls pair
 * the platform pk with `{ stripeAccount: acct_XXX }`; the connected
 * merchant's own publishable key is never involved.
 */

import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'

// Stripe.js takes ~1-2s to load on a warm cache. 3s is long enough to
// distinguish a slow CDN from a CSP-blocked host without making the
// user stare at a spinner.
const STRIPE_LOAD_TIMEOUT_MS = 3_000

// Once Stripe.js is loaded, mounting a `paymentElement` and receiving
// its `ready` event is purely a cross-origin iframe handshake — typically
// <500ms on compliant hosts. 2s comfortably absorbs slow networks while
// keeping the total worst-case probe budget at ≤5s.
const ELEMENT_MOUNT_TIMEOUT_MS = 2_000

export type StripeProbeState = 'loading' | 'ready' | 'blocked'

export function useStripeProbe(publishableKey: string | null): StripeProbeState {
  const [state, setState] = useState<StripeProbeState>(
    publishableKey ? 'loading' : 'blocked',
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!publishableKey) {
      setState('blocked')
      return
    }

    setState('loading')

    let cancelled = false
    let resolved = false
    // Stripe's element type from `@stripe/stripe-js` is `StripeElement`;
    // importing it here would bind the probe to a specific typing slice
    // of the SDK. Keep it loose — we only call `on` / `mount` / `unmount`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let element: any = null
    let host: HTMLDivElement | null = null
    let loadTimeoutId: ReturnType<typeof setTimeout> | null = null
    let elementTimeoutId: ReturnType<typeof setTimeout> | null = null

    const clearTimers = () => {
      if (loadTimeoutId !== null) {
        clearTimeout(loadTimeoutId)
        loadTimeoutId = null
      }
      if (elementTimeoutId !== null) {
        clearTimeout(elementTimeoutId)
        elementTimeoutId = null
      }
    }

    const teardown = () => {
      clearTimers()
      if (element) {
        try {
          element.unmount()
        } catch {
          // Element may already be torn down by Stripe (e.g. after a
          // `loaderror`); swallow.
        }
        element = null
      }
      if (host) {
        host.remove()
        host = null
      }
    }

    const resolve = (next: StripeProbeState) => {
      if (cancelled || resolved) return
      resolved = true
      teardown()
      setState(next)
    }

    loadTimeoutId = setTimeout(() => {
      loadTimeoutId = null
      resolve('blocked')
    }, STRIPE_LOAD_TIMEOUT_MS)

    loadStripe(publishableKey)
      .then((stripe) => {
        if (cancelled || resolved) return
        // `loadStripe` resolved after the script-src timeout fired —
        // `resolved` is already true, bail.
        if (loadTimeoutId !== null) {
          clearTimeout(loadTimeoutId)
          loadTimeoutId = null
        }
        if (!stripe) {
          resolve('blocked')
          return
        }

        try {
          // `mode: 'setup'` avoids having to supply an `amount`; we
          // never confirm this element, it exists purely to trigger
          // the nested-iframe mount that exercises `frame-src`.
          const elements = stripe.elements({ mode: 'setup', currency: 'usd' })
          element = elements.create('payment')

          host = document.createElement('div')
          host.setAttribute('data-solvapay-stripe-probe', '')
          host.setAttribute('aria-hidden', 'true')
          host.style.cssText =
            'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px;overflow:hidden;'
          document.body.appendChild(host)

          element.on('ready', () => resolve('ready'))
          element.on('loaderror', () => resolve('blocked'))

          elementTimeoutId = setTimeout(() => {
            elementTimeoutId = null
            resolve('blocked')
          }, ELEMENT_MOUNT_TIMEOUT_MS)

          element.mount(host)
        } catch {
          resolve('blocked')
        }
      })
      .catch(() => {
        if (cancelled || resolved) return
        if (loadTimeoutId !== null) {
          clearTimeout(loadTimeoutId)
          loadTimeoutId = null
        }
        resolve('blocked')
      })

    return () => {
      cancelled = true
      // Full teardown on unmount / publishableKey change. Idempotent
      // with the resolve-path teardown; safe to call either direction.
      teardown()
    }
  }, [publishableKey])

  return state
}
