import type { GetHistoryResult } from '../types/client'
import type { SolvaPay } from '../factory'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
import { handleRouteError, isErrorResult } from './error'
import { syncCustomerCore } from './customer'

type HelperOptions = {
  solvaPay?: SolvaPay
  includeEmail?: boolean
  includeName?: boolean
}

export type GetHistoryInput = {
  productRef: string
  limit?: number
}

async function resolveCustomerRef(
  request: Request,
  options: HelperOptions,
): Promise<string | ErrorResult> {
  return syncCustomerCore(request, {
    solvaPay: options.solvaPay,
    includeEmail: options.includeEmail,
    includeName: options.includeName,
  })
}

/**
 * Product-scoped charges plus account-wide credit activity. Not a
 * bootstrap field — `checkPurchaseCore` filters to active purchases, so
 * history has to be fetched on section mount.
 */
export async function getHistoryCore(
  request: Request,
  input: GetHistoryInput,
  options: HelperOptions = {},
): Promise<GetHistoryResult | ErrorResult> {
  try {
    if (!input.productRef) {
      return { error: 'getHistory requires productRef', status: 400 }
    }

    const customerRef = await resolveCustomerRef(request, options)
    if (isErrorResult(customerRef)) return customerRef

    const solvaPay = options.solvaPay ?? createSolvaPay()
    if (!solvaPay.apiClient.listPurchases) {
      return { error: 'listPurchases is not implemented on this API client', status: 500 }
    }
    if (!solvaPay.apiClient.getCreditActivity) {
      return { error: 'getCreditActivity is not implemented on this API client', status: 500 }
    }

    const [purchasesResult, creditActivity] = await Promise.all([
      solvaPay.apiClient.listPurchases({
        customerRef,
        productRef: input.productRef,
      }),
      solvaPay.apiClient.getCreditActivity({
        customerRef,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      }),
    ])

    return {
      charges: purchasesResult.purchases ?? [],
      creditActivity,
    }
  } catch (error) {
    return handleRouteError(error, 'Get history', 'Failed to load history')
  }
}
