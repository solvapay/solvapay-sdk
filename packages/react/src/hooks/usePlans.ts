import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { Plan, UsePlansOptions, UsePlansReturn } from '../types'

// Global cache for plans to prevent duplicate fetches across components
// Key: productRef, Value: { plans: Plan[], timestamp: number, promise: Promise<Plan[]> | null }
const plansCache = new Map<
  string,
  { plans: Plan[]; timestamp: number; promise: Promise<Plan[]> | null }
>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

/** @internal Exported only for tests — do not use in application code */
export { plansCache, CACHE_DURATION }

function processPlans(
  raw: Plan[],
  filter?: (plan: Plan, index: number) => boolean,
  sortBy?: (a: Plan, b: Plan) => number,
): Plan[] {
  let result = sortBy ? [...raw].sort(sortBy) : raw
  if (filter) result = result.filter(filter)
  return result
}

function computeInitialIndex(
  plans: Plan[],
  initialPlanRef?: string,
  autoSelectFirstPaid?: boolean,
): number {
  if (plans.length === 0) return 0

  if (initialPlanRef) {
    const idx = plans.findIndex(p => p.reference === initialPlanRef)
    if (idx >= 0) return idx
  }

  if (autoSelectFirstPaid) {
    const idx = plans.findIndex(p => p.requiresPayment !== false)
    return idx >= 0 ? idx : 0
  }

  return 0
}

/**
 * Hook to manage plan fetching and selection.
 *
 * Selection lifecycle:
 * 1. While `selectionReady` is false, plans fetch but no auto-selection fires.
 * 2. When `selectionReady` becomes true AND plans are loaded, one-shot initial
 *    selection is applied (initialPlanRef > autoSelectFirstPaid > index 0).
 * 3. After initial selection, user picks always win — the hook never overrides.
 */
