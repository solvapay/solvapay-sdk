/**
 * Subscription Helpers (Core)
 *
 * Generic helpers for subscription operations.
 * Works with standard Web API Request (works everywhere).
 */

import type { SolvaPay } from '../factory'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
import { SolvaPayError } from '@solvapay/core'
import { handleRouteError } from './error'

/**
 * Cancel subscription - core implementation
 *
 * @param request - Standard Web API Request
 * @param body - Cancellation parameters
 * @param options - Configuration options
 * @returns Cancelled subscription response or error result
 */
export async function cancelSubscriptionCore(
  request: Request,
  body: {
    subscriptionRef: string
    reason?: string
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<any | ErrorResult> {
  try {
    // Validate required parameters
    if (!body.subscriptionRef) {
      return {
        error: 'Missing required parameter: subscriptionRef is required',
        status: 400,
      }
    }

    // Use provided SolvaPay instance or create new one
    const solvaPay = options.solvaPay || createSolvaPay()

    // Use the SDK client to cancel the subscription
    if (!solvaPay.apiClient.cancelSubscription) {
      return {
        error: 'Cancel subscription method not available on SDK client',
        status: 500,
      }
    }

    let cancelledSubscription = await solvaPay.apiClient.cancelSubscription({
      subscriptionRef: body.subscriptionRef,
      reason: body.reason,
    })

    // Validate response (client should already extract subscription from nested response)
    if (!cancelledSubscription || typeof cancelledSubscription !== 'object') {
      return {
        error: 'Invalid response from cancel subscription endpoint',
        status: 500,
      }
    }

    // Fallback: Extract subscription from nested response if client didn't already do it
    const responseAny = cancelledSubscription as any
    if (responseAny.subscription && typeof responseAny.subscription === 'object') {
      cancelledSubscription = responseAny.subscription
    }

    // Validate required fields
    if (!cancelledSubscription.reference) {
      return {
        error: 'Cancel subscription response missing required fields',
        status: 500,
      }
    }

    // Check if subscription was actually cancelled
    const isCancelled =
      cancelledSubscription.status === 'cancelled' || cancelledSubscription.cancelledAt

    if (!isCancelled) {
      return {
        error: `Subscription cancellation failed: backend returned status '${cancelledSubscription.status}' without cancelledAt timestamp`,
        status: 500,
      }
    }

    // Add a small delay to allow backend to fully process the cancellation
    await new Promise(resolve => setTimeout(resolve, 500))

    return cancelledSubscription
  } catch (error: unknown) {
    // Handle SolvaPay errors and map to appropriate HTTP status codes
    if (error instanceof SolvaPayError) {
      const errorMessage = error.message

      // Map specific error messages to HTTP status codes
      if (errorMessage.includes('Subscription not found')) {
        return {
          error: 'Subscription not found',
          status: 404,
          details: errorMessage,
        }
      }

      if (
        errorMessage.includes('cannot be cancelled') ||
        errorMessage.includes('does not belong to provider')
      ) {
        return {
          error: 'Subscription cannot be cancelled or does not belong to provider',
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

    return handleRouteError(error, 'Cancel subscription', 'Failed to cancel subscription')
  }
}
