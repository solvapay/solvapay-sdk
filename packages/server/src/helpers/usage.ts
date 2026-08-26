import { countsUsage } from '@solvapay/core'
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
    return {
      meterRef: null,
      total: null,
      used: 0,
      remaining: null,
      percentUsed: null,
    }
  }

  const usage = activePurchase.usage
  const used = typeof usage?.used === 'number' ? usage.used : 0
  const period = {
    ...(usage?.periodStart ? { periodStart: usage.periodStart } : {}),
    ...(usage?.periodEnd ? { periodEnd: usage.periodEnd } : {}),
  }

  const usageCounted =
    countsUsage(activePurchase.planSnapshot) || activePurchase.planSnapshot?.isMetered === true
  if (!usageCounted || !activePurchase.productRef) {
    return {
      meterRef: null,
      total: null,
      used,
      remaining: null,
      percentUsed: null,
      ...period,
      purchaseRef: activePurchase.reference,
    }
  }

  const solvaPay = options.solvaPay || createSolvaPay()
  const limits = await solvaPay.apiClient.checkLimits({
    customerRef: purchaseResult.customerRef,
    productRef: activePurchase.productRef,
  })

  // `remaining: -1` is the backend's "no finite cap" sentinel — any
  // negative value means uncapped, never a real count. An uncapped meter
  // has no total to report, so `percentUsed` stays null rather than
  // fabricating a denominator.
  const hasFiniteCap = limits.remaining >= 0
  const remaining = hasFiniteCap ? limits.remaining : null
  const total = remaining === null ? null : used + remaining
  const percentUsed =
    total !== null && total > 0 ? Math.min(100, Math.round((used / total) * 10000) / 100) : null

  return {
    meterRef: limits.meterName ?? null,
    total,
    used,
    remaining,
    percentUsed,
    ...period,
    purchaseRef: activePurchase.reference,
  }
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

    const result = await solvaPay.trackUsage({
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
