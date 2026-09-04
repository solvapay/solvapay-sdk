import { countsUsage, projectUsageSnapshot } from '../native-decisions'
import { trackUsageWithRetry } from '../track-usage-retry'
import type { SolvaPay } from '../factory'
import type { TrackUsageResponse } from '../types'
import type { ErrorResult } from './types'
import { createSolvaPay } from '../factory'
import { handleRouteError, isErrorResult } from './error'
import { getAuthenticatedUserCore } from './auth'
import { checkPurchaseCore } from './purchase'

/**
 * Usage snapshot derived from the authenticated customer's active purchase.
 *
 * Shape matches the backend's `UserInfoUsageDto` so the React `useUsage`
 * hook gets a canonical set of fields regardless of transport.
 */
export interface GetUsageResult {
  meterRef: string | null
  total: number | null
  used: number
  remaining: number | null
  /** 0–100, rounded to 2dp. `null` when `total` is unknown. */
  percentUsed: number | null
  periodStart?: string
  periodEnd?: string
  /** Raw purchase ref the usage belongs to (when a usage-based plan is active). */
  purchaseRef?: string
}

/**
 * Fetch the authenticated customer's usage snapshot for the active purchase.
 *
 * Consumption (`used`, period window) comes from `checkPurchaseCore`. The cap
 * (`total`, `remaining`, `meterRef`) comes from `checkLimits` — the plan
 * snapshot no longer carries `limit` or `meterRef` on the wire, so a metered
 * plan costs one extra backend call. Non-metered plans skip it.
 *
 * Returns `null` values when no metered plan is active.
 */
export async function getUsageCore(
  request: Request,
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<GetUsageResult | ErrorResult> {
  const purchaseResult = await checkPurchaseCore(request, options)
  if (isErrorResult(purchaseResult)) return purchaseResult

  const activePurchase = (purchaseResult.purchases ?? []).find(p => p.status === 'active')
  if (!activePurchase) {
    return projectUsageSnapshot(null, null)
  }

  const snapshot = activePurchase.planSnapshot
  const usageCounted =
    countsUsage(snapshot) ||
    (typeof snapshot === 'object' &&
      snapshot !== null &&
      'isMetered' in snapshot &&
      snapshot.isMetered === true)
  const productRef = activePurchase.productRef
  if (!usageCounted || typeof productRef !== 'string' || productRef.length === 0) {
    return projectUsageSnapshot(activePurchase, null)
  }

  const solvaPay = options.solvaPay || createSolvaPay()
  const limits = await solvaPay.apiClient.checkLimits({
    customerRef: purchaseResult.customerRef,
    productRef,
  })
  return projectUsageSnapshot(activePurchase, limits)
}

export async function trackUsageCore(
  request: Request,
  body: {
    actionType?: 'transaction' | 'api_call' | 'hour' | 'email' | 'storage' | 'custom'
    units?: number
    productRef?: string
    description?: string
    metadata?: Record<string, unknown>
    idempotencyKey?: string
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<TrackUsageResponse | ErrorResult> {
  try {
    const userResult = await getAuthenticatedUserCore(request)

    if (isErrorResult(userResult)) {
      return userResult
    }

    const { userId, email, name } = userResult
    const solvaPay = options.solvaPay || createSolvaPay()

    const customerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    })

    const result = await trackUsageWithRetry(params => solvaPay.trackUsage(params), {
      customerRef,
      actionType: body.actionType,
      units: body.units,
      productRef: body.productRef,
      description: body.description,
      metadata: body.metadata,
      idempotencyKey: body.idempotencyKey,
    })

    return result
  } catch (error) {
    return handleRouteError(error, 'Track usage', 'Track usage failed')
  }
}
