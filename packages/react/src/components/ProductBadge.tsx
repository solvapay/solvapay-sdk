'use client'
import React, { useState, useEffect, useRef } from 'react'
import { usePurchase } from '../hooks/usePurchase'
import type { ProductBadgeProps } from '../types'

/**
 * Headless Product Badge Component
 *
 * Displays purchase status with complete styling control.
 * Supports render props, custom components, or className patterns.
 *
 * Prevents flickering by hiding the badge during initial load and when no purchase exists.
 * Shows the badge once loading completes AND an active purchase exists (paid or free).
 * Badge only updates when the product name actually changes (prevents unnecessary re-renders).
 *
 * Displays the primary active purchase (paid or free) to show current product status.
 *
 * @example
 * ```tsx
 * // Render prop pattern
 * <ProductBadge>
 *   {({ purchases, loading, displayPlan, shouldShow }) => (
 *     shouldShow ? (
 *       <div>{displayPlan}</div>
 *     ) : null
 *   )}
 * </ProductBadge>
 *
 * //ClassName pattern
 * <ProductBadge className="badge badge-primary" />
 * ```
 */
export const ProductBadge: React.FC<ProductBadgeProps> = ({
  children,
  as: Component = 'div',
  className,
}) => {
  const { purchases, loading, hasPaidPurchase, activePurchase } = usePurchase()
  const [displayPlan, setDisplayPlan] = useState<string | null>(null)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)

  const lastPlanRef = useRef<string | null>(null)
  const lastLoadingRef = useRef<boolean>(true)
  const previousPurchasesRef = useRef<typeof purchases>(purchases)

  const currentPlanName = activePurchase?.productName || null

  const effectivePlanName = currentPlanName

  useEffect(() => {
    if (!loading && !hasLoadedOnce) {
      setHasLoadedOnce(true)
    }

    lastLoadingRef.current = loading
  }, [loading, hasLoadedOnce])

  useEffect(() => {
    const previousPurchases = previousPurchasesRef.current

    if (previousPurchases !== purchases) {
      if (loading) {
        setHasLoadedOnce(false)
      }

      setDisplayPlan(null)
      lastPlanRef.current = null
      previousPurchasesRef.current = purchases
    }
  }, [purchases, loading])

  useEffect(() => {
    const currentPlan = effectivePlanName
    const previousPlan = lastPlanRef.current

    if (currentPlan !== previousPlan) {
      if (currentPlan !== null) {
        lastPlanRef.current = currentPlan
        setDisplayPlan(currentPlan)
      } else {
        lastPlanRef.current = null
        setDisplayPlan(null)
      }
    } else if (currentPlan !== null && displayPlan === null) {
      setDisplayPlan(currentPlan)
    }
  }, [effectivePlanName, displayPlan])

  const shouldShow = effectivePlanName !== null && hasLoadedOnce

  const planToDisplay = displayPlan ?? effectivePlanName

  if (children) {
    return <>{children({ purchases, loading, displayPlan: planToDisplay, shouldShow })}</>
  }

  if (!shouldShow) {
    return null
  }

  const computedClassName =
    typeof className === 'function' ? className({ purchases }) : className

  return (
    <Component
      className={computedClassName}
      data-loading={loading}
      data-has-purchase={!!activePurchase}
      data-has-paid-purchase={hasPaidPurchase}
      role="status"
      aria-live="polite"
      aria-busy={loading}
      aria-label={`Current product: ${planToDisplay}`}
    >
      {planToDisplay}
    </Component>
  )
}

/** @deprecated Use ProductBadge instead */
export const PlanBadge = ProductBadge
