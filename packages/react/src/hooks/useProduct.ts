import { useCallback, useEffect, useState } from 'react'
import { useSolvaPay } from './useSolvaPay'
import { createHttpTransport } from '../transport/http'
import { createTransportCacheKey } from '../transport/cache-key'
import type { Product, SolvaPayConfig, UseProductReturn } from '../types'

type CacheEntry = {
  product: Product | null
  promise: Promise<Product> | null
  timestamp: number
}

const productCache = new Map<string, CacheEntry>()
const CACHE_DURATION = 5 * 60 * 1000

/** @internal Exported only for tests */
export { productCache, CACHE_DURATION }

function cacheKeyFor(config: SolvaPayConfig | undefined, productRef: string): string {
  // With a custom transport: `transport:<id>:<productRef>`.
  // Without: the raw `productRef` (preserves legacy behavior — no HTTP route
  // component in the key, since useProduct already scopes by productRef).
  return createTransportCacheKey(config, productRef, productRef)
}

async function fetchProduct(
  productRef: string,
  config: SolvaPayConfig | undefined,
): Promise<Product> {
  const transport = config?.transport ?? createHttpTransport(config)
  return transport.getProduct(productRef)
}

/**
 * Hook to load a single product by reference. Uses a module-level
 * single-flight cache keyed by `productRef` (and transport identity) so
 * concurrent consumers share the same in-flight request.
 */
export function useProduct(productRef: string | undefined): UseProductReturn {
  const { _config } = useSolvaPay()

  const cacheKey = productRef ? cacheKeyFor(_config, productRef) : ''

  const [product, setProduct] = useState<Product | null>(
    () => (productRef ? (productCache.get(cacheKey)?.product ?? null) : null),
  )
  const [loading, setLoading] = useState(() => {
    if (!productRef) return false
    const cached = productCache.get(cacheKey)
    return !cached || (!cached.product && !cached.promise)
  })
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(
    async (force = false) => {
      if (!productRef) {
        setProduct(null)
        setLoading(false)
        setError(null)
        return
      }

      const key = cacheKeyFor(_config, productRef)
      const cached = productCache.get(key)
      const now = Date.now()

      if (!force && cached?.product && now - cached.timestamp < CACHE_DURATION) {
        setProduct(cached.product)
        setLoading(false)
        setError(null)
        return
      }

      if (!force && cached?.promise) {
        try {
          setLoading(true)
          const p = await cached.promise
          setProduct(p)
          setError(null)
        } catch (err) {
          setError(err instanceof Error ? err : new Error('Failed to load product'))
        } finally {
          setLoading(false)
        }
        return
      }

      try {
        setLoading(true)
        setError(null)
        const promise = fetchProduct(productRef, _config)
        productCache.set(key, { product: null, promise, timestamp: now })
        const p = await promise
        productCache.set(key, { product: p, promise: null, timestamp: now })
        setProduct(p)
      } catch (err) {
        productCache.delete(key)
        // The HTTP transport already invokes `config.onError` before throwing; custom
        // transports own their own error callbacks. Re-emitting here would double-fire.
        setError(err instanceof Error ? err : new Error('Failed to load product'))
      } finally {
        setLoading(false)
      }
    },
    [productRef, _config],
  )

  useEffect(() => {
    load()
  }, [load])

  return {
    product,
    loading,
    error,
    refetch: () => load(true),
  }
}
