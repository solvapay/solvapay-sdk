import { useCallback, useEffect, useState } from 'react'
import { useSolvaPay } from './useSolvaPay'
import { buildRequestHeaders } from '../utils/headers'
import type { Merchant, SolvaPayConfig, UseMerchantReturn } from '../types'

type CacheEntry = {
  merchant: Merchant | null
  promise: Promise<Merchant> | null
  timestamp: number
}

const merchantCache = new Map<string, CacheEntry>()
const CACHE_DURATION = 5 * 60 * 1000

/** @internal Exported only for tests — do not use in application code */
export { merchantCache, CACHE_DURATION }

function cacheKeyFor(config: SolvaPayConfig | undefined): string {
  return config?.api?.getMerchant || '/api/merchant'
}

async function fetchMerchant(config: SolvaPayConfig | undefined): Promise<Merchant> {
  const route = cacheKeyFor(config)
  const fetchFn = config?.fetch || fetch
  const { headers } = await buildRequestHeaders(config)

  const res = await fetchFn(route, { method: 'GET', headers })
  if (!res.ok) {
    const error = new Error(`Failed to fetch merchant: ${res.statusText || res.status}`)
    config?.onError?.(error, 'getMerchant')
    throw error
  }
  return (await res.json()) as Merchant
}

/**
 * Hook to load merchant identity (legal name, support email, terms/privacy
 * URLs, ...) for rendering mandate copy and trust signals.
 *
 * Uses a module-level single-flight cache keyed by the configured route so
 * concurrent consumers share one in-flight request and response.
 */
export function useMerchant(): UseMerchantReturn {
  const { _config } = useSolvaPay()
  const key = cacheKeyFor(_config)

  const [merchant, setMerchant] = useState<Merchant | null>(
    () => merchantCache.get(key)?.merchant ?? null,
  )
  const [loading, setLoading] = useState(() => {
    const cached = merchantCache.get(key)
    return !cached || (!cached.merchant && !cached.promise)
  })
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(
    async (force = false) => {
      const cached = merchantCache.get(key)
      const now = Date.now()

      if (!force && cached?.merchant && now - cached.timestamp < CACHE_DURATION) {
        setMerchant(cached.merchant)
        setLoading(false)
        setError(null)
        return
      }

      if (!force && cached?.promise) {
        try {
          setLoading(true)
          const m = await cached.promise
          setMerchant(m)
          setError(null)
        } catch (err) {
          setError(err instanceof Error ? err : new Error('Failed to load merchant'))
        } finally {
          setLoading(false)
        }
        return
      }

      try {
        setLoading(true)
        setError(null)
        const promise = fetchMerchant(_config)
        merchantCache.set(key, { merchant: null, promise, timestamp: now })
        const m = await promise
        merchantCache.set(key, { merchant: m, promise: null, timestamp: now })
        setMerchant(m)
      } catch (err) {
        merchantCache.delete(key)
        setError(err instanceof Error ? err : new Error('Failed to load merchant'))
      } finally {
        setLoading(false)
      }
    },
    [_config, key],
  )

  useEffect(() => {
    load()
  }, [load])

  return {
    merchant,
    loading,
    error,
    refetch: () => load(true),
  }
}
