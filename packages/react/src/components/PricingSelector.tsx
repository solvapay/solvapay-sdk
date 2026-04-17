'use client'
import React, { useCallback, useMemo } from 'react'
import { usePlans } from '../hooks/usePlans'
import { usePurchase } from '../hooks/usePurchase'
import type { PricingSelectorProps } from '../types'

/**
 * Headless Pricing Selector Component
 *
 * Provides pricing selection logic with complete styling control via render props.
 * Integrates plan fetching, purchase status, and selection state management.
 *
 * Features:
 * - Fetches and manages pricing options
 * - Tracks selected option
 * - Provides helpers for checking if option is current/paid
 * - Integrates with purchase context
 *
 * @example
 * ```tsx
 * <PricingSelector
 *   productRef="prd_123"
 *   fetcher={async (productRef) => {
 *     const res = await fetch(`/api/list-plans?productRef=${productRef}`);
 *     const data = await res.json();
 *     return data.plans;
 *   }}
 *   sortBy={(a, b) => (a.price || 0) - (b.price || 0)}
 *   autoSelectFirstPaid
 * >
 *   {({ plans, selectedPlan, setSelectedPlanIndex, loading, isPaidPlan, isCurrentPlan }) => (
 *     <div>
 *       {loading ? (
 *         <div>Loading...</div>
 *       ) : (
 *         plans.map((plan, index) => (
 *           <button
 *             key={plan.reference}
 *             onClick={() => setSelectedPlanIndex(index)}
 *             disabled={!isPaidPlan(plan.reference)}
 *           >
 *             ${plan.price}/{plan.interval}
 *             {isCurrentPlan(plan.reference) && ' (Current)'}
 *           </button>
 *         ))
 *       )}
 *     </div>
 *   )}
 * </PricingSelector>
 * ```
 */
export const PricingSelector: React.FC<PricingSelectorProps> = ({
  productRef,
  fetcher,
  filter,
  sortBy,
  autoSelectFirstPaid,
  children,
}) => {
  const { purchases } = usePurchase()

  const plansHook = usePlans({
    productRef,
    fetcher,
    filter,
    sortBy,
    autoSelectFirstPaid,
  })

  const { plans } = plansHook

  const isPaidPlan = useCallback(
    (planRef: string): boolean => {
      const plan = plans.find(p => p.reference === planRef)
      return plan ? plan.requiresPayment !== false : true
    },
    [plans],
  )

  const activePurchase = useMemo(() => {
    const activePurchases = purchases.filter(p => p.status === 'active')
    return (
      activePurchases.sort(
        (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
      )[0] || null
    )
  }, [purchases])

  const isCurrentPlan = useCallback(
    (planRef: string): boolean => {
      return activePurchase?.planSnapshot?.reference === planRef
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
