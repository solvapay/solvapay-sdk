/**
 * Helpers for resuming a Stripe payment after a 3DS or redirect return.
 *
 * When `confirmPayment` needs authentication or a redirect method, Stripe
 * appends `payment_intent` + `payment_intent_client_secret` (+ `redirect_status`)
 * to the `return_url`. Read the client secret to retrieve the PaymentIntent,
 * then strip the params so a manual refresh does not re-trigger the resume.
 */

const PAYMENT_INTENT_PARAMS = [
  'payment_intent',
  'payment_intent_client_secret',
  'redirect_status',
] as const

/** Read the PaymentIntent client secret from a URL query string, if present. */
export function readPaymentIntentClientSecret(search: string): string | undefined {
  const value = new URLSearchParams(search).get('payment_intent_client_secret')
  return value && value.length > 0 ? value : undefined
}

/**
 * Remove the Stripe payment-return params from the current URL without reloading,
 * preserving any unrelated query params. No-op outside the browser.
 */
export function stripPaymentIntentParams(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  let changed = false
  for (const param of PAYMENT_INTENT_PARAMS) {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param)
      changed = true
    }
  }
  if (!changed) return
  const query = url.searchParams.toString()
  window.history.replaceState({}, '', `${url.pathname}${query ? `?${query}` : ''}${url.hash}`)
}
