import { useCallback, useEffect, useState } from 'react'
import { useSolvaPay } from './useSolvaPay'
import { buildRequestHeaders } from '../utils/headers'
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

function routeFor(config: SolvaPayConfig | undefined): string {
  return config?.api?.getProduct || '/api/get-product'
}

async function fetchProduct(
  productRef: string,
  config: SolvaPayConfig | undefined,
): Promise<Product> {
  const base = routeFor(config)
  const url = `${base}?productRef=${encodeURIComponent(productRef)}`
  const fetchFn = config?.fetch || fetch
  const { headers } = await buildRequestHeaders(config)

  const res = await fetchFn(url, { method: 'GET', headers })
  if (!res.ok) {
    const error = new Error(`Failed to fetch product: ${res.statusText || res.status}`)
    config?.onError?.(error, 'getProduct')
    throw error
  }
  return (await res.json()) as Product
}

/**
 * Hook to load a single product by reference. Uses a module-level
 * single-flight cache keyed by `productRef` so concurrent consumers share the
 * same in-flight request.
 */
export function useProduct(productRef: string | undefined): UseProductReturn {
  const { _config } = useSolvaPay()

  const cacheKey = productRef || ''

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

      const cached = productCache.get(productRef)
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
        productCache.set(productRef, { product: null, promise, timestamp: now })
        const p = await promise
        productCache.set(productRef, { product: p, promise: null, timestamp: now })
        setProduct(p)
      } catch (err) {
        productCache.delete(productRef)
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
