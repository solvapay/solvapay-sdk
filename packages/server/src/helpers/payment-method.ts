/**
 * Payment-method helpers (core).
 *
 * Thin wrapper over `GET /v1/sdk/payment-method`. Extracts the authenticated
 * user from the request via `syncCustomerCore`, then asks the SolvaPay API
 * for the customer's default card. Returns `{ kind: 'none' }` gracefully
 * when no card is on file; any other failure surfaces as an `ErrorResult`.
 */

import type { SolvaPay } from '../factory'
import type { PaymentMethodInfo, RemovedPaymentMethodResult } from '../types/client'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
import { handleRouteError, isErrorResult } from './error'
import { syncCustomerCore } from './customer'

export async function getPaymentMethodCore(
  request: Request,
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<PaymentMethodInfo | ErrorResult> {
  try {
    const customerResult = await syncCustomerCore(request, {
      solvaPay: options.solvaPay,
      includeEmail: options.includeEmail,
      includeName: options.includeName,
    })

    if (isErrorResult(customerResult)) {
      return customerResult
    }

    const customerRef = customerResult
    const solvaPay = options.solvaPay || createSolvaPay()

    if (!solvaPay.apiClient.getPaymentMethod) {
      return {
        error: 'getPaymentMethod is not implemented on this API client',
        status: 500,
      }
    }

    return await solvaPay.apiClient.getPaymentMethod({ customerRef })
  } catch (error) {
    return handleRouteError(error, 'Get payment method', 'Failed to load payment method')
  }
}

/**
 * Remove the authenticated customer's card on file (`DELETE /v1/sdk/payment-method`).
 * The next saved card becomes the default; auto-recharge on the removed card
 * waits for a new one. No card on file surfaces as a 404 `ErrorResult`.
 */
export async function removePaymentMethodCore(
  request: Request,
  options: {
    solvaPay?: SolvaPay
    includeEmail?: boolean
    includeName?: boolean
  } = {},
): Promise<RemovedPaymentMethodResult | ErrorResult> {
  try {
    const customerResult = await syncCustomerCore(request, {
      solvaPay: options.solvaPay,
      includeEmail: options.includeEmail,
      includeName: options.includeName,
    })

    if (isErrorResult(customerResult)) {
      return customerResult
    }

    const solvaPay = options.solvaPay || createSolvaPay()

    if (!solvaPay.apiClient.removePaymentMethod) {
      return {
        error: 'removePaymentMethod is not implemented on this API client',
        status: 500,
      }
    }

    return await solvaPay.apiClient.removePaymentMethod({ customerRef: customerResult })
  } catch (error) {
    return handleRouteError(error, 'Remove payment method', 'Failed to remove payment method')
  }
}
