'use client'

import { useBalance } from '../hooks/useBalance'
import { useCopy, useLocale } from '../hooks/useCopy'
import { interpolate } from '../i18n/interpolate'
import type { BalanceBadgeProps } from '../types'

export function BalanceBadge({ className, numberOnly, children }: BalanceBadgeProps) {
  const { credits, displayCurrency, creditsPerMinorUnit, displayExchangeRate, loading } = useBalance()
  const copy = useCopy()
  const locale = useLocale()

  if (children) {
    return <>{children({ credits, loading, displayCurrency, creditsPerMinorUnit })}</>
  }

  if (loading) {
    return <span className={className} aria-busy="true" />
  }

  if (credits == null) {
    return null
  }

  const formattedCredits = new Intl.NumberFormat(locale).format(credits)

  if (numberOnly) {
    return <span className={className}>{formattedCredits}</span>
  }

  let currencyEquivalent = ''
  if (displayCurrency && creditsPerMinorUnit) {
    const usdCents = credits / creditsPerMinorUnit
    const displayMajorUnits = (usdCents * (displayExchangeRate ?? 1)) / 100
    const formatted = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: displayCurrency,
      minimumFractionDigits: 2,
    }).format(displayMajorUnits)
    currencyEquivalent = interpolate(copy.balance.currencyEquivalent, {
      amount: formatted,
    })
  }

  return (
    <span className={className}>
      {formattedCredits}
      {copy.balance.credits}
      {currencyEquivalent}
    </span>
  )
}
