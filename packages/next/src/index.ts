/**
 * SolvaPay Next.js SDK
 *
 * Framework-specific helpers and utilities for Next.js API routes.
 * These utilities provide common patterns with built-in optimizations
 * like request deduplication and caching.
 */

import { NextResponse } from 'next/server'
import { createSolvaPay, type SolvaPay } from '@solvapay/server'
import { SolvaPayError } from '@solvapay/core'
import {
  getSharedDeduplicator,
  type RequestDeduplicationOptions,
  type SubscriptionCheckResult,
} from './cache'

// Re-export types for backward compatibility
export type { RequestDeduplicationOptions, SubscriptionCheckResult } from './cache'

/**
 * Options for checking subscriptions
 */
export interface CheckSubscriptionOptions {
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
 * @param options.deduplication - Request deduplication options (see {@link RequestDeduplicationOptions})
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
  options: CheckSubscriptionOptions = {},
): Promise<SubscriptionCheckResult | NextResponse> {
  try {
    // Dynamic import to avoid requiring auth package if not needed
    const { requireUserId, getUserEmailFromRequest, getUserNameFromRequest } = await import(
      '@solvapay/auth'
    )

    // Get userId from middleware (set by middleware.ts)
    const userIdOrError = requireUserId(request)
    if (userIdOrError instanceof Response) {
      // Convert Response to NextResponse - clone the response first to read body
      const clonedResponse = userIdOrError.clone()
      const body = await clonedResponse.json().catch(() => ({ error: 'Unauthorized' }))
      return NextResponse.json(body, { status: userIdOrError.status })
    }
    const userId = userIdOrError

    // Get user email and name from Supabase JWT token
    const email = options.includeEmail !== false ? await getUserEmailFromRequest(request) : null
    const name = options.includeName !== false ? await getUserNameFromRequest(request) : null

    // Check for cached customerRef from client-side localStorage
    const cachedCustomerRef = request.headers.get('x-solvapay-customer-ref')

    // Use provided SolvaPay instance or create new one
    const solvaPay = options.solvaPay || createSolvaPay()

    // If cached customerRef is provided, validate it first (fast path)
    // IMPORTANT: We must validate that the cached customerRef belongs to the current userId
    // to prevent showing subscription data from a different user
    // customerRef is the SolvaPay customer ID (e.g., cus_VQ6VQ8HV)
    // userId is the Supabase user ID (e.g., e5dd246c-a472-4f27-8779-2bd45f3d73a2)
    // We validate by checking customer.externalRef === userId
    if (cachedCustomerRef) {
      try {
        // Try to get customer data first (fast path attempt)
        const customer = await solvaPay.getCustomer({ customerRef: cachedCustomerRef })

        if (customer && customer.customerRef) {
          // Validate that this customerRef belongs to the current userId
          // customer.externalRef is the Supabase user ID stored when customer was created
          // Only use fast path if externalRef exists and matches the current userId
          // If externalRef is undefined, we can't validate ownership, so fall through to normal lookup
          if (customer.externalRef && customer.externalRef === userId) {
            // Filter to only include active subscriptions
            // Backend keeps subscriptions as 'active' until expiration, even when cancelled
            const filteredSubscriptions = (customer.subscriptions || []).filter(
              sub => sub.status === 'active',
            )

            // Cache hit - return immediately (fast path)
            return {
              customerRef: customer.customerRef,
              email: customer.email,
              name: customer.name,
              subscriptions: filteredSubscriptions,
            } as SubscriptionCheckResult
          }
          // If externalRef doesn't match userId, fall through to normal lookup
          // This ensures we always use the correct customerRef for the current userId
        }
      } catch {
        // Cached ref is invalid, fall through to normal lookup
        // This is expected if cache is stale or customer was deleted
      }
    }

    // Use shared deduplicator
    const deduplicator = getSharedDeduplicator(options.deduplication)

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
        })

        // Get customer details including subscriptions using the backend customer reference
        const customer = await solvaPay.getCustomer({ customerRef: ensuredCustomerRef })

        // Filter subscriptions to only include active ones
        // Backend keeps subscriptions as 'active' until expiration, even when cancelled.
        // Cancellation is tracked via cancelledAt field.
        const filteredSubscriptions = (customer.subscriptions || []).filter(
          sub => sub.status === 'active',
        )

        // Return customer data with filtered subscriptions
        const result = {
          customerRef: customer.customerRef || userId,
          email: customer.email,
          name: customer.name,
          subscriptions: filteredSubscriptions,
        } as SubscriptionCheckResult

        return result
      } catch (error) {
        console.error('[checkSubscription] Error fetching customer:', error)
        // Customer doesn't exist yet - return empty subscriptions (free tier)
        return {
          customerRef: userId,
          subscriptions: [],
        } as SubscriptionCheckResult
      }
    })

    return response
  } catch (error) {
    console.error('Check subscription failed:', error)

    // Handle SolvaPay configuration errors
    if (error instanceof SolvaPayError) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json(
      { error: 'Failed to check subscription', details: errorMessage },
      { status: 500 },
    )
  }
}

// Re-export cache functions for backward compatibility
export {
  clearSubscriptionCache,
  clearAllSubscriptionCache,
  getSubscriptionCacheStats,
} from './cache'

// Export route helpers
export {
  getAuthenticatedUser,
  syncCustomer,
  createPaymentIntent,
  processPayment,
  createCheckoutSession,
  createCustomerSession,
  cancelRenewal,
  listPlans,
  createAuthMiddleware,
  createSupabaseAuthMiddleware,
} from './helpers'

// Export middleware types
export type { AuthMiddlewareOptions, SupabaseAuthMiddlewareOptions } from './helpers'
