/**
 * SolvaPay Next.js SDK
 *
 * Framework-specific helpers and utilities for Next.js API routes.
 * These utilities provide common patterns with built-in optimizations
 * like request deduplication and caching.
 */

import { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import { checkPurchaseCore, isErrorResult } from '@solvapay/server'
import {
  getSharedDeduplicator,
  type RequestDeduplicationOptions,
  type PurchaseCheckResult,
} from './cache'

// Re-export types for backward compatibility
export type { RequestDeduplicationOptions, PurchaseCheckResult } from './cache'

/**
 * Options for checking purchases
 */
export interface CheckPurchaseOptions {
  /**
   * Request deduplication options
   *
   * Default values:
   * - `cacheTTL`: 2000ms
   * - `maxCacheSize`: 1000
   * - `cacheErrors`: true
   */
  deduplication?: RequestDeduplicationOptions

  /**
   * Custom SolvaPay instance (optional)
   * If not provided, a new instance will be created
   */
  solvaPay?: SolvaPay

  /**
   * Whether to include user email in customer data
   * Default: true
   */
  includeEmail?: boolean

  /**
   * Whether to include user name in customer data
   * Default: true
   */
  includeName?: boolean
}

/**
 * Check user purchase status with automatic deduplication and caching.
 *
 * This Next.js helper function provides optimized purchase checking with:
 * - Automatic request deduplication (concurrent requests share the same promise)
 * - Short-term caching (2 seconds) to prevent duplicate sequential requests
 * - Fast path optimization using cached customer references from client
 * - Automatic customer creation if needed
 *
 * Delegates to `checkPurchaseCore` from `@solvapay/server` for the actual logic,
 * wrapping with Next.js-specific deduplication and response formatting.
 */
export async function checkPurchase(
  request: Request,
  options: CheckPurchaseOptions = {},
): Promise<PurchaseCheckResult | NextResponse> {
  // Without deduplication, delegate directly to core
  const deduplicator = getSharedDeduplicator(options.deduplication)

  // Extract a cache key from the request's auth header for deduplication
  // The core helper handles the actual auth extraction, but we need a key for the cache
  try {
    const { requireUserId } = await import('@solvapay/auth')
    const userIdOrError = requireUserId(request)

    if (userIdOrError instanceof Response) {
      const clonedResponse = userIdOrError.clone()
      const body = await clonedResponse.json().catch(() => ({ error: 'Unauthorized' }))
      return NextResponse.json(body, { status: userIdOrError.status })
    }

    const userId = userIdOrError

    const response = await deduplicator.deduplicate(userId, async () => {
      const result = await checkPurchaseCore(request, {
        solvaPay: options.solvaPay,
        includeEmail: options.includeEmail,
        includeName: options.includeName,
      })

      if (isErrorResult(result)) {
        return {
          customerRef: userId,
          purchases: [],
        } as PurchaseCheckResult
      }

      return result as PurchaseCheckResult
    })

    return response
  } catch (error) {
    console.error('Check purchase failed:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to check purchase', details: errorMessage },
      { status: 500 },
    )
  }
}

// Re-export cache functions for backward compatibility
export {
  clearPurchaseCache,
  clearAllPurchaseCache,
  getPurchaseCacheStats,
} from './cache'

// Export route helpers
export {
  getAuthenticatedUser,
  syncCustomer,
  getCustomerBalance,
  createPaymentIntent,
  createTopupPaymentIntent,
  processPaymentIntent,
  createCheckoutSession,
  createCustomerSession,
  activatePlan,
  cancelRenewal,
  reactivateRenewal,
  listPlans,
  trackUsage,
  createAuthMiddleware,
  createSupabaseAuthMiddleware,
} from './helpers'

// Export middleware types
export type { AuthMiddlewareOptions, SupabaseAuthMiddlewareOptions } from './helpers'
