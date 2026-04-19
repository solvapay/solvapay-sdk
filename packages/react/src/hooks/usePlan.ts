import { useCallback, useEffect, useState } from 'react'
import { useSolvaPay } from './useSolvaPay'
import { buildRequestHeaders } from '../utils/headers'
import { plansCache, CACHE_DURATION } from './usePlans'
import type { Plan, UsePlanOptions, UsePlanReturn, SolvaPayConfig } from '../types'

async function listPlans(
  productRef: string,
  config: SolvaPayConfig | undefined,
): Promise<Plan[]> {
  const base = config?.api?.listPlans || '/api/list-plans'
  const url = `${base}?productRef=${encodeURIComponent(productRef)}`
  const fetchFn = config?.fetch || fetch
  const { headers } = await buildRequestHeaders(config)

  const res = await fetchFn(url, { method: 'GET', headers })
  if (!res.ok) {
    const error = new Error(`Failed to fetch plans: ${res.statusText || res.status}`)
    config?.onError?.(error, 'listPlans')
    throw error
  }
  const data = (await res.json()) as { plans?: Plan[] }
  return data.plans ?? []
}

/**
 * Hook to load a single plan by reference.
 *
 * When `productRef` is known, piggybacks on the `usePlans` cache so there's
 * no extra fetch. Otherwise fetches the full plan list and filters.
 */
export function usePlan(options: UsePlanOptions): UsePlanReturn {
  const { planRef, productRef } = options
  const { _config } = useSolvaPay()

  const findPlan = useCallback(
    (plans: Plan[]): Plan | null => {
      if (!planRef) return null
      return plans.find(p => p.reference === planRef) || null
    },
    [planRef],
  )

  const [plan, setPlan] = useState<Plan | null>(() => {
    if (!planRef || !productRef) return null
    const cached = plansCache.get(productRef)
    if (!cached || Date.now() - cached.timestamp >= CACHE_DURATION) return null
    return findPlan(cached.plans)
  })
  const [loading, setLoading] = useState(() => !!(planRef && !plan))
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(
    async (force = false) => {
      if (!planRef) {
        setPlan(null)
        setLoading(false)
        setError(null)
        return
      }
      if (!productRef) {
        setLoading(false)
        setError(
          new Error('usePlan: productRef is required to resolve a plan reference'),
        )
        return
      }

      const cached = plansCache.get(productRef)
      const now = Date.now()

      if (!force && cached?.plans.length && now - cached.timestamp < CACHE_DURATION) {
        const p = findPlan(cached.plans)
        setPlan(p)
        setLoading(false)
        setError(
          p
            ? null
            : new Error(
                `Plan "${planRef}" not found in product "${productRef}"`,
              ),
        )
        return
      }

      if (!force && cached?.promise) {
        try {
          setLoading(true)
          const plans = await cached.promise
          const p = findPlan(plans)
          setPlan(p)
          setError(
            p
              ? null
              : new Error(
                  `Plan "${planRef}" not found in product "${productRef}"`,
                ),
          )
        } catch (err) {
          setError(err instanceof Error ? err : new Error('Failed to load plan'))
        } finally {
          setLoading(false)
        }
        return
      }

      try {
        setLoading(true)
        setError(null)
        const promise = listPlans(productRef, _config)
        plansCache.set(productRef, { plans: [], timestamp: now, promise })
        const plans = await promise
        plansCache.set(productRef, { plans, timestamp: now, promise: null })
        const p = findPlan(plans)
        setPlan(p)
        if (!p) {
          setError(new Error(`Plan "${planRef}" not found in product "${productRef}"`))
        }
      } catch (err) {
        plansCache.delete(productRef)
        setError(err instanceof Error ? err : new Error('Failed to load plan'))
      } finally {
        setLoading(false)
      }
    },
    [planRef, productRef, _config, findPlan],
  )

  useEffect(() => {
    load()
  }, [load])

  return {
    plan,
    loading,
    error,
    refetch: () => load(true),
  }
}
