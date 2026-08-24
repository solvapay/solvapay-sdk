'use client'

/**
 * `useUsage()` — projection of the authenticated customer's usage snapshot
 * for the active purchase.
 *
 * Reads directly off `usePurchase()` so no additional network call is made
 * when `checkPurchase` is already loaded. Metered plans expose
 * `planSnapshot.isMetered` and a `usage` field (`used` + period). Cap /
 * remaining live on `useLimits` — this hook does not invent `limit`,
 * `meterRef`, or `creditsPerUnit` from the snapshot (those fields are
 * no longer on the wire).
 *
 * Returns `null` values when the active plan isn't metered.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePurchase } from './usePurchase'
import { useTransport } from './useTransport'
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
  /** True when `usage.total === null` (no included cap on this plan). */
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

function deriveUsage(purchase: PurchaseInfo | null): UsageSnapshot | null {
  if (!purchase) return null
  const usage = purchase.usage
  if (purchase.planSnapshot?.isMetered !== true && !usage) return null
  const used = typeof usage?.used === 'number' ? usage.used : 0
  return {
    meterRef: null,
    total: null,
    used,
    remaining: null,
    percentUsed: null,
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

  const derived = useMemo(() => deriveUsage(activePurchase ?? null), [activePurchase])

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
  const isUnlimited = usage !== null && usage.total === null

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
