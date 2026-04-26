/**
 * Probe whether `@stripe/stripe-js` can mount inside the current MCP host
 * sandbox. Compliant hosts (basic-host, ChatGPT, MCPJam) honour the
 * declared `_meta.ui.csp.frameDomains` and Stripe loads normally;
 * non-compliant hosts (Claude today — see anthropics/claude-ai-mcp#40)
 * hardcode `frame-src 'self' blob: data:` and the nested Stripe iframes
 * are refused even though the parent script loads fine.
 *
 * ## Why `ready` alone is a lie on Claude
 *
 * Stripe's `PaymentElement` fires its `ready` event as soon as the
 * outer iframe *element* is inserted into the DOM. Chrome's behaviour
 * for a CSP-refused iframe is **not** to fail the element — it inserts
 * the iframe, swaps its content for a synthetic `chrome-error://chromewebdata/`
 * placeholder, and reports `load`. Stripe sees a successful mount and
 * fires `ready`. A naive probe that trusts `ready` therefore returns
 * `'ready'` on Claude and we commit to the embedded flow anyway.
 *
 * The reliable signal is the standard DOM `SecurityPolicyViolationEvent`
 * (`securitypolicyviolation`). Chrome dispatches it on `document` the
 * moment it refuses the `https://js.stripe.com/...` iframe — typically
 * *before* Stripe's bogus `ready` fires. The probe below listens for
 * this event scoped to its own probe window; if a `frame-src`
 * violation with a `stripe.com` `blockedURI` fires, we resolve
 * `'blocked'` immediately and `ready` is ignored even if it arrives
 * later.
 *
 * ## Flow
 *
 *   1. `loadStripe(publishableKey)` with a ≤3s timeout. Reject /
 *      timeout → `'blocked'` (covers `script-src` blocks and slow
 *      CDNs).
 *   2. `stripe.elements({ mode: 'setup', currency: 'usd' })` +
 *      `elements.create('payment')` (the Payment Element — Stripe.js
 *      names it `'payment'`; `@stripe/react-stripe-js`'s
 *      `<PaymentElement>` wraps the same thing).
 *   3. Attach a scoped `securitypolicyviolation` listener *before*
 *      mounting, then mount the element on a visually-hidden host
 *      node appended to `document.body`.
 *   4. Race:
 *        - stripe-domain `frame-src` violation → `'blocked'`.
 *        - `loaderror` → `'blocked'`.
 *        - `ready` → `'ready'` (but only when no violation has fired).
 *        - ≤2s element-mount timeout → `'blocked'`.
 *   5. Always tear down (element unmount + host node removed +
 *      listener removed) on resolve, effect cleanup, and defensively
 *      on re-renders.
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
    // Tracks whether Chrome dispatched a stripe-domain `frame-src`
    // `SecurityPolicyViolationEvent` during this probe. Checked inside
    // the `ready` handler because Stripe's `ready` event fires on
    // element insertion regardless of whether the nested iframe was
    // actually allowed to load (see the header docblock).
    let cspBlockedStripeFrame = false
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

    // Narrow the global listener to violations that are actually our
    // problem: a `frame-src` refusal of an `https://*.stripe.com/*`
    // iframe. Everything else on the page (misconfigured host CSPs,
    // unrelated third-party iframes) is out of scope — we don't want
    // to conflate other CSP noise with a Stripe block.
    const isStripeFrameViolation = (event: SecurityPolicyViolationEvent): boolean => {
      const directive = event.effectiveDirective || event.violatedDirective || ''
      const blockedURI = event.blockedURI || ''
      const isFrameSrc =
        directive === 'frame-src' || directive.startsWith('frame-src ')
      return isFrameSrc && /(^|\W)stripe\.com(\W|$)/.test(blockedURI)
    }
    const onCspViolation = (event: SecurityPolicyViolationEvent) => {
      if (!isStripeFrameViolation(event)) return
      cspBlockedStripeFrame = true
      resolve('blocked')
    }
    // Safe no-op under SSR since the effect short-circuits earlier
    // when `document` is undefined.
    document.addEventListener('securitypolicyviolation', onCspViolation)

    const teardown = () => {
      clearTimers()
      document.removeEventListener('securitypolicyviolation', onCspViolation)
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

          element.on('ready', () => {
            // Chrome fires `ready` on element insertion regardless of
            // whether the nested iframe was permitted. Only trust
            // `ready` when no stripe-domain `frame-src` violation has
            // fired in the meantime — the CSP listener above will
            // have already resolved `'blocked'` on those hosts, so
            // this branch runs only when the iframe actually loaded.
            if (cspBlockedStripeFrame) return
            resolve('ready')
          })
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
