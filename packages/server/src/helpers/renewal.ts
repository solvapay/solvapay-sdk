/**
 * Renewal Helpers (Core)
 *
 * Generic helpers for renewal cancellation operations.
 * Works with standard Web API Request (works everywhere).
 */

import type { SolvaPay } from '../factory'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
import { SolvaPayError } from '@solvapay/core'
import { handleRouteError } from './error'

/**
 * Cancel renewal - core implementation
 *
 * @param request - Standard Web API Request
 * @param body - Cancellation parameters
 * @param options - Configuration options
 * @returns Cancelled purchase response or error result
 */
export async function cancelRenewalCore(
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
    // Validate required parameters
    if (!body.purchaseRef) {
      return {
        error: 'Missing required parameter: purchaseRef is required',
        status: 400,
      }
    }

    // Use provided SolvaPay instance or create new one
    const solvaPay = options.solvaPay || createSolvaPay()

    // Use the SDK client to cancel the renewal
    if (!solvaPay.apiClient.cancelRenewal) {
      return {
        error: 'Cancel renewal method not available on SDK client',
        status: 500,
      }
    }

    let cancelledPurchase = await solvaPay.apiClient.cancelRenewal({
      purchaseRef: body.purchaseRef,
      reason: body.reason,
    })

    // Validate response (client should already extract purchase from nested response)
    if (!cancelledPurchase || typeof cancelledPurchase !== 'object') {
      return {
        error: 'Invalid response from cancel renewal endpoint',
        status: 500,
      }
    }

    // Fallback: Extract purchase from nested response if client didn't already do it
    const responseAny = cancelledPurchase as any
    if (responseAny.purchase && typeof responseAny.purchase === 'object') {
      cancelledPurchase = responseAny.purchase
    }

    // Validate required fields
    if (!cancelledPurchase.reference) {
      return {
        error: 'Cancel renewal response missing required fields',
        status: 500,
      }
    }

    // Check if renewal was actually cancelled
    const isCancelled =
      cancelledPurchase.status === 'cancelled' || cancelledPurchase.cancelledAt

    if (!isCancelled) {
      return {
        error: `Renewal cancellation failed: backend returned status '${cancelledPurchase.status}' without cancelledAt timestamp`,
        status: 500,
      }
    }

    // Add a small delay to allow backend to fully process the cancellation
    await new Promise(resolve => setTimeout(resolve, 500))

    return cancelledPurchase
  } catch (error: unknown) {
    // Handle SolvaPay errors and map to appropriate HTTP status codes
    if (error instanceof SolvaPayError) {
      const errorMessage = error.message

      // Map specific error messages to HTTP status codes
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
          error: 'Renewal cannot be cancelled or purchase does not belong to provider',
          status: 400,
          details: errorMessage,
        }
      }

      // For other SolvaPay errors, return 500
      return {
        error: errorMessage,
        status: 500,
        details: errorMessage,
      }
    }

    return handleRouteError(error, 'Cancel renewal', 'Failed to cancel renewal')
  }
}
