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
 *
 * `getToken` returns the customer ref instead of `null` because the SDK
 * polls auth every 30s and a `null` token causes it to wipe the cached
 * customer ref, which in turn nulls out the local balance state — the
 * header pill would visibly snap back to "0 MSGS LEFT" between polls.
 * The synthetic token is only used to keep the SDK's session-alive
 * heuristic happy; the local `/api/*` handlers authenticate via the
 * `x-customer-ref` → `x-user-id` middleware path, so an `Authorization:
 * Bearer anon_<uuid>` header is harmless on the wire.
 */
export function createAnonymousAuthAdapter(customerRef: string): AuthAdapter {
  return {
    async getToken() {
      return customerRef
    },
    async getUserId() {
      return customerRef
    },
  }
}

/**
 * Clear the persisted anonymous customer ref. The next call to
 * `getAnonymousCustomerRef()` (typically after a reload) mints a fresh one,
 * letting the demo simulate switching between buyers.
 *
 * Also wipes the SolvaPay SDK's customer-ref cache so the post-reload
 * `checkPurchase` doesn't send the stale `x-solvapay-customer-ref` header
 * (which would resurrect the prior customer on the backend before the
 * SDK's userId-mismatch invalidation has a chance to run).
 */
export function resetAnonymousCustomerRef(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
  window.localStorage.removeItem('solvapay_customerRef')
  window.localStorage.removeItem('solvapay_customerRef_expiry')
  window.localStorage.removeItem('solvapay_customerRef_userId')
}

/**
 * Render a customer ref as `anon_xxxx…` for compact display. Keeps the
 * `anon_` prefix intact so it's obvious this is a demo identity.
 */
export function truncateRef(ref: string, head = 8): string {
  if (ref.length <= head) return ref
  return `${ref.slice(0, head)}…`
}
