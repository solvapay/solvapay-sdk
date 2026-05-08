'use client'

/**
 * `useLimits` — backend-authoritative runtime allowance for a (product, meter)
 * pair.
 *
 * Surfaces the same `LimitResponse` data `paywall.decide()` consults
 * internally on every gated request, so React UIs can render an honest
 * "X left" pill without reinventing the math client-side. Replaces the
 * common pattern of `floor(useBalance().credits / plan.creditsPerUnit)` for
 * usage-based plans, AND the local `messageLimit - userMessageCount` ref
 * counter for free-tier products — one source of truth for both.
 *
 * Routes through the SDK transport layer (HTTP by default,
 * `transport.getLimits` when overridden). When the transport doesn't
 * implement `getLimits` (e.g. an MCP adapter without the route), the hook
 * returns `null` for `remaining` / `withinLimits` with `loading: false` —
 * matches `useUsage`'s graceful fallback.
 *
 * Cache: module-level, keyed by `customerRef:productRef:meterName` with a
 * 10 s TTL that mirrors the backend paywall's `limitsCacheTTL`. Multiple
 * components reading the same triple share one fetch in-flight.
 *
 * @since 1.3.0
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTransport } from './useTransport'
import { useCustomer } from './useCustomer'
import type { TransportLimitsResult } from '../transport/types'

const CACHE_TTL_MS = 10_000

const OPTIMISTIC_GRACE_MS = 8000

interface CacheEntry {
  /**
   * `null` while the very first fetch is in flight for this key — the
   * slot exists so concurrent callers can coalesce on the same
   * `promise`. Subsequent fetches against a populated entry preserve
   * the previous value here so consumers keep seeing the old number
   * during a forced refetch instead of flashing to a skeleton.
   */
  data: TransportLimitsResult | null
  timestamp: number
  /** In-flight fetch promise, if any. Subsequent callers await this. */
  promise: Promise<TransportLimitsResult> | null
}

const limitsCache = new Map<string, CacheEntry>()

/** @internal Exported only for tests — do not use in application code */
export { limitsCache, CACHE_TTL_MS, OPTIMISTIC_GRACE_MS }

function cacheKey(
  customerRef: string | undefined,
  productRef: string,
  meterName: string,
): string {
  return `${customerRef ?? 'anonymous'}:${productRef}:${meterName}`
}

export interface UseLimitsOptions {
  productRef: string | undefined
  /** Defaults to `'requests'` (mirrors the backend default). */
  meterName?: string
  /** Skip the network fetch (useful for SSR / disabled states). */
  enabled?: boolean
}

export interface UseLimitsReturn {
  /** Pre-request allowance the customer has on this meter. `null` while loading or when disabled. */
  remaining: number | null
  /**
   * False when the customer would be gated by the next request. `null` while loading.
   * Usually tracks `remaining > 0`, but the backend can gate independently
   * (e.g. `activationRequired`) — always trust this field over a local
   * `remaining > 0` check.
   */
  withinLimits: boolean | null
  /** Resolved meter name (echoed by the backend). */
  meterName: string | null
  /**
   * Mirrors `TransportLimitsResult.activationRequired`. When `true`, the
   * customer has zero entitlement until a plan is activated — typically
   * the product's free plan. Pair with `useActivation` to flip the
   * customer onto the free tier; consumers that don't auto-activate
   * should treat `true` as "needs the activation flow", not "exhausted".
   */
  activationRequired: boolean | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
  /**
   * Optimistically nudge `remaining` by `delta` (typically `-1` after a
   * successful gated action). Mirrors `useBalance().adjustBalance` —
   * applies an 8 s grace window, then automatically refetches to converge
   * on the authoritative value. Use after a chat send / tool call so the
   * pill reacts instantly without waiting for the next refetch.
   */
  adjustRemaining: (delta: number) => void
}

