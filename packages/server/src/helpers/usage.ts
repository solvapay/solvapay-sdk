import type { SolvaPay } from '../factory'
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
 * Derives the values from `checkPurchaseCore` — no extra backend call.
 * Returns `null` values when no usage-based plan is active.
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

  const snap = activePurchase.planSnapshot as
    | { meterRef?: string; meterId?: string; limit?: number; freeUnits?: number }
    | undefined
  const usage = activePurchase.usage as
    | { used?: number; periodStart?: string; periodEnd?: string }
    | undefined

  const meterRef = snap?.meterRef ?? snap?.meterId ?? null
  const total = typeof snap?.limit === 'number' ? snap.limit : null
  const used = typeof usage?.used === 'number' ? usage.used : 0
  const remaining = total !== null ? Math.max(0, total - used) : null
  const percentUsed =
    total !== null && total > 0 ? Math.min(100, Math.round((used / total) * 10000) / 100) : null

  return {
    meterRef,
    total,
    used,
    remaining,
    percentUsed,
    ...(usage?.periodStart ? { periodStart: usage.periodStart } : {}),
    ...(usage?.periodEnd ? { periodEnd: usage.periodEnd } : {}),
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
  },
  options: {
    solvaPay?: SolvaPay
  } = {},
): Promise<{ success: true } | ErrorResult> {
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

    await solvaPay.trackUsage({
      customerRef,
      actionType: body.actionType,
      units: body.units,
      productRef: body.productRef,
      description: body.description,
      metadata: body.metadata,
    })

    return { success: true }
  } catch (error) {
    return handleRouteError(error, 'Track usage', 'Track usage failed')
  }
}
