'use client'
import React from 'react'
import { useBalance } from '../hooks/useBalance'
import { useProduct } from '../hooks/useProduct'
import { useCopy } from '../hooks/useCopy'
import { TopupForm } from '../TopupForm'
import { interpolate } from '../i18n/interpolate'

export interface CreditGateRenderArgs {
  balance: number | null
  hasCredits: boolean
  topup: React.ReactNode
  loading: boolean
}

export interface CreditGateProps {
  /** Minimum credits required to unlock `children`. Defaults to 1. */
  minCredits?: number
  /** Optional product reference to personalize the fallback copy. */
  productRef?: string
  /** Top-up amount pre-filled in the default fallback. */
  topupAmount?: number
  /** Top-up currency for the default fallback. Defaults to USD. */
  topupCurrency?: string
  /**
   * Replaces the default "low balance" card. Alternative: use the render-prop
   * `children: ({ balance, hasCredits, topup }) => ReactNode` form.
   */
  fallback?: React.ReactNode
  className?: string
  children?: React.ReactNode | ((args: CreditGateRenderArgs) => React.ReactNode)
}

const defaultFallbackStyle: React.CSSProperties = {
  padding: 20,
  background: '#fff7ed',
  border: '1px solid #fed7aa',
  borderRadius: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

/**
 * Companion to `<PurchaseGate>` for usage-based flows. Checks the customer's
 * credit balance against a threshold; when below, renders a top-up prompt
 * (or a custom fallback / render-prop) instead of children.
 */
export const CreditGate: React.FC<CreditGateProps> = ({
  minCredits = 1,
  productRef,
  topupAmount = 1000,
  topupCurrency = 'usd',
  fallback,
  className,
  children,
}) => {
  const copy = useCopy()
  const { credits, loading } = useBalance()
  const { product } = useProduct(productRef)

  const hasCredits = credits != null && credits >= minCredits

  const defaultTopup = <TopupForm amount={topupAmount} currency={topupCurrency} />

  if (typeof children === 'function') {
    return (
      <>
        {children({
          balance: credits,
          hasCredits,
          topup: defaultTopup,
          loading,
        })}
      </>
    )
  }

  if (hasCredits) {
    return <>{children}</>
  }

  if (fallback) return <>{fallback}</>

  return (
    <div
      data-solvapay-credit-gate=""
      className={className}
      style={className ? undefined : defaultFallbackStyle}
    >
      <h3 style={{ fontSize: 16, fontWeight: 600, color: '#9a3412', margin: 0 }}>
        {copy.creditGate.lowBalanceHeading}
      </h3>
      <p style={{ fontSize: 14, color: '#c2410c', margin: 0 }}>
        {interpolate(copy.creditGate.lowBalanceSubheading, {
          product: product?.name ?? 'this product',
        })}
      </p>
      {defaultTopup}
    </div>
  )
}
