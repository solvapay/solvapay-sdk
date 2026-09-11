import { creditsToDisplayMinorUnits, minorUnitsPerMajor } from '@solvapay/core'

export function formatCreditCurrencyEquivalent(input: {
  credits: number
  displayCurrency: string
  creditsPerMinorUnit: number
  displayExchangeRate?: number | null
}): string | null {
  const displayMinor = creditsToDisplayMinorUnits({
    credits: input.credits,
    creditsPerMinorUnit: input.creditsPerMinorUnit,
    displayExchangeRate: input.displayExchangeRate ?? 1,
    displayCurrency: input.displayCurrency,
  })
  if (displayMinor === null) return null
  const minorPerMajor = minorUnitsPerMajor(input.displayCurrency)
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: input.displayCurrency,
    minimumFractionDigits: minorPerMajor === 1 ? 0 : 2,
  }).format(displayMinor / minorPerMajor)
}

export function estimateTopupCredits(input: {
  amountCents: number
  creditsPerMinorUnit?: number | null
  displayExchangeRate?: number | null
}): number {
  const rate = input.displayExchangeRate ?? 1
  const cpm = input.creditsPerMinorUnit ?? 100
  return Math.floor((input.amountCents / rate) * cpm)
}

/** Credits balance expressed in major units of the display currency. */
export function displayMajorFromCredits(input: {
  credits: number
  displayCurrency: string
  creditsPerMinorUnit: number
  displayExchangeRate?: number | null
}): number | null {
  const displayMinor = creditsToDisplayMinorUnits({
    credits: input.credits,
    creditsPerMinorUnit: input.creditsPerMinorUnit,
    displayExchangeRate: input.displayExchangeRate ?? 1,
    displayCurrency: input.displayCurrency,
  })
  if (displayMinor === null) return null
  return displayMinor / minorUnitsPerMajor(input.displayCurrency)
}

/** Drift between topped-up amount and what those credits display as, in minor units. */
export function topupDisplayDriftMinorUnits(input: {
  toppedUpAmountMajor: number
  credits: number
  displayCurrency: string
  creditsPerMinorUnit: number
  displayExchangeRate?: number | null
}): number | null {
  const displayedMajor = displayMajorFromCredits({
    credits: input.credits,
    displayCurrency: input.displayCurrency,
    creditsPerMinorUnit: input.creditsPerMinorUnit,
    displayExchangeRate: input.displayExchangeRate,
  })
  if (displayedMajor === null) return null
  const minorPerMajor = minorUnitsPerMajor(input.displayCurrency)
  return Math.abs(displayedMajor - input.toppedUpAmountMajor) * minorPerMajor
}
