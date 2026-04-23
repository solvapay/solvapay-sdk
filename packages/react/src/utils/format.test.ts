import { describe, it, expect } from 'vitest'
import { formatDate, formatPrice, getMinorUnitsPerMajor, toMajorUnits } from './format'

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

    it('formats GBP whole amount without trailing zeros', () => {
      expect(formatPrice(500, 'gbp', { locale: 'en-GB' })).toBe('£5')
    })

    it('trims trailing zeros on whole SEK amounts', () => {
      // Intl inserts NBSP between the currency code and the number.
      expect(formatPrice(10000, 'sek', { locale: 'en' }).replace(/\u00A0/g, ' ')).toBe(
        'SEK 100',
      )
    })

    it('keeps two decimals on fractional SEK amounts', () => {
      expect(formatPrice(10050, 'sek', { locale: 'en' }).replace(/\u00A0/g, ' ')).toBe(
        'SEK 100.50',
      )
    })

    it('renders sv-SE SEK whole amount without decimals', () => {
      const out = formatPrice(10000, 'sek', { locale: 'sv-SE' })
      expect(out).toContain('100')
      expect(out).not.toContain(',00')
      expect(out.toLowerCase()).toContain('kr')
    })

    it('handles case-insensitive currency codes', () => {
      expect(formatPrice(1000, 'USD')).toBe('$10')
      expect(formatPrice(1000, 'Usd')).toBe('$10')
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
      expect(formatPrice(0, 'usd', { free: '' })).toBe('$0')
    })
  })

  describe('interval suffixes', () => {
    it('appends "/ month" when interval provided', () => {
      expect(formatPrice(999, 'usd', { interval: 'month' })).toBe('$9.99 / month')
    })

    it('appends "/ 3 months" when intervalCount > 1', () => {
      expect(formatPrice(2500, 'usd', { interval: 'month', intervalCount: 3 })).toBe(
        '$25 / 3 months',
      )
    })

    it('appends "/ year" for year interval', () => {
      expect(formatPrice(9900, 'usd', { interval: 'year' })).toBe('$99 / year')
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

describe('formatDate', () => {
  const iso = '2024-03-15T00:00:00Z'

  it('formats an ISO string using the provided locale (medium style)', () => {
    // en-US medium style: "Mar 15, 2024"
    const out = formatDate(iso, 'en-US')
    expect(out).toContain('2024')
    expect(out).toMatch(/Mar/)
  })

  it('renders differently across locales', () => {
    const us = formatDate(iso, 'en-US')
    const jp = formatDate(iso, 'ja-JP')
    expect(us).not.toBe(jp)
  })

  it('accepts a Date instance', () => {
    const out = formatDate(new Date(iso), 'en-US')
    expect(out).toContain('2024')
  })

  it('returns null for nullish inputs', () => {
    expect(formatDate(undefined, 'en-US')).toBeNull()
    expect(formatDate(null, 'en-US')).toBeNull()
    expect(formatDate('', 'en-US')).toBeNull()
  })

  it('returns null for invalid date inputs', () => {
    expect(formatDate('not-a-date', 'en-US')).toBeNull()
  })

  it('honours a custom dateStyle option', () => {
    const medium = formatDate(iso, 'en-US', { dateStyle: 'medium' })
    const long = formatDate(iso, 'en-US', { dateStyle: 'long' })
    expect(medium).not.toBe(long)
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
