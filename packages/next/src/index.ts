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
 * Check user subscription status with automatic deduplication and caching.
 * 
 * This Next.js helper function provides optimized subscription checking with:
 * - Automatic request deduplication (concurrent requests share the same promise)
 * - Short-term caching (2 seconds) to prevent duplicate sequential requests
 * - Fast path optimization using cached customer references from client
 * - Automatic customer creation if needed
 * 
 * The function:
 * 1. Extracts user ID from request (via requireUserId from @solvapay/auth)
 * 2. Gets user email and name from Supabase JWT token (if available)
 * 3. Validates cached customer reference (if provided via header)
 * 4. Ensures customer exists in SolvaPay backend
 * 5. Returns customer subscription information
 * 
 * @param request - Next.js request object (NextRequest extends Request)
 * @param options - Configuration options
 * @param options.deduplication - Request deduplication options
 * @param options.deduplication.cacheTTL - Cache TTL in milliseconds (default: 2000)
 * @param options.deduplication.maxCacheSize - Maximum cache size (default: 1000)
 * @param options.solvaPay - Optional SolvaPay instance (creates new one if not provided)
 * @param options.includeEmail - Whether to include email in response (default: true)
 * @param options.includeName - Whether to include name in response (default: true)
 * @returns Subscription check result with customer data and subscriptions, or NextResponse error
 * 
 * @example
 * ```typescript
 * import { NextRequest, NextResponse } from 'next/server';
 * import { checkSubscription } from '@solvapay/next';
 * 
 * export async function GET(request: NextRequest) {
 *   const result = await checkSubscription(request);
 *   
 *   if (result instanceof NextResponse) {
 *     return result; // Error response
 *   }
 *   
 *   return NextResponse.json(result);
 * }
 * ```
 * 
 * @see {@link clearSubscriptionCache} for cache management
 * @see {@link getSubscriptionCacheStats} for cache monitoring
 * @since 1.0.0
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

    // Check for cached customerRef from client-side localStorage
    const cachedCustomerRef = request.headers.get('x-solvapay-customer-ref');
    
    // Use provided SolvaPay instance or create new one
    const solvaPay = options.solvaPay || createSolvaPay();
    
    // If cached customerRef is provided, validate it first (fast path)
    // IMPORTANT: We must validate that the cached customerRef belongs to the current userId
    // to prevent showing subscription data from a different user
    // customerRef is the SolvaPay customer ID (e.g., cus_VQ6VQ8HV)
    // userId is the Supabase user ID (e.g., e5dd246c-a472-4f27-8779-2bd45f3d73a2)
    // We validate by checking customer.externalRef === userId
    if (cachedCustomerRef) {
      try {
        // Try to get customer data first (fast path attempt)
        const customer = await solvaPay.getCustomer({ customerRef: cachedCustomerRef });
        
        if (customer && customer.customerRef) {
          // Validate that this customerRef belongs to the current userId
          // customer.externalRef is the Supabase user ID stored when customer was created
          // Only use fast path if externalRef exists and matches the current userId
          // If externalRef is undefined, we can't validate ownership, so fall through to normal lookup
          if (customer.externalRef && customer.externalRef === userId) {
            // Filter to only include active subscriptions
            // Backend keeps subscriptions as 'active' until expiration, even when cancelled
            const filteredSubscriptions = (customer.subscriptions || []).filter(
              sub => sub.status === 'active'
            );
            
            // Cache hit - return immediately (fast path)
            return {
              customerRef: customer.customerRef,
              email: customer.email,
              name: customer.name,
              subscriptions: filteredSubscriptions,
            } as SubscriptionCheckResult;
          }
          // If externalRef doesn't match userId, fall through to normal lookup
          // This ensures we always use the correct customerRef for the current userId
        }
      } catch (error) {
        // Cached ref is invalid, fall through to normal lookup
        // This is expected if cache is stale or customer was deleted
      }
    }

    // Use shared deduplicator
    const deduplicator = getSharedDeduplicator(options.deduplication);
    
    // Deduplicate subscription check
    const response = await deduplicator.deduplicate(userId, async () => {
      try {

        // Use userId as cache key and externalRef (Supabase user IDs are stable UUIDs)
        // The first parameter (customerRef) is used as a cache key
        // The second parameter (externalRef) is stored on the SolvaPay backend for customer lookup
        // Ensure customer exists and get backend customer reference using externalRef
        // Pass email and name to ensure correct customer data
        // Note: Customer lookup deduplication is handled automatically by the SDK
        // The returned customerRef is the SolvaPay backend customer reference (different from Supabase user ID)
        const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId, {
          email: email || undefined,
          name: name || undefined,
        });

        // Get customer details including subscriptions using the backend customer reference
        const customer = await solvaPay.getCustomer({ customerRef: ensuredCustomerRef });

        // Filter subscriptions to only include active ones
        // Backend keeps subscriptions as 'active' until expiration, even when cancelled.
        // Cancellation is tracked via cancelledAt field.
        const filteredSubscriptions = (customer.subscriptions || []).filter(
          sub => sub.status === 'active'
        );

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
  const deduplicator = getSharedDeduplicator();
  deduplicator.clearCache(userId);
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
  const deduplicator = getSharedDeduplicator();
  deduplicator.clearAllCache();
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
  const deduplicator = getSharedDeduplicator();
  return deduplicator.getStats();
}

// Export route helpers
export {
  getAuthenticatedUser,
  syncCustomer,
  createPaymentIntent,
  processPayment,
  createCheckoutSession,
  createCustomerSession,
  cancelSubscription,
  listPlans,
  createAuthMiddleware,
  createSupabaseAuthMiddleware,
} from './helpers';

// Export middleware types
export type { AuthMiddlewareOptions, SupabaseAuthMiddlewareOptions } from './helpers';

