/**
 * Subscription Cache Utilities
 *
 * Cache management functions for subscription data.
 * Separated from index.ts to avoid circular dependencies.
 */

/**
 * Request deduplication and caching options
 */
export interface RequestDeduplicationOptions {
  /**
   * Time-to-live for cached results in milliseconds (default: 2000)
   * Set to 0 to disable caching (only deduplicate concurrent requests)
   */
  cacheTTL?: number

  /**
   * Maximum cache size before cleanup (default: 1000)
   * When exceeded, oldest entries are removed
   */
  maxCacheSize?: number

  /**
   * Whether to cache error results (default: true)
   * When false, only successful results are cached
   */
  cacheErrors?: boolean
}

/**
 * Subscription check result
 */
export interface SubscriptionCheckResult {
  customerRef: string
  email?: string
  name?: string
  subscriptions: Array<{
    reference: string
    planName?: string
    agentName?: string
    status?: string
    startDate?: string
    [key: string]: unknown
  }>
}

/**
 * Cache entry for request deduplication
 */
interface CacheEntry<T> {
  data: T
  timestamp: number
}

/**
 * Request deduplication manager
 *
 * Prevents duplicate API calls by:
 * 1. Deduplicating concurrent requests (multiple requests share the same promise)
 * 2. Caching results for a short time (prevents duplicate sequential requests)
 */
function createRequestDeduplicator<T = unknown>(
  options: RequestDeduplicationOptions = {},
): {
  deduplicate: (key: string, fn: () => Promise<T>) => Promise<T>
  clearCache: (key: string) => void
  clearAllCache: () => void
  getStats: () => { inFlight: number; cached: number }
} {
  const { cacheTTL = 2000, maxCacheSize = 1000, cacheErrors = true } = options

  const inFlightRequests = new Map<string, Promise<T>>()
  const resultCache = new Map<string, CacheEntry<T>>()
  const cacheInvalidatedAt = new Map<string, number>() // Track when cache was invalidated
  let cleanupInterval: ReturnType<typeof setInterval> | null = null

  // Start cleanup interval if caching is enabled
  if (cacheTTL > 0) {
    cleanupInterval = setInterval(
      () => {
        const now = Date.now()
        const entriesToDelete: string[] = []

        for (const [key, cached] of resultCache.entries()) {
          if (now - cached.timestamp >= cacheTTL) {
            entriesToDelete.push(key)
          }
        }

        for (const key of entriesToDelete) {
          resultCache.delete(key)
          // Clean up invalidation timestamp after cache TTL has passed
          cacheInvalidatedAt.delete(key)
        }

        // Enforce max cache size (remove oldest entries if exceeded)
        if (resultCache.size > maxCacheSize) {
          const sortedEntries = Array.from(resultCache.entries()).sort(
            (a, b) => a[1].timestamp - b[1].timestamp,
          )

          const toRemove = sortedEntries.slice(0, resultCache.size - maxCacheSize)
          for (const [key] of toRemove) {
            resultCache.delete(key)
            cacheInvalidatedAt.delete(key)
          }
        }
      },
      Math.min(cacheTTL, 1000),
    ) // Clean up at least every second or every cacheTTL, whichever is smaller
  }

  const deduplicate = async (key: string, fn: () => Promise<T>): Promise<T> => {
    // Check cache first if caching is enabled
    if (cacheTTL > 0) {
      const cached = resultCache.get(key)
      if (cached && Date.now() - cached.timestamp < cacheTTL) {
        // Cache hit - return immediately without executing callback
        return cached.data
      } else if (cached) {
        // Cache expired - remove it
        resultCache.delete(key)
      }
    }

    // Check if request is already in-flight
    let requestPromise = inFlightRequests.get(key)

    if (!requestPromise) {
      // Record when this request started
      const requestStartTime = Date.now()

      // Create new promise
      requestPromise = (async () => {
        try {
          const result = await fn()

          // Only cache if cache wasn't invalidated after this request started
          const invalidatedAt = cacheInvalidatedAt.get(key)
          const shouldCache = !invalidatedAt || invalidatedAt < requestStartTime

          // Cache successful results
          if (cacheTTL > 0 && shouldCache) {
            resultCache.set(key, {
              data: result,
              timestamp: Date.now(),
            })
          }

          return result
        } catch (error) {
          // Cache error results if enabled
          const invalidatedAt = cacheInvalidatedAt.get(key)
          const shouldCache = !invalidatedAt || invalidatedAt < requestStartTime

          if (cacheTTL > 0 && cacheErrors && shouldCache) {
            resultCache.set(key, {
              data: error as T,
              timestamp: Date.now(),
            })
          }

          throw error
        } finally {
          // Clean up in-flight request
          inFlightRequests.delete(key)
        }
      })()

      // Store promise atomically (double-check locking pattern)
      const existingPromise = inFlightRequests.get(key)
      if (existingPromise) {
        requestPromise = existingPromise
      } else {
        inFlightRequests.set(key, requestPromise)
      }
    }

    return requestPromise
  }

  const clearCache = (key: string): void => {
    resultCache.delete(key)
    // Mark cache as invalidated to prevent in-flight requests from caching stale data
    cacheInvalidatedAt.set(key, Date.now())
    // Remove in-flight request so new requests start fresh
    inFlightRequests.delete(key)
  }

  const clearAllCache = (): void => {
    resultCache.clear()
    cacheInvalidatedAt.clear()
    inFlightRequests.clear()
  }

  const getStats = () => ({
    inFlight: inFlightRequests.size,
    cached: resultCache.size,
  })

  return {
    deduplicate,
    clearCache,
    clearAllCache,
    getStats,
  }
}

