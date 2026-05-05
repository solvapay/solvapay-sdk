import type { AuthAdapter } from '@solvapay/react'

const STORAGE_KEY = 'chat-checkout-demo:customerRef'

/**
 * Generate (and persist) a stable per-browser customer reference. The demo
 * has no login — every browser tab gets its own anonymous customer that the
 * SolvaPay backend upserts on first contact (`externalRef = customerRef`).
 *
 * Reset the demo by clearing localStorage or hitting the browser's "Clear
 * storage" devtools button.
 */
export function getAnonymousCustomerRef(): string {
  if (typeof window === 'undefined') return 'anon_ssr'

  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored) return stored

  const next = `anon_${crypto.randomUUID()}`
  window.localStorage.setItem(STORAGE_KEY, next)
  return next
}

/**
 * Auth adapter that pretends every browser is a logged-in user identified
 * by the anonymous customer ref. The userId doubles as the SolvaPay
 * `externalRef` so visiting customers are deduplicated across reloads.
 */
export function createAnonymousAuthAdapter(customerRef: string): AuthAdapter {
  return {
    async getToken() {
      return null
    },
    async getUserId() {
      return customerRef
    },
  }
}
