import { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import { cancelRenewalCore, isErrorResult } from '@solvapay/server'
import { clearPurchaseCache } from '../cache'
import { getAuthenticatedUserCore } from '@solvapay/server'

/**
 * Next.js Renewal Helpers
 *
 * Next.js-specific wrappers for renewal helpers.
 */

/**
 * Cancel renewal - Next.js wrapper
 *
 * @param request - Next.js request object
 * @param body - Cancellation parameters
 * @param options - Configuration options
 * @returns Cancelled purchase response or NextResponse error
 */
export async function cancelRenewal(
  request: globalThis.Request,
  body: {
    purchaseRef: string
    reason?: string
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<Record<string, unknown> | NextResponse> {
  const result = await cancelRenewalCore(request, body, options)

  if (isErrorResult(result)) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status },
    )
  }

  // Clear purchase cache to ensure fresh data on next check
  try {
    const userResult = await getAuthenticatedUserCore(request)
    if (!isErrorResult(userResult)) {
      clearPurchaseCache(userResult.userId)
    }
  } catch {
    // Ignore errors in cache clearing
  }

  return result
}