/**
 * Shared subscription check deduplicator
 *
 * Prevents duplicate subscription checks by:
 * - Deduplicating concurrent requests (multiple requests share the same promise)
 * - Caching results for 2 seconds (prevents duplicate sequential requests)
 * - Automatic cleanup of expired cache entries
 * - Memory-safe with max cache size
 *
 * Note: This is a simple in-memory cache suitable for single-instance deployments.
 * For multi-instance deployments, consider using Redis or a shared cache.
 */
let sharedSubscriptionDeduplicator: ReturnType<
  typeof createRequestDeduplicator<SubscriptionCheckResult>
> | null = null

export function getSharedDeduplicator(options?: RequestDeduplicationOptions) {
  if (!sharedSubscriptionDeduplicator) {
    sharedSubscriptionDeduplicator = createRequestDeduplicator<SubscriptionCheckResult>({
      cacheTTL: 2000, // Cache results for 2 seconds
      maxCacheSize: 1000, // Maximum cache entries
      cacheErrors: true, // Cache error results too
      ...options,
    })
  }
  return sharedSubscriptionDeduplicator
}

/**
 * Clear subscription cache for a specific user.
 *
 * Useful when you know subscription status has changed (e.g., after a successful
 * checkout, subscription update, or cancellation). This forces the next
 * `checkSubscription()` call to fetch fresh data from the backend.
 *
 * @param userId - User ID to clear cache for
 *
 * @example
 * ```typescript
 * import { clearSubscriptionCache } from '@solvapay/next';
 *
 * // After successful payment
 * await processPayment(request, body);
 * clearSubscriptionCache(userId); // Force refresh on next check
 * ```
 *
 * @see {@link checkSubscription} for subscription checking
 * @see {@link clearAllSubscriptionCache} to clear all cache entries
 * @since 1.0.0
 */
export function clearSubscriptionCache(userId: string): void {
  const deduplicator = getSharedDeduplicator()
  deduplicator.clearCache(userId)
}

/**
 * Clear all subscription cache entries.
 *
 * Useful for testing, debugging, or when you need to force fresh lookups
 * for all users. This clears both the in-flight request cache and the
 * result cache.
 *
 * @example
 * ```typescript
 * import { clearAllSubscriptionCache } from '@solvapay/next';
 *
 * // In a test setup
 * beforeEach(() => {
 *   clearAllSubscriptionCache();
 * });
 * ```
 *
 * @see {@link clearSubscriptionCache} to clear cache for a specific user
 * @see {@link getSubscriptionCacheStats} for cache monitoring
 * @since 1.0.0
 */
export function clearAllSubscriptionCache(): void {
  const deduplicator = getSharedDeduplicator()
  deduplicator.clearAllCache()
}

/**
 * Get subscription cache statistics for monitoring and debugging.
 *
 * Returns the current state of the subscription cache, including:
 * - Number of in-flight requests (being deduplicated)
 * - Number of cached results
 *
 * @returns Cache statistics object
 * @returns inFlight - Number of currently in-flight requests
 * @returns cached - Number of cached results
 *
 * @example
 * ```typescript
 * import { getSubscriptionCacheStats } from '@solvapay/next';
 *
 * // In a monitoring endpoint
 * export async function GET() {
 *   const stats = getSubscriptionCacheStats();
 *   return Response.json({
 *     cache: {
 *       inFlight: stats.inFlight,
 *       cached: stats.cached
 *     }
 *   });
 * }
 * ```
 *
 * @see {@link checkSubscription} for subscription checking
 * @since 1.0.0
 */
export function getSubscriptionCacheStats(): { inFlight: number; cached: number } {
  const deduplicator = getSharedDeduplicator()
  return deduplicator.getStats()
}
