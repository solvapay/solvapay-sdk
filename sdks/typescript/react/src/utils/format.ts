/**
 * Currency + interval price formatting utilities.
 *
 * `formatPrice` delegates to `@solvapay/core` (Rust). Locale is accepted for
 * call-site compatibility and ignored — grouping is always comma-separated
 * and symbol placement is fixed by the core currency table.
 */

import {
  formatPrice as formatPriceCore,
  minorUnitsPerMajor,
  toMajorUnits as toMajorUnitsCore,
} from '@solvapay/core'

export type FormatPriceOptions = {
  /** Accepted for compatibility; formatting is locale-independent. */
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
  /** `symbol` (default) or `code` (e.g. USD 10 instead of $10). */
  currencyDisplay?: 'symbol' | 'code'
}

/**
 * Number of minor units per one major unit of `currency`. 1 for zero-decimal
 * currencies (JPY, KRW, …), 100 for everything else. Use this to convert
 * between the units a user types (major, e.g. dollars) and the units Stripe
 * and the SolvaPay API consume (minor, e.g. cents).
 */
export function getMinorUnitsPerMajor(currency: string): number {
  return minorUnitsPerMajor(currency)
}

/**
 * Convert a minor-unit amount to its major-unit equivalent. Zero-decimal
 * currencies pass through unchanged (1000 JPY minor = 1000 JPY major);
 * two-decimal currencies divide by 100 (1999 USD minor = 19.99 USD).
 */
export function toMajorUnits(amountMinor: number, currency: string): number {
  return toMajorUnitsCore(amountMinor, currency)
}

export function formatPrice(
  amountMinor: number,
  currency: string,
  opts: FormatPriceOptions = {},
): string {
  const { interval, intervalCount, free, currencyDisplay } = opts
  return formatPriceCore(amountMinor, currency, interval, intervalCount, free, currencyDisplay)
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
