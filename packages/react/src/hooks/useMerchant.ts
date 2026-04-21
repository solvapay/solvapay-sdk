import { useCallback, useEffect, useState } from 'react'
import { useSolvaPay } from './useSolvaPay'
import { createHttpTransport } from '../transport/http'
import { createTransportCacheKey } from '../transport/cache-key'
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
  return createTransportCacheKey(config, config?.api?.getMerchant || '/api/merchant')
}

async function fetchMerchant(config: SolvaPayConfig | undefined): Promise<Merchant | null> {
  const transport = config?.transport ?? createHttpTransport(config)
  // MCP adapters omit `getMerchant` — the data arrives on `BootstrapPayload`
  // and `seedMcpCaches` populates `merchantCache` before the hook mounts.
  // Returning null here lets the hook fall back to whatever the cache
  // already holds (seeded value) without flagging an error.
  if (!transport.getMerchant) return null
  return transport.getMerchant()
}

/**
 * Hook to load merchant identity (legal name, support email, terms/privacy
 * URLs, ...) for rendering mandate copy and trust signals.
 *
 * Uses a module-level single-flight cache keyed by the configured transport
 * (or HTTP route when no transport is provided) so concurrent consumers
 * share one in-flight request and response.
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        merchantCache.set(key, { merchant: null, promise: promise as Promise<Merchant>, timestamp: now })
        const m = await promise
        // Transports without `getMerchant` (MCP adapter) return null;
        // leave the previously-seeded cache untouched in that case.
        if (m === null) {
          setLoading(false)
          return
        }
        merchantCache.set(key, { merchant: m, promise: null, timestamp: now })
        setMerchant(m)
      } catch (err) {
        merchantCache.delete(key)
        // The HTTP transport already invokes `config.onError` before throwing; custom
        // transports own their own error callbacks. Re-emitting here would double-fire.
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
