'use client'
import React, { useCallback, useMemo } from 'react'
import { usePlans } from '../hooks/usePlans'
import { usePurchase } from '../hooks/usePurchase'
import type { PlanSelectorProps } from '../types'

/**
 * Headless Plan Selector Component
 *
 * Provides plan selection logic with complete styling control via render props.
 * Integrates plan fetching, purchase status, and selection state management.
 *
 * Features:
 * - Fetches and manages plans
 * - Tracks selected plan
 * - Provides helpers for checking if plan is current/paid
 * - Integrates with purchase context
 *
 * @example
 * ```tsx
 * <PlanSelector
 *   agentRef="agent_123"
 *   fetcher={async (agentRef) => {
 *     const res = await fetch(`/api/list-plans?agentRef=${agentRef}`);
 *     const data = await res.json();
 *     return data.plans;
 *   }}
 *   sortBy={(a, b) => (a.price || 0) - (b.price || 0)}
 *   autoSelectFirstPaid
 * >
 *   {({ plans, selectedPlan, setSelectedPlanIndex, loading, isPaidPlan, isCurrentPlan }) => (
 *     <div>
 *       {loading ? (
 *         <div>Loading plans...</div>
 *       ) : (
 *         plans.map((plan, index) => (
 *           <button
 *             key={plan.reference}
 *             onClick={() => setSelectedPlanIndex(index)}
 *             disabled={!isPaidPlan(plan.name)}
 *           >
 *             {plan.name} - ${plan.price}
 *             {isCurrentPlan(plan.name) && ' (Current)'}
 *           </button>
 *         ))
 *       )}
 *     </div>
 *   )}
 * </PlanSelector>
 * ```
 */
export const PlanSelector: React.FC<PlanSelectorProps> = ({
  agentRef,
  fetcher,
  filter,
  sortBy,
  autoSelectFirstPaid,
  children,
}) => {
  const { purchases } = usePurchase()

  const plansHook = usePlans({
    agentRef,
    fetcher,
    filter,
    sortBy,
    autoSelectFirstPaid,
  })

  const { plans } = plansHook

  // Helper to check if a plan is paid
  const isPaidPlan = useCallback(
    (planName: string): boolean => {
      const plan = plans.find(p => p.name === planName)
      return plan ? (plan.price ?? 0) > 0 && !plan.isFreeTier : true
    },
    [plans],
  )

  // Get active purchase plan name
  const activePurchase = useMemo(() => {
    const activeSubs = purchases.filter(sub => sub.status === 'active')
    return (
      activeSubs.sort(
        (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
      )[0] || null
    )
  }, [purchases])

  // Helper to check if a plan is the current purchase
  const isCurrentPlan = useCallback(
    (planName: string): boolean => {
      return activePurchase?.planName === planName
    },
    [activePurchase],
  )

  return (
    <>
      {children({
        ...plansHook,
        purchases,
        isPaidPlan,
        isCurrentPlan,
      })}
    </>
  )
}
