'use client'
import React from 'react'
import { usePurchase } from '../hooks/usePurchase'
import type { ProductBadgeProps } from '../types'

/**
 * Headless Product Badge Component
 *
 * Displays purchase status with complete styling control.
 * Supports render props, custom components, or className patterns.
 *
 * Hidden while loading or when no active purchase exists to prevent flickering.
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
 * // ClassName pattern
 * <ProductBadge className="badge badge-primary" />
 * ```
 */
export const ProductBadge: React.FC<ProductBadgeProps> = ({
  children,
  as: Component = 'div',
  className,
}) => {
  const { purchases, loading, hasPaidPurchase, activePurchase } = usePurchase()

  const planToDisplay = activePurchase?.productName || null
  const shouldShow = !loading && planToDisplay !== null

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
