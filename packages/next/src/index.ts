/**
 * SolvaPay Next.js SDK
 * 
 * Framework-specific helpers and utilities for Next.js API routes.
 * These utilities provide common patterns with built-in optimizations
 * like request deduplication and caching.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createSolvaPay, type SolvaPay } from '@solvapay/server';
import { SolvaPayError } from '@solvapay/core';

// Import internal utilities from server package
// Note: These are internal utilities - we'll create a lightweight version if needed
// For now, we'll use a simple implementation or re-export from server

/**
 * Request deduplication and caching options
 */
export interface RequestDeduplicationOptions {
  /**
   * Time-to-live for cached results in milliseconds (default: 2000)
   * Set to 0 to disable caching (only deduplicate concurrent requests)
   */
  cacheTTL?: number;
  
  /**
   * Maximum cache size before cleanup (default: 1000)
   * When exceeded, oldest entries are removed
   */
  maxCacheSize?: number;
  
  /**
   * Whether to cache error results (default: true)
   * When false, only successful results are cached
   */
  cacheErrors?: boolean;
}

/**
 * Subscription check result
 */
export interface SubscriptionCheckResult {
  customerRef: string;
  email?: string;
  name?: string;
  subscriptions: Array<{
    reference: string;
    planName?: string;
    agentName?: string;
    status?: string;
    startDate?: string;
    [key: string]: unknown;
  }>;
}

/**
 * Options for checking subscriptions
 */
export interface CheckSubscriptionOptions {
  /**
   * Request deduplication options
   * Default: { cacheTTL: 2000, maxCacheSize: 1000, cacheErrors: true }
   */
  deduplication?: RequestDeduplicationOptions;
  
  /**
   * Custom SolvaPay instance (optional)
   * If not provided, a new instance will be created
   */
  solvaPay?: SolvaPay;
  
  /**
   * Whether to include user email in customer data
   * Default: true
   */
  includeEmail?: boolean;
  
  /**
   * Whether to include user name in customer data
   * Default: true
   */
  includeName?: boolean;
}

/**
 * Cache entry for request deduplication
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Request deduplication manager
 * 
 * Prevents duplicate API calls by:
 * 1. Deduplicating concurrent requests (multiple requests share the same promise)
 * 2. Caching results for a short time (prevents duplicate sequential requests)
 */
