/**
 * Pure usage helper decision/normalization cores (Step 30).
 *
 * Auth and `checkPurchaseCore` stay in `@solvapay/server` helpers; this module
 * projects an active purchase (or none) into the usage snapshot shape.
 */

export type UsageSnapshot = {
  meterRef: string | null
  total: number | null
  used: number
  remaining: number | null
  /** 0–100, rounded to 2dp. `null` when `total` is unknown or zero. */
  percentUsed: number | null
  periodStart?: string
  periodEnd?: string
  /** Present whenever an active purchase exists. */
  purchaseRef?: string
}

export type UsageSnapshotPurchase = {
  reference?: string
  planSnapshot?: {
    meterRef?: string
    meterId?: string
    limit?: number
  } | null
  usage?: {
    used?: number
    periodStart?: string
    periodEnd?: string
  } | null
}

/**
 * Project an active purchase (or `null`/`undefined`) into `GetUsageResult`.
 */
export function projectUsageSnapshot(
  activePurchase: UsageSnapshotPurchase | null | undefined,
): UsageSnapshot {
  if (!activePurchase) {
    return {
      meterRef: null,
      total: null,
      used: 0,
      remaining: null,
      percentUsed: null,
    }
  }

  const snap = activePurchase.planSnapshot ?? undefined
  const usage = activePurchase.usage ?? undefined

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
