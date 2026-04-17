'use client'
import React from 'react'
import { usePlan } from '../hooks/usePlan'
import { useProduct } from '../hooks/useProduct'
import { useCopy, useLocale } from '../hooks/useCopy'
import { formatPrice } from '../utils/format'
import { interpolate } from '../i18n/interpolate'
import type { Plan, Product } from '../types'

export type CheckoutSummaryRenderArgs = {
  plan: Plan | null
  product: Product | null
  priceFormatted: string
  loading: boolean
}

export type CheckoutSummaryProps = {
  planRef?: string
  productRef?: string
  showTrial?: boolean
  showTaxNote?: boolean
  /** Container classNames. Default styles are tiny and explicitly scoped. */
  className?: string
  /** Render-prop escape hatch: bypass default markup entirely. */
  children?: (args: CheckoutSummaryRenderArgs) => React.ReactNode
}

/**
 * Checkout summary: product name, plan name, price (with locale-correct
 * currency + interval), and an optional trial banner and VAT note.
 *
 * Styled-by-default with a minimal inline style tag that can be overridden
 * via `className` or replaced entirely via the `children` render prop.
 */
export const CheckoutSummary: React.FC<CheckoutSummaryProps> = ({
  planRef,
  productRef,
  showTrial = true,
  showTaxNote = false,
  className,
  children,
}) => {
  const locale = useLocale()
  const copy = useCopy()
  const { plan, loading: planLoading } = usePlan({ planRef, productRef })
  const { product, loading: productLoading } = useProduct(productRef)

  const loading = planLoading || productLoading

  const price = plan?.price ?? 0
  const currency = plan?.currency ?? 'usd'
  const priceFormatted = formatPrice(price, currency, {
    locale,
    interval: plan?.interval,
    intervalCount: 1,
    free: copy.interval.free,
  })

  if (children) {
    return <>{children({ plan, product, priceFormatted, loading })}</>
  }

  const trialDays = plan?.trialDays
  const trialBanner =
    showTrial && trialDays && trialDays > 0
      ? interpolate(copy.interval.trial, { trialDays })
      : null

  return (
    <div
      className={className}
      data-solvapay-checkout-summary=""
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '12px 16px',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 8,
      }}
    >
      {product?.name && (
        <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.64)' }}>{product.name}</div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 600 }}>{plan?.name || '\u00A0'}</div>
        <div style={{ fontWeight: 600 }}>{priceFormatted}</div>
      </div>
      {trialBanner && (
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.64)' }}>{trialBanner}</div>
      )}
      {showTaxNote && (
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.48)' }}>
          Taxes calculated at checkout
        </div>
      )}
    </div>
  )
}
