/**
 * Compact credit labels for preset tiles (`100K credits`, `1M credits`).
 * Delegates to `@solvapay/core` — locale is ignored (grouping is locale-independent).
 */
import { formatCompactCredits as formatCompactCreditsCore } from '@solvapay/core'

export function formatCompactCredits(credits: number, _locale = 'en-US'): string {
  if (!Number.isFinite(credits) || credits < 0) {
    throw new Error(
      `formatCompactCredits: credits must be a finite non-negative number, got ${credits}`,
    )
  }
  const result = formatCompactCreditsCore(credits)
  if (typeof result === 'string') return result
  const details =
    result && typeof result === 'object' && 'details' in result
      ? String((result as { details: unknown }).details)
      : 'formatCompactCredits failed'
  throw new Error(details)
}
