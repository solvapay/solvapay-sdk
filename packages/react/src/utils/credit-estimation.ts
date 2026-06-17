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
  const minorMultiplier = getMinorUnitsPerMajor(currency)
  const minorUnits = (credits / creditsPerMinorUnit) * rate
  const major = minorUnits / minorMultiplier
  const fractionDigits = Math.max(0, Math.round(Math.log10(minorMultiplier)))
  return Number(major.toFixed(fractionDigits))
}
