/**
 * Auth Adapter Interface for Client-Side Authentication
 *
 * Defines the contract for authentication adapters used by SolvaPayProvider.
 * Adapters handle token retrieval and user ID extraction in the browser.
 */

/**
 * Auth adapter interface for client-side authentication
 *
 * Used by SolvaPayProvider to get auth tokens and user IDs.
 * Adapters should handle their own error cases and return null when
 * authentication is not available or fails.
 */
export interface AuthAdapter {
  /**
   * Get the authentication token
   *
   * @returns The auth token string if available, null otherwise
   *
   * @remarks
   * This method should never throw. If authentication fails or is missing,
   * return null and let the caller decide how to handle unauthenticated requests.
   */
  getToken: () => Promise<string | null>

  /**
   * Get the authenticated user ID
   *
   * @returns The user ID string if authenticated, null otherwise
   *
   * @remarks
   * This method should never throw. If authentication fails or is missing,
   * return null and let the caller decide how to handle unauthenticated requests.
   */
  getUserId: () => Promise<string | null>

  /**
   * Subscribe to auth-state changes. Optional.
   *
   * When provided, `SolvaPayProvider` calls `subscribe` on mount and
   * triggers `detectAuth` every time the listener fires instead of
   * only running `detectAuth` once. This is how reactive adapters such
   * as `@solvapay/react-supabase` push sign-in / sign-out / token-refresh
   * events into the SDK without the app having to reload.
   *
   * @param listener - Called with no arguments whenever auth state changes
   * @returns An unsubscribe function the provider calls on cleanup
   */
  subscribe?: (listener: () => void) => () => void
}

/**
 * Default auth adapter that only checks localStorage
 *
 * This is a fallback adapter that doesn't depend on any specific auth provider.
 * It checks for a token in localStorage under the 'auth_token' key.
 */
export const defaultAuthAdapter: AuthAdapter = {
  async getToken(): Promise<string | null> {
    if (typeof window === 'undefined') return null

    const token = localStorage.getItem('auth_token')
    return token || null
  },

  async getUserId(): Promise<string | null> {
    const token = await this.getToken()
    if (!token) return null

    // Try to extract user ID from JWT token
    try {
      const parts = token.split('.')
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]))
        return payload.sub || payload.user_id || null
      }
    } catch {
      // Not a JWT or invalid format
    }

    return null
  },
}

/**
 * Default `localStorage` key under which the anonymous customer ref is
 * persisted by `getOrCreateAnonymousCustomerRef()`. Override via the
 * `storageKey` argument when integrating into apps that already use
 * `solvapay:*` keys for other purposes.
 */
const DEFAULT_ANON_STORAGE_KEY = 'solvapay:anonymousCustomerRef'

/**
 * Server-side fallback ref returned by `getOrCreateAnonymousCustomerRef`
 * when called outside the browser. Never persisted; never reused for
 * actual customers — visible at build time only so SSR snapshots stay
 * deterministic.
 */
const SSR_PLACEHOLDER_REF = 'anon_ssr'

/**
 * Generate (and persist) a stable per-browser customer reference.
 *
 * Backed by `window.localStorage` under `storageKey` (default
 * `solvapay:anonymousCustomerRef`). Calling this from a non-browser
 * context returns the deterministic SSR placeholder `anon_ssr` —
 * useful for keeping server-rendered output stable but never used as
 * an actual customer identifier.
 *
 * Pair with `createAnonymousAuthAdapter(ref)` to wire an SDK-friendly
 * `AuthAdapter` for apps without real authentication. When you migrate
 * to a real identity provider, swap in your own `AuthAdapter` and
 * leave this helper behind — the SolvaPay backend deduplicates on
 * `externalRef`, so the move is non-destructive.
 *
 * @param storageKey Optional override for the persistence key.
 * @returns The persisted (or freshly minted) anonymous customer ref.
 *
 * @since 1.2.0
 */
export function getOrCreateAnonymousCustomerRef(
  storageKey: string = DEFAULT_ANON_STORAGE_KEY,
): string {
  if (typeof window === 'undefined') return SSR_PLACEHOLDER_REF

  const stored = window.localStorage.getItem(storageKey)
  if (stored) return stored

  const next = `anon_${crypto.randomUUID()}`
  window.localStorage.setItem(storageKey, next)
  return next
}

/**
 * Clear the persisted anonymous customer ref. The next call to
 * `getOrCreateAnonymousCustomerRef()` mints a fresh one — useful for
 * "switch demo identity" affordances and for end-to-end tests that
 * need a clean slate per run.
 *
 * Also wipes the SDK's customer-ref cache (`solvapay_customerRef`,
 * `solvapay_customerRef_expiry`, `solvapay_customerRef_userId`) so a
 * post-reset `checkPurchase` doesn't send the stale
 * `x-solvapay-customer-ref` header before the SDK's userId-mismatch
 * invalidation has had a chance to run.
 *
 * @param storageKey Optional override matching the key passed to
 *   `getOrCreateAnonymousCustomerRef`.
 *
 * @since 1.2.0
 */
export function resetAnonymousCustomerRef(
  storageKey: string = DEFAULT_ANON_STORAGE_KEY,
): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(storageKey)
  window.localStorage.removeItem('solvapay_customerRef')
  window.localStorage.removeItem('solvapay_customerRef_expiry')
  window.localStorage.removeItem('solvapay_customerRef_userId')
}

/**
 * Build an `AuthAdapter` that pretends every browser is a logged-in
 * user identified by the supplied anonymous customer ref. Both
 * `getToken()` and `getUserId()` return the ref — the userId doubles
 * as the SolvaPay `externalRef` so visiting customers are
 * deduplicated across reloads.
 *
 * `getToken` returns the ref instead of `null` because the SDK polls
 * auth every 30s; a `null` token causes it to wipe the cached
 * customer ref, which in turn nulls out local balance state and the
 * UI snaps back to a "0 credits" view between polls. The synthetic
 * token only keeps the SDK's session-alive heuristic happy — the
 * server reads `x-customer-ref` (or your own `x-user-id`-style
 * header), so an `Authorization: Bearer anon_<uuid>` is harmless on
 * the wire.
 *
 * Once you wire real auth, replace this with the JWT adapter your
 * identity provider gives you (Clerk, Supabase, Auth0, …) — see
 * `defaultAuthAdapter` for the JWT-token convention.
 *
 * @since 1.2.0
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