function createRequestDeduplicator<T = unknown>(
  options: RequestDeduplicationOptions = {}
): {
  deduplicate: (key: string, fn: () => Promise<T>) => Promise<T>;
  clearCache: (key: string) => void;
  clearAllCache: () => void;
  getStats: () => { inFlight: number; cached: number };
} {
  const {
    cacheTTL = 2000,
    maxCacheSize = 1000,
    cacheErrors = true,
  } = options;

  const inFlightRequests = new Map<string, Promise<T>>();
  const resultCache = new Map<string, CacheEntry<T>>();
  const cacheInvalidatedAt = new Map<string, number>(); // Track when cache was invalidated
  let cleanupInterval: ReturnType<typeof setInterval> | null = null;

  // Start cleanup interval if caching is enabled
  if (cacheTTL > 0) {
    cleanupInterval = setInterval(() => {
      const now = Date.now();
      const entriesToDelete: string[] = [];

      for (const [key, cached] of resultCache.entries()) {
        if (now - cached.timestamp >= cacheTTL) {
          entriesToDelete.push(key);
        }
      }

      for (const key of entriesToDelete) {
        resultCache.delete(key);
        // Clean up invalidation timestamp after cache TTL has passed
        cacheInvalidatedAt.delete(key);
      }

      // Enforce max cache size (remove oldest entries if exceeded)
      if (resultCache.size > maxCacheSize) {
        const sortedEntries = Array.from(resultCache.entries())
          .sort((a, b) => a[1].timestamp - b[1].timestamp);
        
        const toRemove = sortedEntries.slice(0, resultCache.size - maxCacheSize);
        for (const [key] of toRemove) {
          resultCache.delete(key);
          cacheInvalidatedAt.delete(key);
        }
      }
    }, Math.min(cacheTTL, 1000)); // Clean up at least every second or every cacheTTL, whichever is smaller
  }

  const deduplicate = async (key: string, fn: () => Promise<T>): Promise<T> => {
    // Check cache first if caching is enabled
    if (cacheTTL > 0) {
      const cached = resultCache.get(key);
      if (cached && Date.now() - cached.timestamp < cacheTTL) {
        // Cache hit - return immediately without executing callback
        return cached.data;
      } else if (cached) {
        // Cache expired - remove it
        resultCache.delete(key);
      }
    }

    // Check if request is already in-flight
    let requestPromise = inFlightRequests.get(key);

    if (!requestPromise) {
      // Record when this request started
      const requestStartTime = Date.now();
      
      // Create new promise
      requestPromise = (async () => {
        try {
          const result = await fn();
          
          // Only cache if cache wasn't invalidated after this request started
          const invalidatedAt = cacheInvalidatedAt.get(key);
          const shouldCache = !invalidatedAt || invalidatedAt < requestStartTime;
          
          // Cache successful results
          if (cacheTTL > 0 && shouldCache) {
            resultCache.set(key, {
              data: result,
              timestamp: Date.now(),
            });
          }
          
          return result;
        } catch (error) {
          // Cache error results if enabled
          const invalidatedAt = cacheInvalidatedAt.get(key);
          const shouldCache = !invalidatedAt || invalidatedAt < requestStartTime;
          
          if (cacheTTL > 0 && cacheErrors && shouldCache) {
            resultCache.set(key, {
              data: error as T,
              timestamp: Date.now(),
            });
          }
          
          throw error;
        } finally {
          // Clean up in-flight request
          inFlightRequests.delete(key);
        }
      })();

      // Store promise atomically (double-check locking pattern)
      const existingPromise = inFlightRequests.get(key);
      if (existingPromise) {
        requestPromise = existingPromise;
      } else {
        inFlightRequests.set(key, requestPromise);
      }
    }

    return requestPromise;
  };

  const clearCache = (key: string): void => {
    resultCache.delete(key);
    // Mark cache as invalidated to prevent in-flight requests from caching stale data
    cacheInvalidatedAt.set(key, Date.now());
    // Remove in-flight request so new requests start fresh
    inFlightRequests.delete(key);
  };

  const clearAllCache = (): void => {
    resultCache.clear();
    cacheInvalidatedAt.clear();
    inFlightRequests.clear();
  };

  const getStats = () => ({
    inFlight: inFlightRequests.size,
    cached: resultCache.size,
  });

  return {
    deduplicate,
    clearCache,
    clearAllCache,
    getStats,
  };
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
let sharedSubscriptionDeduplicator: ReturnType<typeof createRequestDeduplicator<SubscriptionCheckResult>> | null = null;

function getSharedDeduplicator(options?: RequestDeduplicationOptions) {
  if (!sharedSubscriptionDeduplicator) {
    sharedSubscriptionDeduplicator = createRequestDeduplicator<SubscriptionCheckResult>({
      cacheTTL: 2000, // Cache results for 2 seconds
      maxCacheSize: 1000, // Maximum cache entries
      cacheErrors: true, // Cache error results too
      ...options,
    });
  }
  return sharedSubscriptionDeduplicator;
}

/**
 * Check user subscription status
 * 
 * This helper function:
 * 1. Extracts user ID from request (via requireUserId from @solvapay/auth)
 * 2. Gets user email and name from Supabase JWT token
 * 3. Ensures customer exists in SolvaPay
 * 4. Returns customer subscription information
 * 5. Handles deduplication automatically
 * 
 * @param request - Next.js request object (NextRequest extends Request, so Request is accepted)
 * @param options - Configuration options
 * @returns Subscription check result or error response
 * 
 * @example
 * ```typescript
 * import { NextRequest } from 'next/server';
 * import { checkSubscription } from '@solvapay/next';
 * 
 * export async function GET(request: NextRequest) {
 *   const result = await checkSubscription(request);
 *   if (result instanceof NextResponse) {
 *     return result; // Error response
 *   }
 *   return NextResponse.json(result);
 * }
 * ```
 */
export async function checkSubscription(
  request: Request,
  options: CheckSubscriptionOptions = {}
): Promise<SubscriptionCheckResult | NextResponse> {
  try {
    // Dynamic import to avoid requiring auth package if not needed
    const { requireUserId, getUserEmailFromRequest, getUserNameFromRequest } = await import('@solvapay/auth');

    // Get userId from middleware (set by middleware.ts)
    const userIdOrError = requireUserId(request);
    if (userIdOrError instanceof Response) {
      // Convert Response to NextResponse - clone the response first to read body
      const clonedResponse = userIdOrError.clone();
      const body = await clonedResponse.json().catch(() => ({ error: 'Unauthorized' }));
      return NextResponse.json(body, { status: userIdOrError.status });
    }
    const userId = userIdOrError;

    // Get user email and name from Supabase JWT token
    const email = options.includeEmail !== false 
      ? await getUserEmailFromRequest(request) 
      : null;
    const name = options.includeName !== false 
      ? await getUserNameFromRequest(request) 
      : null;

    // Use shared deduplicator
    const deduplicator = getSharedDeduplicator(options.deduplication);
    
    // Deduplicate subscription check
    const response = await deduplicator.deduplicate(userId, async () => {
      try {
        // Use provided SolvaPay instance or create new one
        const solvaPay = options.solvaPay || createSolvaPay();

        // Use userId as customerRef (Supabase user IDs are stable UUIDs)
        // Ensure customer exists and get backend customer reference using externalRef
        // Pass email and name to ensure correct customer data
        // Note: Customer lookup deduplication is handled automatically by the SDK
        const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId, {
          email: email || undefined,
          name: name || undefined,
        });

        // Get customer details including subscriptions using the backend customer reference
        const customer = await solvaPay.getCustomer({ customerRef: ensuredCustomerRef });

        // Filter subscriptions: exclude cancelled subscriptions without endDate or with past endDate
        // A subscription is considered cancelled if:
        //   1. status === 'cancelled', OR
        //   2. cancelledAt is set (even if status is still 'active' - this is expected behavior)
        // Cancelled subscriptions are kept only if they have an endDate in the future
        // (meaning the subscription is cancelled but still active until the endDate)
        const now = new Date();
        const filteredSubscriptions = (customer.subscriptions || []).filter(sub => {
          const subAny = sub as any;
          
          // Check if subscription is cancelled (either by status or by cancelledAt timestamp)
          const isCancelled = sub.status === 'cancelled' || subAny.cancelledAt;
          
          // Keep all non-cancelled subscriptions
          if (!isCancelled) {
            return true;
          }
          
          // For cancelled subscriptions, only keep if endDate exists and is in the future
          if (isCancelled && subAny.endDate) {
            const endDate = new Date(subAny.endDate);
            const isFuture = endDate > now;
            return isFuture;
          }
          
          // Filter out cancelled subscriptions without endDate or with past endDate
          return false;
        });

        // Return customer data with filtered subscriptions
        const result = {
          customerRef: customer.customerRef || userId,
          email: customer.email,
          name: customer.name,
          subscriptions: filteredSubscriptions,
        } as SubscriptionCheckResult;
        
        return result;
      } catch (error) {
        console.error('[checkSubscription] Error fetching customer:', error);
        // Customer doesn't exist yet - return empty subscriptions (free tier)
        return {
          customerRef: userId,
          subscriptions: [],
        } as SubscriptionCheckResult;
      }
    });

    return response;
  } catch (error) {
    console.error('Check subscription failed:', error);

    // Handle SolvaPay configuration errors
    if (error instanceof SolvaPayError) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      { error: 'Failed to check subscription', details: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * Clear subscription cache for a specific user
 * 
 * Useful when you know subscription status has changed
 * (e.g., after a successful checkout or subscription update)
 * 
 * @param userId - User ID to clear cache for
 */
export function clearSubscriptionCache(userId: string): void {
  const deduplicator = getSharedDeduplicator();
  deduplicator.clearCache(userId);
}

/**
 * Clear all subscription cache entries
 * 
 * Useful for testing or when you need to force fresh lookups
 */
export function clearAllSubscriptionCache(): void {
  const deduplicator = getSharedDeduplicator();
  deduplicator.clearAllCache();
}

/**
 * Get subscription cache statistics
 * 
 * Useful for monitoring and debugging
 * 
 * @returns Cache statistics
 */
export function getSubscriptionCacheStats(): { inFlight: number; cached: number } {
  const deduplicator = getSharedDeduplicator();
  return deduplicator.getStats();
}

