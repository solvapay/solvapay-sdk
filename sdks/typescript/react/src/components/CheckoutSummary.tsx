'use client'

/**
 * Default-tree shim over the `CheckoutSummary` primitive.
 *
 * Renders a product/plan/price line with optional trial + tax-note slots.
 * When `taxBreakdown` is provided, shows subtotal/tax/total instead.
 * Full control (ordering, custom elements, Tailwind variants) is available
 * via the primitives at `@solvapay/react/primitives`.
 */

import React from 'react'
import { CheckoutSummary as Primitive } from '../primitives/CheckoutSummary'
import type { TaxBreakdown } from '@solvapay/core'

export type CheckoutSummaryProps = {
  planRef?: string
  productRef?: string
  showTrial?: boolean
  showTaxNote?: boolean
  taxBreakdown?: TaxBreakdown | null
  baseAmountMinor?: number
  className?: string
}

export const CheckoutSummary: React.FC<CheckoutSummaryProps> = ({
  planRef,
  productRef,
  showTrial = true,
  showTaxNote = false,
  taxBreakdown = null,
  baseAmountMinor = 0,
  className,
}) => {
  const rootClass = ['solvapay-checkout-summary', className].filter(Boolean).join(' ')
  const hasTax = taxBreakdown != null

  return (
    <Primitive.Root
      planRef={planRef}
      productRef={productRef}
      taxBreakdown={taxBreakdown}
      baseAmountMinor={baseAmountMinor}
      className={rootClass}
    >
      <Primitive.Product className="solvapay-checkout-summary-product" />
      <div className="solvapay-checkout-summary-row">
        <Primitive.Plan className="solvapay-checkout-summary-plan" />
        {!hasTax && <Primitive.Price className="solvapay-checkout-summary-price" />}
      </div>
      {hasTax ? (
        <>
          <div className="solvapay-checkout-summary-row">
            <span>Subtotal</span>
            <Primitive.Subtotal className="solvapay-checkout-summary-subtotal" />
          </div>
          <div className="solvapay-checkout-summary-row">
            <Primitive.Tax className="solvapay-checkout-summary-tax" />
          </div>
          <div className="solvapay-checkout-summary-row">
            <span>Total</span>
            <Primitive.Total className="solvapay-checkout-summary-total" />
          </div>
          <Primitive.TaxTreatmentNote className="solvapay-checkout-summary-tax-treatment-note" />
        </>
      ) : (
        <>
          {showTrial && <Primitive.Trial className="solvapay-checkout-summary-trial" />}
          {showTaxNote && <Primitive.TaxNote className="solvapay-checkout-summary-tax-note" />}
        </>
      )}
    </Primitive.Root>
  )
}
