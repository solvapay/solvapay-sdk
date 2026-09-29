/**
 * Helpers for resuming a payment after a 3DS return.
 *
 * When the server-side confirm answers `requires_action`, the SDK sends the
 * payer to `redirectUrl`; the rail brings them back to `returnUrl` with
 * `payment_intent` (+ `payment_intent_client_secret`, `redirect_status`)
 * appended. The SDK resumes on the `payment_intent` id through the backend,
 * then strips all three so a manual refresh does not re-trigger the resume.
 */

const PAYMENT_INTENT_PARAMS = [
  'payment_intent',
  'payment_intent_client_secret',
  'redirect_status',
] as const

/**
 * Read the rail payment id (`payment_intent`) from a URL query string, if
 * present. Checkout resumes on this id after a 3DS return and reconciles
 * through the backend.
 */
export function readPaymentIntentId(search: string): string | undefined {
  const value = new URLSearchParams(search).get('payment_intent')
  return value && value.length > 0 ? value : undefined
}

/**
 * Remove the payment-return params from the current URL without reloading,
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
