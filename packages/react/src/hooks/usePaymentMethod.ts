import { useCallback, useEffect, useState } from 'react'
import { useSolvaPay } from './useSolvaPay'
import { createHttpTransport } from '../transport/http'
import { createTransportCacheKey } from '../transport/cache-key'
import type { SolvaPayConfig, UsePaymentMethodReturn } from '../types'
import type { PaymentMethodInfo } from '@solvapay/server'

type CacheEntry = {
  paymentMethod: PaymentMethodInfo | null
  promise: Promise<PaymentMethodInfo> | null
  timestamp: number
}

const paymentMethodCache = new Map<string, CacheEntry>()
const CACHE_DURATION = 5 * 60 * 1000

/** @internal Exported only for tests — do not use in application code */
export { paymentMethodCache, CACHE_DURATION }

function cacheKeyFor(config: SolvaPayConfig | undefined): string {
  return createTransportCacheKey(
    config,
    config?.api?.getPaymentMethod || '/api/payment-method',
  )
}

async function fetchPaymentMethod(
  config: SolvaPayConfig | undefined,
): Promise<PaymentMethodInfo | null> {
  const transport = config?.transport ?? createHttpTransport(config)
  // MCP adapters omit `getPaymentMethod`; the value arrives on the
  // bootstrap and `seedMcpCaches` seeds `paymentMethodCache`.
  if (!transport.getPaymentMethod) return null
  return transport.getPaymentMethod()
}

/**
 * Hook that loads the customer's default payment method for rendering
 * under `<CurrentPlanCard>`. Mirrors `useMerchant`'s caching semantics:
 * module-level single-flight cache keyed by transport identity (or HTTP
 * route when no custom transport is provided).
 *
 * The hook **does not throw** on transport errors — it sets `error` and
 * keeps `paymentMethod: null` so the consuming component can hide the
 * payment-method line. This lets `<CurrentPlanCard>` degrade gracefully
 * when the backend endpoint isn't deployed yet or the MCP server doesn't
 * expose the `get_payment_method` tool.
 *
 * @example
 * ```tsx
 * const { paymentMethod, loading } = usePaymentMethod()
 *
 * if (loading) return null
 * if (!paymentMethod || paymentMethod.kind === 'none') return null
 *
 * return <span>{paymentMethod.brand} •••• {paymentMethod.last4}</span>
 * ```
 */
export function usePaymentMethod(): UsePaymentMethodReturn {
  const { _config } = useSolvaPay()
  const key = cacheKeyFor(_config)

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodInfo | null>(
    () => paymentMethodCache.get(key)?.paymentMethod ?? null,
  )
  const [loading, setLoading] = useState(() => {
    const cached = paymentMethodCache.get(key)
    return !cached || (!cached.paymentMethod && !cached.promise)
  })
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(
    async (force = false) => {
      const cached = paymentMethodCache.get(key)
      const now = Date.now()

      if (!force && cached?.paymentMethod && now - cached.timestamp < CACHE_DURATION) {
        setPaymentMethod(cached.paymentMethod)
        setLoading(false)
        setError(null)
        return
      }

      if (!force && cached?.promise) {
        try {
          setLoading(true)
          const pm = await cached.promise
          setPaymentMethod(pm)
          setError(null)
        } catch (err) {
          setError(err instanceof Error ? err : new Error('Failed to load payment method'))
        } finally {
          setLoading(false)
        }
        return
      }

      try {
        setLoading(true)
        setError(null)
        const promise = fetchPaymentMethod(_config)
        // Preserve the seeded payment method (if any) on the in-flight
        // entry so concurrent consumers render the cached value while
        // the fetch is in progress.
        paymentMethodCache.set(key, {
          paymentMethod: cached?.paymentMethod ?? null,
          promise: promise as Promise<PaymentMethodInfo>,
          timestamp: now,
        })
        const pm = await promise
        // Transports without `getPaymentMethod` (MCP adapter) return
        // null; restore the seeded entry so the TTL doesn't evict it.
        if (pm === null) {
          paymentMethodCache.set(key, {
            paymentMethod: cached?.paymentMethod ?? null,
            promise: null,
            timestamp: cached?.timestamp ?? now,
          })
          setPaymentMethod(cached?.paymentMethod ?? null)
          setLoading(false)
          return
        }
        paymentMethodCache.set(key, { paymentMethod: pm, promise: null, timestamp: now })
        setPaymentMethod(pm)
      } catch (err) {
        paymentMethodCache.delete(key)
        // The HTTP transport already invokes `config.onError` before throwing; custom
        // transports own their own error callbacks. Re-emitting here would double-fire.
        setError(err instanceof Error ? err : new Error('Failed to load payment method'))
        setPaymentMethod(null)
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
    paymentMethod,
    loading,
    error,
    refetch: () => load(true),
  }
}
