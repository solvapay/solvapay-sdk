'use client'
import React from 'react'
import { usePurchase } from '../hooks/usePurchase'
import type { PurchaseGateProps } from '../types'

/**
 * Headless Purchase Gate Component
 *
 * Controls access to content based on purchase status.
 * Uses render props to give developers full control over locked/unlocked states.
 *
 * @example
 * ```tsx
 * <PurchaseGate requirePlan="Pro Plan">
 *   {({ hasAccess, loading }) => {
 *     if (loading) return <Skeleton />;
 *     if (!hasAccess) return <Paywall />;
 *     return <PremiumContent />;
 *   }}
 * </PurchaseGate>
 * ```
 */
export const PurchaseGate: React.FC<PurchaseGateProps> = ({ requirePlan, children }) => {
  const { purchases, loading, hasPlan } = usePurchase()

  const hasAccess = requirePlan
    ? hasPlan(requirePlan)
    : purchases.some(p => p.status === 'active')

  return (
    <>
      {children({
        hasAccess,
        purchases,
        loading,
      })}
    </>
  )
}
