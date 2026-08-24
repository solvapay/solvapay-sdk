'use client'

/**
 * `useUsage()` — projection of the authenticated customer's usage snapshot
 * for the active purchase.
 *
 * Two sources feed the snapshot, because no single one carries the whole
 * picture:
 *
 *  - **Consumption** (`used`, period window) comes off `usePurchase()`.
 *    Metered plans expose `planSnapshot.isMetered` and a `usage` field.
 *  - **Cap** (`total`, `remaining`, `meterRef`, unlimited) comes from
 *    `useLimits()`, the backend-authoritative allowance the paywall gate
 *    consults on every request. The plan snapshot dropped `limit`,
 *    `meterRef`, and `creditsPerUnit` from the wire, so there is nothing
 *    left to derive them from client-side — and guessing would report
 *    every metered plan, including credit-gated pay-as-you-go, as
 *    uncapped.
 *
 * `useLimits` shares a module-level cache keyed by
 * `customerRef:productRef:meterName`, so mounting several usage surfaces
 * costs one request. It is skipped entirely for non-metered plans.
 *
 * Returns `null` values when the active plan isn't metered.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePurchase } from './usePurchase'
import { useTransport } from './useTransport'
import { useLimits } from './useLimits'
import type { PurchaseInfo } from '../types'

export interface UseUsageReturn {
  /** Raw usage snapshot (`null` when no usage-based plan is active). */
  usage: UsageSnapshot | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
  /** 0-100, rounded to 2dp. `null` when total is unknown (unlimited/empty). */
  percentUsed: number | null
  /** Plan is usage-based, `percentUsed >= 80`. */
  isApproachingLimit: boolean
  /** Plan is usage-based, `percentUsed >= 100`. */
  isAtLimit: boolean
  /**
   * True when the backend reports no finite cap on this meter. Sourced
   * from `useLimits().unlimited`, never inferred from a missing `total`
   * — an unknown cap is not an absent one.
   */
  isUnlimited: boolean
  /** The meter reference (e.g. `'tokens'`). `null` when not usage-based. */
  meterRef: string | null
}

export interface UsageSnapshot {
  meterRef: string | null
  total: number | null
  used: number
  remaining: number | null
  percentUsed: number | null
  periodStart?: string
  periodEnd?: string
  purchaseRef?: string
}

/** Cap side of the snapshot, projected from `useLimits`. */
interface LimitsProjection {
  remaining: number | null
  unlimited: boolean | null
  meterName: string | null
}

function deriveUsage(
  purchase: PurchaseInfo | null,
  limits: LimitsProjection,
): UsageSnapshot | null {
  if (!purchase) return null
  const usage = purchase.usage
  if (purchase.planSnapshot?.isMetered !== true && !usage) return null
  const used = typeof usage?.used === 'number' ? usage.used : 0
  // `remaining` carries the backend's `-1` unlimited sentinel, which
  // `unlimited` already decodes — only a confirmed finite cap produces a
  // total. While limits are loading (or the transport has no `getLimits`)
  // both stay `null`: cap unknown, not cap absent.
  const hasFiniteCap = limits.unlimited === false && limits.remaining !== null
  const remaining = hasFiniteCap ? limits.remaining : null
  const total = remaining === null ? null : used + remaining
  const percentUsed =
    total !== null && total > 0 ? Math.min(100, Math.round((used / total) * 10000) / 100) : null
  return {
    meterRef: limits.meterName,
    total,
    used,
    remaining,
    percentUsed,
    ...(usage?.periodStart ? { periodStart: usage.periodStart } : {}),
    ...(usage?.periodEnd ? { periodEnd: usage.periodEnd } : {}),
    purchaseRef: purchase.reference,
  }
}

export function useUsage(): UseUsageReturn {
  const { activePurchase, refetch: refetchPurchase, loading: purchaseLoading } = usePurchase()
  const transport = useTransport()

  const [override, setOverride] = useState<UsageSnapshot | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [transportLoading, setTransportLoading] = useState(false)

  // Only metered plans have an allowance to look up; everything else
  // would spend a request to learn nothing.
  const isMetered = activePurchase?.planSnapshot?.isMetered === true
  const {
    remaining: limitRemaining,
    unlimited,
    meterName,
  } = useLimits({
    productRef: activePurchase?.productRef,
    enabled: isMetered,
  })

  const derived = useMemo(
    () => deriveUsage(activePurchase ?? null, { remaining: limitRemaining, unlimited, meterName }),
    [activePurchase, limitRemaining, unlimited, meterName],
  )

  // Clear transport-fetched override when the active purchase changes
  // — otherwise a stale override from a previous plan keeps shadowing
  // the fresh `derived` snapshot (`usage = override ?? derived`).
  const activePurchaseRef = activePurchase?.reference ?? null
  useEffect(() => {
    setOverride(null)
  }, [activePurchaseRef])

  const usage = override ?? derived

  const refetch = useCallback(async () => {
    setError(null)
    // Prefer the standalone tool / endpoint when the transport exposes it;
    // falls back to a plain purchase refetch so the usage derived from
    // `checkPurchase` stays fresh.
    if (typeof transport.getUsage === 'function') {
      setTransportLoading(true)
      try {
        const next = await transport.getUsage()
        setOverride(next)
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load usage'))
      } finally {
        setTransportLoading(false)
      }
      return
    }
    try {
      await refetchPurchase()
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to refetch purchase'))
    }
  }, [transport, refetchPurchase])

  const percentUsed = usage?.percentUsed ?? null
  const isApproachingLimit = percentUsed !== null && percentUsed >= 80 && percentUsed < 100
  const isAtLimit = percentUsed !== null && percentUsed >= 100
  const isUnlimited = usage !== null && unlimited === true

  return {
    usage,
    loading: purchaseLoading || transportLoading,
    error,
    refetch,
    percentUsed,
    isApproachingLimit,
    isAtLimit,
    isUnlimited,
    meterRef: usage?.meterRef ?? null,
  }
}

// Re-export from @solvapay/server so consumers importing this hook get the
// canonical type without bundling the whole server type catalogue.
export type { GetUsageResult } from '@solvapay/server'
