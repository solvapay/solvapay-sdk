import type { GetHistoryResult } from '../types/client'
import type { SolvaPay } from '../factory'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
import { handleRouteError, isErrorResult } from './error'
import { syncCustomerCore } from './customer'
import { getHistoryNext } from '../native-decisions'

type HelperOptions = {
  solvaPay?: SolvaPay
  includeEmail?: boolean
  includeName?: boolean
}

export type GetHistoryInput = {
  productRef: string
  limit?: number
}

type HistoryAction =
  | {
      kind: 'fetch'
      listPurchases: { customerRef: string; productRef: string }
      getCreditActivity: { customerRef: string; limit?: number }
    }
  | {
      kind: 'resolved'
      charges: GetHistoryResult['charges']
      creditActivity: GetHistoryResult['creditActivity']
    }

type HistoryStep = {
  state: unknown
  action: HistoryAction
}

function isHistoryError(value: unknown): value is ErrorResult {
  return isErrorResult(value)
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
    const customerRef = await resolveCustomerRef(request, options)
    if (isErrorResult(customerRef)) return customerRef

    const solvaPay = options.solvaPay ?? createSolvaPay()
    if (!solvaPay.apiClient.listPurchases) {
      return { error: 'listPurchases is not implemented on this API client', status: 500 }
    }
    if (!solvaPay.apiClient.getCreditActivity) {
      return { error: 'getCreditActivity is not implemented on this API client', status: 500 }
    }

    let state: unknown = null
    let event: Record<string, unknown> = {
      kind: 'start',
      customerRef,
      productRef: input.productRef,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
    }

    for (;;) {
      const step = getHistoryNext(state, event) as HistoryStep | ErrorResult
      if (isHistoryError(step)) return step
      state = step.state
      if (step.action.kind === 'fetch') {
        const [purchasesResult, creditActivity] = await Promise.all([
          solvaPay.apiClient.listPurchases(step.action.listPurchases),
          solvaPay.apiClient.getCreditActivity(step.action.getCreditActivity),
        ])
        event = {
          kind: 'results',
          purchases: purchasesResult.purchases ?? [],
          creditActivity,
        }
        continue
      }
      if (step.action.kind === 'resolved') {
        return {
          charges: step.action.charges,
          creditActivity: step.action.creditActivity,
        }
      }
      return { error: `getHistoryNext unknown action kind`, status: 500 }
    }
  } catch (error) {
    return handleRouteError(error, 'Get history', 'Failed to load history')
  }
}
