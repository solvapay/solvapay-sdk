/**
 * Shared credit → fiat conversion for MCP bootstrap narration and React
 * balance surfaces. Backend contract: `credits = USD_cents × creditsPerMinorUnit`
 * (mint scale; `creditsPerMinorUnit` is typically 100), and
 * `displayExchangeRate` is USD → display currency (e.g. 9.46 for SEK).
 */

const ZERO_DECIMAL = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
])

export function minorUnitsPerMajor(currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? 1 : 100
}

export function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL.has(currency.toLowerCase())
}

/** Fiat value of a credit balance, in MINOR units of `displayCurrency`. */
export function creditsToDisplayMinorUnits(input: {
  credits: number
  creditsPerMinorUnit: number
  displayExchangeRate: number
  displayCurrency: string
}): number | null {
  const { credits, creditsPerMinorUnit, displayExchangeRate, displayCurrency } = input
  if (!creditsPerMinorUnit || creditsPerMinorUnit <= 0) return null
  const usdMajor = credits / creditsPerMinorUnit / 100
  return Math.round(
    usdMajor * (displayExchangeRate || 1) * minorUnitsPerMajor(displayCurrency),
  )
}
