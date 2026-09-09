/**
 * One ordered selector for "which plan purchase is active" so narration,
 * bootstrap usage, and the default-view heuristic cannot disagree.
 *
 * Filter: `status === 'active'`, current `productRef` when given, not a
 * credit top-up. Newest `startDate` wins; paid-over-free is only a
 * same-timestamp tiebreak so this matches the console's `createdAt: -1`.
 */

export type ActivePlanPurchaseLike = {
  status?: string
  productRef?: string
  planSnapshot?: unknown
  amount?: number
  startDate?: string
  metadata?: { purpose?: string }
}

export function isPlanPurchase(purchase: ActivePlanPurchaseLike): boolean {
  return !!purchase.planSnapshot && purchase.metadata?.purpose !== 'credit_topup'
}

function startTime(purchase: ActivePlanPurchaseLike): number {
  if (!purchase.startDate) return 0
  const time = new Date(purchase.startDate).getTime()
  return Number.isNaN(time) ? 0 : time
}

function isPaid(purchase: ActivePlanPurchaseLike): boolean {
  return (purchase.amount ?? 0) > 0
}

/**
 * Pick the customer's current plan purchase, or `null` if none match.
 */
export function selectActivePlanPurchase<T extends ActivePlanPurchaseLike>(
  purchases: T[] | undefined,
  productRef?: string,
): T | null {
  const candidates = (purchases ?? []).filter(purchase => {
    if (purchase.status && purchase.status !== 'active') return false
    if (!isPlanPurchase(purchase)) return false
    if (productRef && purchase.productRef !== productRef) {
      return false
    }
    return true
  })
  if (candidates.length === 0) return null

  const ranked = [...candidates].sort((a, b) => {
    const startDelta = startTime(b) - startTime(a)
    if (startDelta !== 0) return startDelta
    return Number(isPaid(b)) - Number(isPaid(a))
  })
  return ranked[0] ?? null
}
