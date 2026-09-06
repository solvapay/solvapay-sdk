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

export interface UsageLimitsInput {
  remaining: number
  meterName?: string | null
}

/**
 * Project a usage snapshot from consumption + a (possibly pre-fetched)
 * `LimitResponse`. Extracted so bootstrap can fetch limits once and feed
 * the same result into usage math — metered plans must not call
 * `checkLimits` a second time.
 *
 * `limits: null` means the cap is unknown (fetch failed or not
 * attempted), not that the meter is unlimited. Unlimited is only
 * `remaining === -1` on a real limits object.
 */
export function deriveUsageSnapshot(input: {
  used: number
  periodStart?: string
  periodEnd?: string
  purchaseRef?: string
  limits: UsageLimitsInput | null
}): GetUsageResult {
  const period = {
    ...(input.periodStart ? { periodStart: input.periodStart } : {}),
    ...(input.periodEnd ? { periodEnd: input.periodEnd } : {}),
  }
  const purchase = input.purchaseRef ? { purchaseRef: input.purchaseRef } : {}

  if (!input.limits) {
    return {
      meterRef: null,
      total: null,
      used: input.used,
      remaining: null,
      percentUsed: null,
      ...period,
      ...purchase,
    }
  }

  // `remaining: -1` is the backend's "no finite cap" sentinel — any
  // other negative is not treated as unlimited (that would hide a
  // backend bug behind a silent "no cap" reading).
  const hasFiniteCap = input.limits.remaining >= 0
  const remaining = hasFiniteCap ? input.limits.remaining : null
  const total = remaining === null ? null : input.used + remaining
  const percentUsed =
    total !== null && total > 0
      ? Math.min(100, Math.round((input.used / total) * 10000) / 100)
      : null

  return {
    meterRef: input.limits.meterName ?? null,
    total,
    used: input.used,
    remaining,
    percentUsed,
    ...period,
    ...purchase,
  }
}

/**
 * Fetch the authenticated customer's usage snapshot for the active purchase.
 *
 * Consumption (`used`, period window) comes from `checkPurchaseCore`. The cap
 * (`total`, `remaining`, `meterRef`) comes from `checkLimits` — the plan
 * snapshot no longer carries `limit` or `meterRef` on the wire, so a metered
 * plan costs one extra backend call unless the caller already has a
 * `LimitResponse` (`options.limits`).
 *
 * Pass `limits` (including `null` for a failed fetch) to skip the
 * `checkLimits` call. Non-metered plans still skip it when `limits` is
 * omitted.
 *
 * Returns `null` values when no metered plan is active and no limits
 * were supplied.
 */
export async function getUsageCore(
  request: Request,
  options: {
    solvaPay?: SolvaPay
    limits?: UsageLimitsInput | null
  } = {},
): Promise<GetUsageResult | ErrorResult> {
  const purchaseResult = await checkPurchaseCore(request, options)
  if (isErrorResult(purchaseResult)) return purchaseResult

  const activePurchase = (purchaseResult.purchases ?? []).find(p => p.status === 'active')
  if (!activePurchase) {
    return deriveUsageSnapshot({ used: 0, limits: options.limits ?? null })
  }

  const usage = activePurchase.usage
  const used = typeof usage?.used === 'number' ? usage.used : 0
  const period = {
    periodStart: usage?.periodStart,
    periodEnd: usage?.periodEnd,
    purchaseRef: activePurchase.reference,
  }

  if ('limits' in options) {
    return deriveUsageSnapshot({ used, ...period, limits: options.limits ?? null })
  }

  const usageCounted =
    countsUsage(activePurchase.planSnapshot) || activePurchase.planSnapshot?.isMetered === true
  if (!usageCounted || !activePurchase.productRef) {
    return deriveUsageSnapshot({ used, ...period, limits: null })
  }

  const solvaPay = options.solvaPay || createSolvaPay()
  const limits = await solvaPay.apiClient.checkLimits({
    customerRef: purchaseResult.customerRef,
    productRef: activePurchase.productRef,
  })

  return deriveUsageSnapshot({ used, ...period, limits })
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
