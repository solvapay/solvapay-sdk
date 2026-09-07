/**
 * Compact credit labels for preset tiles (`100K credits`, `1M credits`).
 * Used by the MCP top-up amount step so the buyer chooses in credits.
 */
export function formatCompactCredits(credits: number, locale = 'en-US'): string {
  if (!Number.isFinite(credits) || credits < 0) {
    throw new Error(`formatCompactCredits: credits must be a finite non-negative number, got ${credits}`)
  }
  if (credits >= 1_000_000 && credits % 1_000_000 === 0) {
    return `${credits / 1_000_000}M credits`
  }
  if (credits >= 1_000 && credits % 1_000 === 0) {
    return `${credits / 1_000}K credits`
  }
  return `${credits.toLocaleString(locale)} credits`
}
