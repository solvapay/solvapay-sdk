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
