'use client'

/**
 * Default-tree shim over the `CheckoutSummary` primitive.
 *
 * Renders a product/plan/price line with optional trial + tax-note slots.
 * Full control (ordering, custom elements, Tailwind variants) is available
 * via the primitives at `@solvapay/react/primitives`.
 */

import React from 'react'
import { CheckoutSummary as Primitive } from '../primitives/CheckoutSummary'

export type CheckoutSummaryProps = {
  planRef?: string
  productRef?: string
  showTrial?: boolean
  showTaxNote?: boolean
  className?: string
}

export const CheckoutSummary: React.FC<CheckoutSummaryProps> = ({
  planRef,
  productRef,
  showTrial = true,
  showTaxNote = false,
  className,
}) => {
  const rootClass = ['solvapay-checkout-summary', className].filter(Boolean).join(' ')
  return (
    <Primitive.Root planRef={planRef} productRef={productRef} className={rootClass}>
      <Primitive.Product className="solvapay-checkout-summary-product" />
      <div className="solvapay-checkout-summary-row">
        <Primitive.Plan className="solvapay-checkout-summary-plan" />
        <Primitive.Price className="solvapay-checkout-summary-price" />
      </div>
      {showTrial && <Primitive.Trial className="solvapay-checkout-summary-trial" />}
      {showTaxNote && <Primitive.TaxNote className="solvapay-checkout-summary-tax-note" />}
    </Primitive.Root>
  )
}
