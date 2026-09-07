'use client'

/**
 * `useHistory` — product charges plus account-wide credit activity.
 *
 * Not seeded from bootstrap: `checkPurchaseCore` filters to active
 * purchases, so history has no cache until the history section mounts.
 * Pass `enabled: false` (or omit `productRef`) to skip the fetch.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CreditActivityResult, GetHistoryResult, PurchaseInfo } from '@solvapay/server'
import { useCustomer } from './useCustomer'
import { useTransport } from './useTransport'

const CACHE_TTL_MS = 10_000

interface CacheEntry {
  data: GetHistoryResult | null
  timestamp: number
  promise: Promise<GetHistoryResult> | null
}

const historyCache = new Map<string, CacheEntry>()

/** @internal Exported only for tests. */
export { historyCache, CACHE_TTL_MS }

function cacheKey(
  customerRef: string | undefined,
  productRef: string,
  limit: number | undefined,
): string {
  return `${customerRef ?? 'anonymous'}:${productRef}:${limit ?? ''}`
}

export interface UseHistoryOptions {
  productRef?: string
  limit?: number
  /** Skip the network fetch until the history section mounts. */
  enabled?: boolean
}

export interface UseHistoryReturn {
  charges: PurchaseInfo[] | null
  creditActivity: CreditActivityResult | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useHistory(options: UseHistoryOptions = {}): UseHistoryReturn {
  const { productRef, limit, enabled = true } = options
  const { customerRef } = useCustomer()
  const transport = useTransport()
  const shouldFetch = enabled && Boolean(productRef) && Boolean(transport.getHistory)
  const key = productRef ? cacheKey(customerRef, productRef, limit) : ''

  const [data, setData] = useState<GetHistoryResult | null>(
    () => (key ? historyCache.get(key)?.data ?? null : null),
  )
  const [loading, setLoading] = useState(() => {
    if (!shouldFetch || !key) return false
    const cached = historyCache.get(key)
    return !cached?.data
  })
  const [error, setError] = useState<Error | null>(null)
  const requestSeq = useRef(0)

  const load = useCallback(
    async (force = false) => {
      if (!shouldFetch || !productRef || !transport.getHistory) {
        setLoading(false)
        return
      }

      const seq = requestSeq.current
      const cached = historyCache.get(key)
      const now = Date.now()

      if (!force && cached?.data && now - cached.timestamp < CACHE_TTL_MS) {
        if (seq !== requestSeq.current) return
        setData(cached.data)
        setLoading(false)
        setError(null)
        return
      }

      if (!force && cached?.promise) {
        setLoading(true)
        try {
          const value = await cached.promise
          if (seq !== requestSeq.current) return
          setData(value)
          setError(null)
        } catch (caught) {
          if (seq !== requestSeq.current) return
          setError(caught instanceof Error ? caught : new Error(String(caught)))
        } finally {
          if (seq === requestSeq.current) setLoading(false)
        }
        return
      }

      setLoading(true)
      setError(null)
      const promise = transport.getHistory({
        productRef,
        ...(limit !== undefined ? { limit } : {}),
      })
      historyCache.set(key, {
        data: cached?.data ?? null,
        promise,
        timestamp: now,
      })

      try {
        const value = await promise
        if (seq !== requestSeq.current) return
        historyCache.set(key, { data: value, promise: null, timestamp: Date.now() })
        setData(value)
      } catch (caught) {
        if (seq !== requestSeq.current) return
        const err = caught instanceof Error ? caught : new Error(String(caught))
        historyCache.set(key, {
          data: cached?.data ?? null,
          promise: null,
          timestamp: Date.now(),
        })
        setError(err)
      } finally {
        if (seq === requestSeq.current) setLoading(false)
      }
    },
    [key, limit, productRef, shouldFetch, transport],
  )

  useEffect(() => {
    if (!shouldFetch) {
      setLoading(false)
      return
    }
    void load()
  }, [load, shouldFetch])

  const refetch = useCallback(async () => {
    requestSeq.current += 1
    await load(true)
  }, [load])

  return {
    charges: data?.charges ?? null,
    creditActivity: data?.creditActivity ?? null,
    loading,
    error,
    refetch,
  }
}