export function usePlans(options: UsePlansOptions): UsePlansReturn {
  const {
    fetcher,
    productRef,
    filter,
    sortBy,
    autoSelectFirstPaid = false,
    initialPlanRef,
    selectionReady = true,
  } = options

  const fetcherRef = useRef(fetcher)
  const filterRef = useRef(filter)
  const sortByRef = useRef(sortBy)
  const autoSelectFirstPaidRef = useRef(autoSelectFirstPaid)
  const initialPlanRefRef = useRef(initialPlanRef)
  const selectionReadyRef = useRef(selectionReady)

  const hasAppliedInitialRef = useRef(false)
  const userHasSelectedRef = useRef(false)

  // Synchronous cache init: if cache is valid and selectionReady on mount,
  // compute the correct index immediately to avoid a flash.
  const [selectedPlanIndex, setSelectedPlanIndexState] = useState(() => {
    if (!selectionReady || !productRef) return 0
    const cached = plansCache.get(productRef)
    if (!cached || Date.now() - cached.timestamp >= CACHE_DURATION || cached.plans.length === 0) {
      return 0
    }
    const processed = processPlans(cached.plans, filter, sortBy)
    if (processed.length === 0) return 0
    const idx = computeInitialIndex(processed, initialPlanRef, autoSelectFirstPaid)
    hasAppliedInitialRef.current = true
    return idx
  })

  const [plans, setPlans] = useState<Plan[]>(() => {
    if (!productRef) return []
    const cached = plansCache.get(productRef)
    if (!cached || Date.now() - cached.timestamp >= CACHE_DURATION || cached.plans.length === 0) {
      return []
    }
    return processPlans(cached.plans, filter, sortBy)
  })

  const [loading, setLoading] = useState(() => plans.length === 0)
  const [error, setError] = useState<Error | null>(null)

  // Keep refs in sync
  useEffect(() => { fetcherRef.current = fetcher }, [fetcher])
  useEffect(() => { filterRef.current = filter }, [filter])
  useEffect(() => { sortByRef.current = sortBy }, [sortBy])
  useEffect(() => { autoSelectFirstPaidRef.current = autoSelectFirstPaid }, [autoSelectFirstPaid])
  useEffect(() => { initialPlanRefRef.current = initialPlanRef }, [initialPlanRef])
  useEffect(() => { selectionReadyRef.current = selectionReady }, [selectionReady])

  // Wrapped setter that tracks user-initiated selection
  const setSelectedPlanIndex = useCallback((index: number) => {
    userHasSelectedRef.current = true
    setSelectedPlanIndexState(index)
  }, [])

  const applyInitialSelection = useCallback((processedPlans: Plan[]) => {
    if (hasAppliedInitialRef.current || userHasSelectedRef.current) return
    if (!selectionReadyRef.current || processedPlans.length === 0) return

    hasAppliedInitialRef.current = true

    const idx = computeInitialIndex(
      processedPlans,
      initialPlanRefRef.current,
      autoSelectFirstPaidRef.current,
    )
    setSelectedPlanIndexState(idx)
  }, [])

  // Fetch plans with caching
  const fetchPlans = useCallback(
    async (force = false) => {
      if (!productRef) {
        setError(new Error('Product reference not configured'))
        setLoading(false)
        return
      }

      const cached = plansCache.get(productRef)
      const now = Date.now()

      if (!force && cached && now - cached.timestamp < CACHE_DURATION) {
        const processedPlans = processPlans(
          cached.plans,
          filterRef.current,
          sortByRef.current,
        )
        setPlans(processedPlans)
        setLoading(false)
        setError(null)
        applyInitialSelection(processedPlans)
        return
      }

      if (cached?.promise) {
        try {
          setLoading(true)
          const fetchedPlans = await cached.promise
          const processedPlans = processPlans(
            fetchedPlans,
            filterRef.current,
            sortByRef.current,
          )
          setPlans(processedPlans)
          setError(null)
          applyInitialSelection(processedPlans)
        } catch (err) {
          setError(err instanceof Error ? err : new Error('Failed to load plans'))
        } finally {
          setLoading(false)
        }
        return
      }

      try {
        setLoading(true)
        setError(null)

        const fetchPromise = fetcherRef.current(productRef)
        plansCache.set(productRef, { plans: [], timestamp: now, promise: fetchPromise })

        const fetchedPlans = await fetchPromise

        plansCache.set(productRef, { plans: fetchedPlans, timestamp: now, promise: null })

        const processedPlans = processPlans(
          fetchedPlans,
          filterRef.current,
          sortByRef.current,
        )
        setPlans(processedPlans)
        applyInitialSelection(processedPlans)
      } catch (err) {
        plansCache.delete(productRef)
        setError(err instanceof Error ? err : new Error('Failed to load plans'))
      } finally {
        setLoading(false)
      }
    },
    [productRef, applyInitialSelection],
  )

  // Fetch plans on mount and when productRef changes
  useEffect(() => {
    fetchPlans()
  }, [fetchPlans])

  // Deferred selection: when selectionReady transitions to true after plans are loaded
  useEffect(() => {
    if (hasAppliedInitialRef.current || userHasSelectedRef.current) return
    if (!selectionReady || plans.length === 0) return
    applyInitialSelection(plans)
  }, [selectionReady, plans, applyInitialSelection])

  const selectedPlan = useMemo(() => plans[selectedPlanIndex] || null, [plans, selectedPlanIndex])

  const selectPlan = useCallback(
    (planRef: string) => {
      const index = plans.findIndex(p => p.reference === planRef)
      if (index >= 0) {
        setSelectedPlanIndex(index)
      }
    },
    [plans, setSelectedPlanIndex],
  )

  return {
    plans,
    loading,
    error,
    selectedPlanIndex,
    selectedPlan,
    setSelectedPlanIndex,
    selectPlan,
    refetch: () => fetchPlans(true),
    isSelectionReady: hasAppliedInitialRef.current,
  }
}
