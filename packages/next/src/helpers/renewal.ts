import type { NextResponse } from 'next/server'
import type { SolvaPay } from '@solvapay/server'
import {
  cancelPurchaseCore,
  reactivatePurchaseCore,
  isErrorResult,
  getAuthenticatedUserCore,
} from '@solvapay/server'
import { clearPurchaseCache } from '../cache'
import { toNextRouteResponse } from './_response'

/**
 * Next.js Purchase Cancellation & Reactivation Helpers
 */

/**
 * Next.js route wrapper for POST /api/cancel-renewal.
 *
 * @example
 * ```ts
 * // app/api/cancel-renewal/route.ts
 * import { cancelRenewal } from '@solvapay/next/helpers'
 *
 * export async function POST(request: Request) {
 *   const { purchaseRef, reason } = await request.json()
 *   return cancelRenewal(request, { purchaseRef, reason })
 * }
 * ```
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
): Promise<NextResponse> {
  const result = await cancelPurchaseCore(request, body, options)

  if (!isErrorResult(result)) {
    try {
      const userResult = await getAuthenticatedUserCore(request)
      if (!isErrorResult(userResult)) {
        clearPurchaseCache(userResult.userId)
      }
    } catch {
      // Ignore errors in cache clearing
    }
  }

  return toNextRouteResponse(result)
}

/**
 * Next.js route wrapper for POST /api/reactivate-renewal.
 *
 * Undoes a pending cancellation, restoring auto-renewal.
 *
 * @example
 * ```ts
 * // app/api/reactivate-renewal/route.ts
 * import { reactivateRenewal } from '@solvapay/next/helpers'
 *
 * export async function POST(request: Request) {
 *   const { purchaseRef } = await request.json()
 *   return reactivateRenewal(request, { purchaseRef })
 * }
 * ```
 */
export async function reactivateRenewal(
  request: globalThis.Request,
  body: {
    purchaseRef: string
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<NextResponse> {
  const result = await reactivatePurchaseCore(request, body, options)

  if (!isErrorResult(result)) {
    try {
      const userResult = await getAuthenticatedUserCore(request)
      if (!isErrorResult(userResult)) {
        clearPurchaseCache(userResult.userId)
      }
    } catch {
      // Ignore errors in cache clearing
    }
  }

  return toNextRouteResponse(result)
}
