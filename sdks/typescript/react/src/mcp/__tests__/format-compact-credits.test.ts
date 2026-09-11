import { describe, expect, it } from 'vitest'
import { formatCompactCredits } from '../format-compact-credits'

describe('formatCompactCredits', () => {
  it('uses K and M for exact thousands and millions', () => {
    expect(formatCompactCredits(100_000)).toBe('100K credits')
    expect(formatCompactCredits(1_000_000)).toBe('1M credits')
    expect(formatCompactCredits(5_000_000)).toBe('5M credits')
  })

  it('falls back to a locale grouping for amounts that are not exact thousands', () => {
    expect(formatCompactCredits(1500, 'en-US')).toBe('1,500 credits')
    expect(formatCompactCredits(42, 'en-US')).toBe('42 credits')
  })

  it('throws when credits is not a usable number', () => {
    expect(() => formatCompactCredits(Number.NaN)).toThrow(/finite non-negative/)
    expect(() => formatCompactCredits(-1)).toThrow(/finite non-negative/)
  })
})
