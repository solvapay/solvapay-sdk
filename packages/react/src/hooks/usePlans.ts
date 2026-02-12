import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { Plan, UsePlansOptions, UsePlansReturn } from '../types'

// Global cache for plans to prevent duplicate fetches across components
// Key: agentRef, Value: { plans: Plan[], timestamp: number, promise: Promise<Plan[]> | null }
const plansCache = new Map<
  string,
  { plans: Plan[]; timestamp: number; promise: Promise<Plan[]> | null }
>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

/**
 * Hook to manage plan fetching and selection
 *
 * Provides a reusable way to fetch, filter, sort and select plans.
 * Handles loading and error states automatically.
 * Uses a global cache to prevent duplicate fetches when multiple components use the same agentRef.
 *
 * @example
 * ```tsx
 * const plans = usePlans({
 *   agentRef: 'agent_123',
 *   fetcher: async (agentRef) => {
 *     const res = await fetch(`/api/list-plans?agentRef=${agentRef}`);
 *     const data = await res.json();
 *     return data.plans;
 *   },
 *   sortBy: (a, b) => (a.price || 0) - (b.price || 0),
 *   autoSelectFirstPaid: true,
 * });
 *
 * // Use in component
 * if (plans.loading) return <div>Loading...</div>;
 * if (plans.error) return <div>Error: {plans.error.message}</div>;
 * ```
 */
export function usePlans(options: UsePlansOptions): UsePlansReturn {
  const { fetcher, agentRef, filter, sortBy, autoSelectFirstPaid = false } = options

  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [selectedPlanIndex, setSelectedPlanIndex] = useState<number>(0)

  // Store fetcher, filter, and sortBy in refs to prevent unnecessary refetches
  const fetcherRef = useRef(fetcher)
  const filterRef = useRef(filter)
  const sortByRef = useRef(sortBy)
  const autoSelectFirstPaidRef = useRef(autoSelectFirstPaid)

  useEffect(() => {
    fetcherRef.current = fetcher
  }, [fetcher])

  useEffect(() => {
    filterRef.current = filter
  }, [filter])

  useEffect(() => {
    sortByRef.current = sortBy
  }, [sortBy])

  useEffect(() => {
    autoSelectFirstPaidRef.current = autoSelectFirstPaid
  }, [autoSelectFirstPaid])

  // Fetch plans with caching
  const fetchPlans = useCallback(
    async (force = false) => {
      if (!agentRef) {
        setError(new Error('Agent reference not configured'))
        setLoading(false)
        return
      }

      // Check cache first
      const cached = plansCache.get(agentRef)
      const now = Date.now()

      if (!force && cached && now - cached.timestamp < CACHE_DURATION) {
        // Use cached data
        const cachedPlans = cached.plans

        // Apply filter if provided
        let processedPlans = filterRef.current ? cachedPlans.filter(filterRef.current) : cachedPlans

        // Apply sort if provided
        if (sortByRef.current) {
          processedPlans = [...processedPlans].sort(sortByRef.current)
        }

        setPlans(processedPlans)
        setLoading(false)
        setError(null)

        // Auto-select first paid plan if enabled
        if (autoSelectFirstPaidRef.current && processedPlans.length > 0) {
          const firstPaidIndex = processedPlans.findIndex(plan => plan.price && plan.price > 0)
          setSelectedPlanIndex(firstPaidIndex >= 0 ? firstPaidIndex : 0)
        }
        return
      }

      // If there's an in-flight request, wait for it
      if (cached?.promise) {
        try {
          setLoading(true)
          const fetchedPlans = await cached.promise

          // Apply filter if provided
          let processedPlans = filterRef.current
            ? fetchedPlans.filter(filterRef.current)
            : fetchedPlans

          // Apply sort if provided
          if (sortByRef.current) {
            processedPlans = [...processedPlans].sort(sortByRef.current)
          }

          setPlans(processedPlans)
          setError(null)

          // Auto-select first paid plan if enabled
          if (autoSelectFirstPaidRef.current && processedPlans.length > 0) {
            const firstPaidIndex = processedPlans.findIndex(plan => plan.price && plan.price > 0)
            setSelectedPlanIndex(firstPaidIndex >= 0 ? firstPaidIndex : 0)
          }
        } catch (err) {
          setError(err instanceof Error ? err : new Error('Failed to load plans'))
        } finally {
          setLoading(false)
        }
        return
      }

      // Start new fetch
      try {
        setLoading(true)
        setError(null)

        // Create promise and store it in cache
        const fetchPromise = fetcherRef.current(agentRef)
        plansCache.set(agentRef, {
          plans: [],
          timestamp: now,
          promise: fetchPromise,
        })

        // Use refs to get current values
        const fetchedPlans = await fetchPromise

        // Update cache with fetched data
        plansCache.set(agentRef, {
          plans: fetchedPlans,
          timestamp: now,
          promise: null,
        })

        // Apply filter if provided
        let processedPlans = filterRef.current
          ? fetchedPlans.filter(filterRef.current)
          : fetchedPlans

        // Apply sort if provided
        if (sortByRef.current) {
          processedPlans = [...processedPlans].sort(sortByRef.current)
        }

        setPlans(processedPlans)

        // Auto-select first paid plan if enabled
        if (autoSelectFirstPaidRef.current && processedPlans.length > 0) {
          const firstPaidIndex = processedPlans.findIndex(plan => plan.price && plan.price > 0)
          setSelectedPlanIndex(firstPaidIndex >= 0 ? firstPaidIndex : 0)
        }
      } catch (err) {
        // Remove failed promise from cache
        plansCache.delete(agentRef)
        setError(err instanceof Error ? err : new Error('Failed to load plans'))
      } finally {
        setLoading(false)
      }
    },
    [agentRef],
  ) // Only depend on agentRef, use refs for everything else

  // Fetch plans on mount and when agentRef changes
  useEffect(() => {
    fetchPlans()
  }, [fetchPlans])

  // Get selected plan
  const selectedPlan = useMemo(() => {
    return plans[selectedPlanIndex] || null
  }, [plans, selectedPlanIndex])

  // Select plan by reference
  const selectPlan = useCallback(
    (planRef: string) => {
      const index = plans.findIndex(p => p.reference === planRef)
      if (index >= 0) {
        setSelectedPlanIndex(index)
      }
    },
    [plans],
  )

  return {
    plans,
    loading,
    error,
    selectedPlanIndex,
    selectedPlan,
    setSelectedPlanIndex,
    selectPlan,
    refetch: () => fetchPlans(true), // Force refetch
  }
}
