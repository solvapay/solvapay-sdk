/**
 * Probe whether `@stripe/stripe-js` can mount inside the current MCP host
 * sandbox. Compliant hosts (basic-host, ChatGPT) honour the declared
 * `_meta.ui.csp.frameDomains` and Stripe loads normally; non-compliant
 * hosts (Claude today — see anthropics/claude-ai-mcp#40) hardcode
 * `frame-src 'self' blob: data:` and the nested card iframe is refused.
 *
 * We race `loadStripe()` against a 3s timeout — in the blocked case
 * Stripe.js either throws a ContentSecurityPolicy error or the promise
 * simply never resolves, and the timeout wins.
 *
 * Note on the key: `publishableKey` is SolvaPay's **platform** Stripe pk
 * (same one the backend returns from `create_payment_intent`). It is used
 * here only to satisfy `loadStripe()`'s validator so we can exercise
 * `frameDomains` — we never feed it into `confirmPayment`. The real
 * payment flow re-fetches the pk (and the connected `accountId`) from
 * `create_payment_intent` and boots its own `Stripe` instance via the
 * SDK's `useCheckout`/`useTopup`. SolvaPay is a Stripe Connect direct-
 * charge platform, so all browser-side Stripe calls pair the platform
 * pk with `{ stripeAccount: acct_XXX }`; the connected merchant's own
 * publishable key is never involved.
 */

import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'

// Stripe.js takes ~1-2s to load on a warm cache. 3s is long enough to
// distinguish a slow CDN from a CSP-blocked host without making the user
// stare at a spinner.
const STRIPE_PROBE_TIMEOUT_MS = 3_000

export type StripeProbeState = 'loading' | 'ready' | 'blocked'

export function useStripeProbe(publishableKey: string | null): StripeProbeState {
  const [state, setState] = useState<StripeProbeState>(publishableKey ? 'loading' : 'blocked')

  useEffect(() => {
    if (!publishableKey) {
      setState('blocked')
      return
    }

    let cancelled = false
    setState('loading')

    const timeout = new Promise<'blocked'>(resolve => {
      window.setTimeout(() => resolve('blocked'), STRIPE_PROBE_TIMEOUT_MS)
    })

    const load = loadStripe(publishableKey)
      .then(stripe => (stripe ? 'ready' : 'blocked'))
      .catch(() => 'blocked' as const)

    Promise.race([load, timeout]).then(result => {
      if (!cancelled) setState(result)
    })

    return () => {
      cancelled = true
    }
  }, [publishableKey])

  return state
}
