/**
 * Purchase Cancellation & Reactivation Helpers (Core)
 *
 * Generic helpers for purchase cancellation and reactivation operations.
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
): Promise<Record<string, unknown> | ErrorResult> {
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

    const responseObj = cancelledPurchase as unknown as Record<string, unknown>
    if (responseObj.purchase && typeof responseObj.purchase === 'object') {
      cancelledPurchase = responseObj.purchase as typeof cancelledPurchase
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

/**
 * Reactivate purchase - core implementation
 *
 * Undoes a pending cancellation, restoring auto-renewal and clearing cancellation fields.
 * Only works while the purchase is still active and the end date hasn't passed.
 *
 * @param request - Standard Web API Request
 * @param body - Reactivation parameters
 * @param options - Configuration options
 * @returns Reactivated purchase response or error result
 */
export async function reactivatePurchaseCore(
  request: Request,
  body: {
    purchaseRef: string
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<Record<string, unknown> | ErrorResult> {
  try {
    if (!body.purchaseRef) {
      return {
        error: 'Missing required parameter: purchaseRef is required',
        status: 400,
      }
    }

    const solvaPay = options.solvaPay || createSolvaPay()

    if (!solvaPay.apiClient.reactivatePurchase) {
      return {
        error: 'Reactivate purchase method not available on SDK client',
        status: 500,
      }
    }

    let reactivatedPurchase = await solvaPay.apiClient.reactivatePurchase({
      purchaseRef: body.purchaseRef,
    })

    if (!reactivatedPurchase || typeof reactivatedPurchase !== 'object') {
      return {
        error: 'Invalid response from reactivate purchase endpoint',
        status: 500,
      }
    }

    const responseObj = reactivatedPurchase as unknown as Record<string, unknown>
    if (responseObj.purchase && typeof responseObj.purchase === 'object') {
      reactivatedPurchase = responseObj.purchase as typeof reactivatedPurchase
    }

    if (!reactivatedPurchase.reference) {
      return {
        error: 'Reactivate purchase response missing required fields',
        status: 500,
      }
    }

    if (reactivatedPurchase.cancelledAt) {
      return {
        error: `Purchase reactivation failed: cancelledAt is still set`,
        status: 500,
      }
    }

    await new Promise(resolve => setTimeout(resolve, 500))

    return reactivatedPurchase
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
        errorMessage.includes('cannot be reactivated') ||
        errorMessage.includes('not pending cancellation') ||
        errorMessage.includes('already been fully cancelled') ||
        errorMessage.includes('already ended')
      ) {
        return {
          error: 'Purchase cannot be reactivated',
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

    return handleRouteError(error, 'Reactivate purchase', 'Failed to reactivate purchase')
  }
}
