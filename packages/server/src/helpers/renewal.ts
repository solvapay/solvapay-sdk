/**
 * Purchase Cancellation Helpers (Core)
 *
 * Generic helpers for purchase cancellation operations.
 * Works with standard Web API Request (works everywhere).
 */

import type { SolvaPay } from '../factory'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
import { SolvaPayError } from '@solvapay/core'
import { handleRouteError } from './error'

/**
 * Cancel purchase - core implementation
 *
 * @param request - Standard Web API Request
 * @param body - Cancellation parameters
 * @param options - Configuration options
 * @returns Cancelled purchase response or error result
 */
export async function cancelPurchaseCore(
  request: Request,
  body: {
    purchaseRef: string
    reason?: string
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<any | ErrorResult> {
  try {
    if (!body.purchaseRef) {
      return {
        error: 'Missing required parameter: purchaseRef is required',
        status: 400,
      }
    }

    const solvaPay = options.solvaPay || createSolvaPay()

    if (!solvaPay.apiClient.cancelPurchase) {
      return {
        error: 'Cancel purchase method not available on SDK client',
        status: 500,
      }
    }

    let cancelledPurchase = await solvaPay.apiClient.cancelPurchase({
      purchaseRef: body.purchaseRef,
      reason: body.reason,
    })

    if (!cancelledPurchase || typeof cancelledPurchase !== 'object') {
      return {
        error: 'Invalid response from cancel purchase endpoint',
        status: 500,
      }
    }

    const responseAny = cancelledPurchase as any
    if (responseAny.purchase && typeof responseAny.purchase === 'object') {
      cancelledPurchase = responseAny.purchase
    }

    if (!cancelledPurchase.reference) {
      return {
        error: 'Cancel purchase response missing required fields',
        status: 500,
      }
    }

    const isCancelled =
      cancelledPurchase.status === 'cancelled' || cancelledPurchase.cancelledAt

    if (!isCancelled) {
      return {
        error: `Purchase cancellation failed: backend returned status '${cancelledPurchase.status}' without cancelledAt timestamp`,
        status: 500,
      }
    }

    await new Promise(resolve => setTimeout(resolve, 500))

    return cancelledPurchase
  } catch (error: unknown) {
    if (error instanceof SolvaPayError) {
      const errorMessage = error.message

      if (errorMessage.includes('not found')) {
        return {
          error: 'Purchase not found',
          status: 404,
          details: errorMessage,
        }
      }

      if (
        errorMessage.includes('cannot be cancelled') ||
        errorMessage.includes('does not belong to provider')
      ) {
        return {
          error: 'Purchase cannot be cancelled or does not belong to provider',
          status: 400,
          details: errorMessage,
        }
      }

      return {
        error: errorMessage,
        status: 500,
        details: errorMessage,
      }
    }

    return handleRouteError(error, 'Cancel purchase', 'Failed to cancel purchase')
  }
}
