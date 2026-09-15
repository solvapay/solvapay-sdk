import { isErrorResult, getAuthenticatedUserCore } from '@solvapay/server'
import { clearPurchaseCache } from '../cache'

/**
 * Clear the shared `checkPurchase` cache entry for the authenticated user,
 * swallowing any auth/lookup failures.
 *
 * Called from the payment, activation, and renewal route wrappers after a
 * successful mutation so the very next `checkPurchase` round-trip sees the
 * new state. Purely a cache-invalidation best-effort — never surfaces back
 * to the caller.
 */
export async function invalidatePurchaseCacheForRequest(
  request: globalThis.Request,
): Promise<void> {
  try {
    const userResult = await getAuthenticatedUserCore(request)
    if (!isErrorResult(userResult)) {
      clearPurchaseCache(userResult.userId)
    }
  } catch {
    // Ignore errors in cache clearing
  }
}
