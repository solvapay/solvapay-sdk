'use client'

import { useBalance } from '../hooks/useBalance'
import type { BalanceBadgeProps } from '../types'

export function BalanceBadge({ className, numberOnly, children }: BalanceBadgeProps) {
  const { credits, displayCurrency, creditsPerMinorUnit, loading } = useBalance()

  if (children) {
    return <>{children({ credits, loading, displayCurrency, creditsPerMinorUnit })}</>
  }

  if (loading) {
    return <span className={className} aria-busy="true" />
  }

  if (credits == null) {
    return null
  }

  const formattedCredits = new Intl.NumberFormat().format(credits)

  if (numberOnly) {
    return <span className={className}>{formattedCredits}</span>
  }

  let currencyEquivalent = ''
  if (displayCurrency && creditsPerMinorUnit) {
    const minorUnits = credits / creditsPerMinorUnit
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
