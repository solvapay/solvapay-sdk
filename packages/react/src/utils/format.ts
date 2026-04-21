/**
 * Currency + interval price formatting utilities.
 *
 * `formatPrice` renders a minor-unit amount with `Intl.NumberFormat`, handling
 * locale, symbol placement, zero-decimal currencies (JPY, KRW, ...), and an
 * optional trailing interval suffix ("/ month", "/ 3 months").
 */

export type FormatPriceOptions = {
  /** BCP-47 locale tag. Falls back to the runtime default. */
  locale?: string
  /** Recurring interval unit in English. Localize via the copy bundle if needed. */
  interval?: string
  /** How many of `interval` per billing cycle. Defaults to 1. */
  intervalCount?: number
  /**
   * Copy used when `amountMinor` is 0. Defaults to `'Free'`.
   * Pass `''` to disable the zero-check and always render the numeric zero.
   */
  free?: string
}

const ZERO_DECIMAL_CURRENCIES = new Set([
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

function getFractionDigits(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase()) ? 0 : 2
}

/**
 * Number of minor units per one major unit of `currency`. 1 for zero-decimal
 * currencies (JPY, KRW, …), 100 for everything else. Use this to convert
 * between the units a user types (major, e.g. dollars) and the units Stripe
 * and the SolvaPay API consume (minor, e.g. cents).
 */
export function getMinorUnitsPerMajor(currency: string): number {
  return getFractionDigits(currency) === 0 ? 1 : 100
}

function toMajorUnits(amountMinor: number, currency: string): number {
  const fractionDigits = getFractionDigits(currency)
  return fractionDigits === 0 ? amountMinor : amountMinor / 100
}

export function formatPrice(
  amountMinor: number,
  currency: string,
  opts: FormatPriceOptions = {},
): string {
  const { locale, interval, intervalCount = 1, free = 'Free' } = opts

  if (amountMinor === 0 && free !== '') {
    return free
  }

  const fractionDigits = getFractionDigits(currency)
  const major = toMajorUnits(amountMinor, currency)

  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })

  const formatted = formatter.format(major)

  if (!interval) return formatted

  const suffix =
    intervalCount > 1 ? `${intervalCount} ${interval}s` : interval
  return `${formatted} / ${suffix}`
}
