'use client'

/**
 * ProductBadge compound primitive.
 *
 * Single leaf that renders the customer's current product name when an
 * active purchase exists. Emits `data-has-purchase` + `data-has-paid-purchase`
 * flags and forwards an `aria-label` derived from the copy bundle.
 * `PlanBadge` is an alias retained for backwards compatibility with older
 * integrations — both point at the same component.
 */

import React, { forwardRef, useContext, useEffect, useState } from 'react'
import { Slot } from './slot'
import { usePurchase } from '../hooks/usePurchase'
import { useCopy } from '../hooks/useCopy'
import { interpolate } from '../i18n/interpolate'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'

type ProductBadgeProps = React.HTMLAttributes<HTMLElement> & {
  asChild?: boolean
}

const ProductBadgeImpl = forwardRef<HTMLElement, ProductBadgeProps>(function ProductBadge(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const solva = useContext(SolvaPayContext)
  if (!solva) throw new MissingProviderError('ProductBadge')

  const { purchases, loading, hasPaidPurchase, activePurchase } = usePurchase()
  const copy = useCopy()
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)

  useEffect(() => {
    // One-shot sync: flip `hasLoadedOnce` once the initial fetch settles so
    // subsequent background refetches don't re-hide the badge. Intentional
    // setState-in-effect pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!loading) setHasLoadedOnce(true)
  }, [loading])

  const planToDisplay = activePurchase?.productName ?? null
  const shouldShow = planToDisplay !== null && (!loading || hasLoadedOnce)
  if (!shouldShow) return null

  const commonProps = {
    'data-solvapay-product-badge': '',
    'data-loading': loading ? '' : undefined,
    'data-has-purchase': activePurchase ? '' : undefined,
    'data-has-paid-purchase': hasPaidPurchase ? '' : undefined,
    role: 'status',
    'aria-live': 'polite' as const,
    'aria-busy': loading,
    'aria-label': interpolate(copy.product.currentProductLabel, { name: planToDisplay }),
    ...rest,
  }

  if (asChild) {
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <Slot ref={forwardedRef as any} {...commonProps}>
        {children ?? <>{planToDisplay}</>}
      </Slot>
    )
  }

  // Purchases list retained via data attribute count only when useful for styling/tests.
  void purchases
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <div ref={forwardedRef as any} {...(commonProps as React.HTMLAttributes<HTMLDivElement>)}>
      {children ?? planToDisplay}
    </div>
  )
})

export const ProductBadge = ProductBadgeImpl
/** @deprecated Use `ProductBadge` instead. Kept as an alias for existing integrations. */
export const PlanBadge = ProductBadgeImpl
