import { useCallback, useEffect, useState } from 'react'
import { useSolvaPay } from './useSolvaPay'
import { createHttpTransport } from '../transport/http'
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

/**
 * Cache key: prefer the custom transport identity when present (assigned
 * lazily via WeakMap so distinct transports don't share cache entries). HTTP
 * consumers key off the configured route.
 */
const transportIds = new WeakMap<object, number>()
let nextTransportId = 0

function cacheKeyFor(config: SolvaPayConfig | undefined): string {
  const transport = config?.transport
  if (transport) {
    let id = transportIds.get(transport)
    if (id === undefined) {
      id = ++nextTransportId
      transportIds.set(transport, id)
    }
    return `transport:${id}`
  }
  return config?.api?.getPaymentMethod || '/api/payment-method'
}

async function fetchPaymentMethod(
  config: SolvaPayConfig | undefined,
): Promise<PaymentMethodInfo> {
  const transport = config?.transport ?? createHttpTransport(config)
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
        paymentMethodCache.set(key, { paymentMethod: null, promise, timestamp: now })
        const pm = await promise
        paymentMethodCache.set(key, { paymentMethod: pm, promise: null, timestamp: now })
        setPaymentMethod(pm)
      } catch (err) {
        paymentMethodCache.delete(key)
        _config?.onError?.(
          err instanceof Error ? err : new Error(String(err)),
          'getPaymentMethod',
        )
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
