import { describe, it, expect } from 'vitest'
import { formatPrice, getMinorUnitsPerMajor, toMajorUnits } from './format'

describe('formatPrice', () => {
  describe('basic formatting', () => {
    it('formats USD amount in minor units', () => {
      expect(formatPrice(1999, 'usd')).toBe('$19.99')
    })

    it('formats EUR with explicit locale', () => {
      // sv-SE uses "space NBSP" and appends kr after the number
      const out = formatPrice(19900, 'sek', { locale: 'sv-SE' })
      expect(out).toContain('199')
      expect(out.toLowerCase()).toContain('kr')
    })

    it('formats GBP', () => {
      expect(formatPrice(500, 'gbp', { locale: 'en-GB' })).toBe('£5.00')
    })

    it('handles case-insensitive currency codes', () => {
      expect(formatPrice(1000, 'USD')).toBe('$10.00')
      expect(formatPrice(1000, 'Usd')).toBe('$10.00')
    })
  })

  describe('zero-decimal currencies', () => {
    it('treats JPY amount as whole units', () => {
      // JPY has 0 fraction digits - 1000 minor units = ¥1000
      expect(formatPrice(1000, 'jpy', { locale: 'en-US' })).toBe('¥1,000')
    })
  })

  describe('free and zero handling', () => {
    it('returns "Free" for zero amount by default', () => {
      expect(formatPrice(0, 'usd')).toBe('Free')
    })

    it('returns the provided free copy verbatim', () => {
      expect(formatPrice(0, 'usd', { free: 'no charge' })).toBe('no charge')
      expect(formatPrice(0, 'usd', { free: 'Gratis' })).toBe('Gratis')
    })

    it('returns empty string when free="" (disabled)', () => {
      expect(formatPrice(0, 'usd', { free: '' })).toBe('$0.00')
    })
  })

  describe('interval suffixes', () => {
    it('appends "/ month" when interval provided', () => {
      expect(formatPrice(999, 'usd', { interval: 'month' })).toBe('$9.99 / month')
    })

    it('appends "/ 3 months" when intervalCount > 1', () => {
      expect(formatPrice(2500, 'usd', { interval: 'month', intervalCount: 3 })).toBe(
        '$25.00 / 3 months',
      )
    })

    it('appends "/ year" for year interval', () => {
      expect(formatPrice(9900, 'usd', { interval: 'year' })).toBe('$99.00 / year')
    })

    it('does not append interval when amount is zero and rendered as Free', () => {
      expect(formatPrice(0, 'usd', { interval: 'month' })).toBe('Free')
    })
  })
})

describe('toMajorUnits', () => {
  it('divides by 100 for two-decimal currencies', () => {
    expect(toMajorUnits(1999, 'usd')).toBe(19.99)
    expect(toMajorUnits(500, 'gbp')).toBe(5)
  })

  it('passes through zero-decimal currencies', () => {
    expect(toMajorUnits(1000, 'jpy')).toBe(1000)
    expect(toMajorUnits(50000, 'krw')).toBe(50000)
  })

  it('is case-insensitive on the currency code', () => {
    expect(toMajorUnits(1000, 'JPY')).toBe(1000)
    expect(toMajorUnits(1000, 'Usd')).toBe(10)
  })
})

describe('getMinorUnitsPerMajor', () => {
  it('returns 100 for two-decimal currencies', () => {
    expect(getMinorUnitsPerMajor('usd')).toBe(100)
    expect(getMinorUnitsPerMajor('EUR')).toBe(100)
  })

  it('returns 1 for zero-decimal currencies', () => {
    expect(getMinorUnitsPerMajor('jpy')).toBe(1)
    expect(getMinorUnitsPerMajor('KRW')).toBe(1)
  })
})