export function useLimits(options: UseLimitsOptions): UseLimitsReturn {
  const { productRef, meterName: rawMeterName, enabled = true } = options
  const meterName = rawMeterName || 'requests'

  const transport = useTransport()
  const { customerRef } = useCustomer()

  // Current cache key for this render — `null` when the hook is
  // disabled or `productRef` is missing. Used both for the in-render
  // key-change detector below and as a synchronous source of truth in
  // the lazy initialisers for `data` and `loading`.
  const currentKey =
    !productRef || !enabled ? null : cacheKey(customerRef, productRef, meterName)

  const [data, setData] = useState<TransportLimitsResult | null>(() => {
    if (!currentKey) return null
    const cached = limitsCache.get(currentKey)
    if (!cached || Date.now() - cached.timestamp >= CACHE_TTL_MS) return null
    return cached.data
  })
  const [loading, setLoading] = useState(() => {
    if (!currentKey) return false
    const cached = limitsCache.get(currentKey)
    if (!cached) return true
    if (cached.promise) return true
    if (Date.now() - cached.timestamp >= CACHE_TTL_MS) return true
    return false
  })
  const [error, setError] = useState<Error | null>(null)

  // Re-arm `data` synchronously on a key change instead of waiting for
  // a `useEffect` pass. This is the React-idiomatic "store previous
  // prop in state and reconcile during render" pattern — see
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders.
  // Forced refetches against the same key skip this branch and keep
  // the existing value visible during the network round-trip.
  const [trackedKey, setTrackedKey] = useState(currentKey)
  if (trackedKey !== currentKey) {
    setTrackedKey(currentKey)
    setData(null)
  }

  // Track the optimistic-update timer so back-to-back adjusts share a
  // single trailing refetch (matches `adjustBalance`'s behaviour).
  const optimisticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (optimisticTimerRef.current) clearTimeout(optimisticTimerRef.current)
    }
  }, [])

  // Shared await-and-reconcile machinery for both the in-flight and
  // fresh-fetch branches of `fetchLimits`. Returns the resolved value
  // (so the caller can persist it to cache) or `null` on error.
  const attachToFetch = useCallback(
    async (
      promise: Promise<TransportLimitsResult>,
    ): Promise<TransportLimitsResult | null> => {
      setLoading(true)
      try {
        const fresh = await promise
        setData(fresh)
        setError(null)
        return fresh
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch limits'))
        return null
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const fetchLimits = useCallback(
    async (force: boolean): Promise<void> => {
      if (!productRef || !enabled || !transport.getLimits) {
        // Graceful fallback when the transport doesn't implement
        // `getLimits` — clear loading without surfacing an error so
        // consumers can feature-detect by checking `remaining === null`.
        setLoading(false)
        return
      }

      const key = cacheKey(customerRef, productRef, meterName)
      const cached = limitsCache.get(key)
      const now = Date.now()

      // Coalesce: another mount has a fetch in flight for this key.
      // Must check before the fresh-cache branch because an in-flight
      // entry can carry a fresh timestamp with `data: null`.
      if (cached?.promise) {
        await attachToFetch(cached.promise)
        return
      }

      // Serve fresh cache.
      if (!force && cached?.data && now - cached.timestamp < CACHE_TTL_MS) {
        setData(cached.data)
        setLoading(false)
        setError(null)
        return
      }

      // Kick a fresh fetch. Seed the slot with the previous `data`
      // (preserved across forced refetches) so concurrent mounts that
      // arrive before this one resolves can still surface a value
      // instead of falling through to the in-flight branch with
      // nothing to show.
      const promise = transport.getLimits({ productRef, meterName })
      limitsCache.set(key, { data: cached?.data ?? null, timestamp: now, promise })
      const fresh = await attachToFetch(promise)
      if (fresh !== null) {
        limitsCache.set(key, { data: fresh, timestamp: Date.now(), promise: null })
      } else {
        limitsCache.delete(key)
      }
    },
    [transport, customerRef, productRef, meterName, enabled, attachToFetch],
  )

  // Refetch whenever (customerRef, productRef, meterName, enabled) changes.
  useEffect(() => {
    fetchLimits(false)
  }, [fetchLimits])

  const refetch = useCallback(() => fetchLimits(true), [fetchLimits])

  const adjustRemaining = useCallback(
    (delta: number) => {
      if (!productRef || !enabled) return
      const key = cacheKey(customerRef, productRef, meterName)
      // Read the latest value via the setter callback so `data` falls
      // out of the dep array — keeps `adjustRemaining` referentially
      // stable across counter ticks (mirrors `adjustBalanceImpl`).
      setData(prev => {
        const cached = limitsCache.get(key)
        const baseline = prev ?? cached?.data ?? null
        if (!baseline) return prev
        const next: TransportLimitsResult = {
          ...baseline,
          remaining: Math.max(0, baseline.remaining + delta),
          // Don't optimistically flip `withinLimits` — paywall gating
          // can hinge on factors beyond `remaining > 0`
          // (activationRequired, etc.). Let the trailing refetch
          // confirm.
        }
        limitsCache.set(key, {
          data: next,
          timestamp: Date.now(),
          promise: cached?.promise ?? null,
        })
        return next
      })

      if (optimisticTimerRef.current) clearTimeout(optimisticTimerRef.current)
      optimisticTimerRef.current = setTimeout(() => {
        optimisticTimerRef.current = null
        fetchLimits(true).catch(() => {})
      }, OPTIMISTIC_GRACE_MS)
    },
    [customerRef, productRef, meterName, enabled, fetchLimits],
  )

  return {
    remaining: data?.remaining ?? null,
    withinLimits: data?.withinLimits ?? null,
    meterName: data?.meterName ?? null,
    activationRequired: data?.activationRequired ?? null,
    loading,
    error,
    refetch,
    adjustRemaining,
  }
}
