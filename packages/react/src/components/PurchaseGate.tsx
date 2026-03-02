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
 * <PurchaseGate requireProduct="Pro Plan">
 *   {({ hasAccess, loading }) => {
 *     if (loading) return <Skeleton />;
 *     if (!hasAccess) return <Paywall />;
 *     return <PremiumContent />;
 *   }}
 * </PurchaseGate>
 * ```
 */
export const PurchaseGate: React.FC<PurchaseGateProps> = ({ requirePlan, requireProduct, children }) => {
  const { purchases, loading, hasProduct } = usePurchase()

  const productToCheck = requireProduct || requirePlan
  const hasAccess = productToCheck
    ? hasProduct(productToCheck)
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
