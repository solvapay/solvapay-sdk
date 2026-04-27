/**
 * Payment-method helpers (core).
 *
 * Thin wrapper over `GET /v1/sdk/payment-method`. Extracts the authenticated
 * user from the request via `syncCustomerCore`, then asks the SolvaPay API
 * for the customer's default card. Returns `{ kind: 'none' }` gracefully
 * when no card is on file; any other failure surfaces as an `ErrorResult`.
 */

import type { SolvaPay } from '../factory'
import type { PaymentMethodInfo } from '../types/client'
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
