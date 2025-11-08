/**
 * Next.js Subscription Helpers
 *
 * Next.js-specific wrappers for subscription helpers.
 */

import { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import { cancelSubscriptionCore, type ErrorResult, isErrorResult } from '@solvapay/server'
import { clearSubscriptionCache } from '../cache'
import { getAuthenticatedUserCore } from '@solvapay/server'

/**
 * Cancel subscription - Next.js wrapper
 *
 * @param request - Next.js request object
 * @param body - Cancellation parameters
 * @param options - Configuration options
 * @returns Cancelled subscription response or NextResponse error
 */
export async function cancelSubscription(
  request: globalThis.Request,
  body: {
    subscriptionRef: string
    reason?: string
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<any | NextResponse> {
  const result = await cancelSubscriptionCore(request, body, options)

  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    )
  }

  // Clear subscription cache to ensure fresh data on next check
  try {
    const userResult = await getAuthenticatedUserCore(request)
    if (!isErrorResult(userResult)) {
      clearSubscriptionCache(userResult.userId)
    }
  } catch {
    // Ignore errors in cache clearing
  }

  return result
}
