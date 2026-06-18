import { creditsToDisplayMinorUnits } from '@solvapay/core'
import { getMinorUnitsPerMajor } from './format'

export function estimateCredits(
  resolvedAmountMajor: number | null,
  currency: string,
  creditsPerMinorUnit?: number | null,
  displayExchangeRate?: number | null,
): number | null {
  if (resolvedAmountMajor == null || resolvedAmountMajor <= 0) return null
  if (creditsPerMinorUnit == null || creditsPerMinorUnit <= 0) return null
  const rate = displayExchangeRate ?? 1
  const resolvedAmountMinor = Math.round(resolvedAmountMajor * getMinorUnitsPerMajor(currency))
  return Math.floor((resolvedAmountMinor / rate) * creditsPerMinorUnit)
}

export function estimateCurrencyMajorFromCredits(
  credits: number | null,
  currency: string,
  creditsPerMinorUnit?: number | null,
  displayExchangeRate?: number | null,
): number | null {
  if (credits == null || credits <= 0) return null
  if (creditsPerMinorUnit == null || creditsPerMinorUnit <= 0) return null
  const rate = displayExchangeRate ?? 1
  const displayMinor = creditsToDisplayMinorUnits({
    credits,
    creditsPerMinorUnit,
    displayExchangeRate: rate,
    displayCurrency: currency,
  })
  if (displayMinor === null) return null
  return displayMinor / getMinorUnitsPerMajor(currency)
}
