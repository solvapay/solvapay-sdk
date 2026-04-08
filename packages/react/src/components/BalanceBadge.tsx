'use client'

import { useBalance } from '../hooks/useBalance'
import type { BalanceBadgeProps } from '../types'

const CREDITS_PER_MINOR_UNIT = 100

export function BalanceBadge({ className, children }: BalanceBadgeProps) {
  const { credits, displayCurrency, loading } = useBalance()

  if (children) {
    return <>{children({ credits, loading, displayCurrency })}</>
  }

  if (loading) {
    return <span className={className} aria-busy="true" />
  }

  if (credits == null) {
    return null
  }

  const formattedCredits = new Intl.NumberFormat().format(credits)

  let currencyEquivalent = ''
  if (displayCurrency) {
    const minorUnits = credits / CREDITS_PER_MINOR_UNIT
    currencyEquivalent = ` (~${new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: displayCurrency,
      minimumFractionDigits: 2,
    }).format(minorUnits / 100)})`
  }

  return (
    <span className={className}>
      {formattedCredits} credits{currencyEquivalent}
    </span>
  )
}
