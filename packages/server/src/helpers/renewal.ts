/**
 * Purchase Cancellation & Reactivation Helpers (Core)
 *
 * Generic helpers for purchase cancellation and reactivation operations.
 * Works with standard Web API Request (works everywhere).
 */

import { isRenewalError, SolvaPayError } from '@solvapay/core'
import {
  classifyCancelError,
  classifyReactivateError,
  normalizeCancelResponse,
  normalizeReactivateResponse,
  validatePurchaseRef,
} from '../native-decisions'
import type { SolvaPay } from '../factory'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
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
    const validationError = validatePurchaseRef(body.purchaseRef)
    if (validationError) {
      return validationError
    }

    const solvaPay = options.solvaPay || createSolvaPay()

    if (!solvaPay.apiClient.cancelPurchase) {
      return {
        error: 'Cancel purchase method not available on SDK client',
        status: 500,
      }
    }

    const cancelledPurchase = await solvaPay.apiClient.cancelPurchase({
      purchaseRef: body.purchaseRef,
      reason: body.reason,
    })

    const normalized = normalizeCancelResponse(cancelledPurchase)
    if (isRenewalError(normalized)) {
      return normalized
    }

    await new Promise(resolve => setTimeout(resolve, 500))

    return normalized
  } catch (error: unknown) {
    if (error instanceof SolvaPayError) {
      return classifyCancelError(error.message)
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
    const validationError = validatePurchaseRef(body.purchaseRef)
    if (validationError) {
      return validationError
    }

    const solvaPay = options.solvaPay || createSolvaPay()

    if (!solvaPay.apiClient.reactivatePurchase) {
      return {
        error: 'Reactivate purchase method not available on SDK client',
        status: 500,
      }
    }

    const reactivatedPurchase = await solvaPay.apiClient.reactivatePurchase({
      purchaseRef: body.purchaseRef,
    })

    const normalized = normalizeReactivateResponse(reactivatedPurchase)
    if (isRenewalError(normalized)) {
      return normalized
    }

    await new Promise(resolve => setTimeout(resolve, 500))

    return normalized
  } catch (error: unknown) {
    if (error instanceof SolvaPayError) {
      return classifyReactivateError(error.message)
    }

    return handleRouteError(error, 'Reactivate purchase', 'Failed to reactivate purchase')
  }
}
