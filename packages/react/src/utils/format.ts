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

/**
 * Convert a minor-unit amount to its major-unit equivalent. Zero-decimal
 * currencies pass through unchanged (1000 JPY minor = 1000 JPY major);
 * two-decimal currencies divide by 100 (1999 USD minor = 19.99 USD).
 */
export function toMajorUnits(amountMinor: number, currency: string): number {
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

/**
 * Locale-aware date formatter. Thin wrapper over `Intl.DateTimeFormat`
 * so MCP views can share one call pattern for renewal / usage-reset
 * dates instead of each view hand-rolling `toLocaleDateString`.
 *
 * Returns `null` for nullish, empty, or invalid inputs so callers can
 * conditionally render without an extra guard.
 *
 * Defaults to `{ dateStyle: 'medium' }` to match the spec-recommended
 * "short but readable" rendering (`Mar 15, 2024`). Pass a different
 * `dateStyle` / options bag to override.
 */
export function formatDate(
  value: Date | string | null | undefined,
  locale?: string,
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(locale, opts).format(date)
}
