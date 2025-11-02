import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Plan, UsePlansOptions, UsePlansReturn } from '../types';

/**
 * Hook to manage plan fetching and selection
 * 
 * Provides a reusable way to fetch, filter, sort and select subscription plans.
 * Handles loading and error states automatically.
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
  const { fetcher, agentRef, filter, sortBy, autoSelectFirstPaid = false } = options;
  
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [selectedPlanIndex, setSelectedPlanIndex] = useState<number>(0);

  // Fetch plans
  const fetchPlans = useCallback(async () => {
    if (!agentRef) {
      setError(new Error('Agent reference not configured'));
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const fetchedPlans = await fetcher(agentRef);
      
      // Apply filter if provided
      let processedPlans = filter ? fetchedPlans.filter(filter) : fetchedPlans;
      
      // Apply sort if provided
      if (sortBy) {
        processedPlans = [...processedPlans].sort(sortBy);
      }
      
      setPlans(processedPlans);
      
      // Auto-select first paid plan if enabled
      if (autoSelectFirstPaid && processedPlans.length > 0) {
        const firstPaidIndex = processedPlans.findIndex(
          (plan) => plan.price && plan.price > 0
        );
        setSelectedPlanIndex(firstPaidIndex >= 0 ? firstPaidIndex : 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load plans'));
    } finally {
      setLoading(false);
    }
  }, [agentRef, fetcher, filter, sortBy, autoSelectFirstPaid]);

  // Fetch plans on mount and when agentRef changes
  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  // Get selected plan
  const selectedPlan = useMemo(() => {
    return plans[selectedPlanIndex] || null;
  }, [plans, selectedPlanIndex]);

  // Select plan by reference
  const selectPlan = useCallback((planRef: string) => {
    const index = plans.findIndex(p => p.reference === planRef);
    if (index >= 0) {
      setSelectedPlanIndex(index);
    }
  }, [plans]);

  return {
    plans,
    loading,
    error,
    selectedPlanIndex,
    selectedPlan,
    setSelectedPlanIndex,
    selectPlan,
    refetch: fetchPlans,
  };
}

