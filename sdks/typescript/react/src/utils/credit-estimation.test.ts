import { describe, it, expect } from 'vitest'
import { estimateCredits, estimateCurrencyMajorFromCredits } from './credit-estimation'

const CPM = 100
const SEK_RATE = 9.46
const JPY_RATE = 150

describe('estimateCredits', () => {
  it('converts 10 USD to 100000 credits at rate 1', () => {
    expect(estimateCredits(10, 'USD', CPM, 1)).toBe(100_000)
  })

  it('converts 100 SEK to credits using displayExchangeRate', () => {
    expect(estimateCredits(100, 'SEK', CPM, SEK_RATE)).toBe(Math.round((10_000 / SEK_RATE) * CPM))
    expect(estimateCredits(100, 'SEK', CPM, SEK_RATE)).toBe(105_708)
  })

  it('converts 500 JPY using zero-decimal minor units', () => {
    expect(estimateCredits(500, 'JPY', CPM, JPY_RATE)).toBe(Math.round((500 / JPY_RATE) * CPM))
    expect(estimateCredits(500, 'JPY', CPM, JPY_RATE)).toBe(333)
  })

  it('rounds fractional major amounts to minor units before estimating credits', () => {
    expect(estimateCredits(19.99, 'USD', CPM, 1)).toBe(199_900)
    expect(estimateCredits(19.999, 'USD', CPM, 1)).toBe(200_000)
  })

  it('returns null for invalid amount inputs', () => {
    expect(estimateCredits(null, 'USD', CPM, 1)).toBeNull()
    expect(estimateCredits(0, 'USD', CPM, 1)).toBeNull()
    expect(estimateCredits(-1, 'USD', CPM, 1)).toBeNull()
  })

  it('returns null for invalid creditsPerMinorUnit inputs', () => {
    expect(estimateCredits(10, 'USD', null, 1)).toBeNull()
    expect(estimateCredits(10, 'USD', 0, 1)).toBeNull()
    expect(estimateCredits(10, 'USD', -1, 1)).toBeNull()
  })

  it('defaults displayExchangeRate to 1 when null or undefined', () => {
    expect(estimateCredits(10, 'USD', CPM, null)).toBe(100_000)
    expect(estimateCredits(10, 'USD', CPM, undefined)).toBe(100_000)
  })

  it('handles large USD amounts without float drift', () => {
    expect(estimateCredits(1_000_000, 'USD', CPM, 1)).toBe(10_000_000_000)
  })

  it('rounds credits at fractional boundaries (symmetric with credits→currency)', () => {
    const result = estimateCredits(1, 'SEK', CPM, 3)
    expect(result).toBe(Math.round((100 / 3) * CPM))
    expect(result).toBe(3333)
  })

  it('uses Math.round not Math.floor for currency→credits (DEV-591)', () => {
    // 0.02 USD @ rate 3 → 2 minor / 3 * 100 = 66.67 → round = 67, floor = 66
    expect(estimateCredits(0.02, 'USD', CPM, 3)).toBe(67)
  })
})

describe('estimateCurrencyMajorFromCredits', () => {
  it('converts credits back to USD major at rate 1', () => {
    expect(estimateCurrencyMajorFromCredits(100_000, 'USD', CPM, 1)).toBe(10)
  })

  it('converts credits back to SEK major using displayExchangeRate', () => {
    const credits = estimateCredits(100, 'SEK', CPM, SEK_RATE)!
    const major = estimateCurrencyMajorFromCredits(credits, 'SEK', CPM, SEK_RATE)
    expect(major).toBeCloseTo(100, 0)
  })

  it('returns whole-yen major for JPY', () => {
    const credits = estimateCredits(500, 'JPY', CPM, JPY_RATE)!
    const major = estimateCurrencyMajorFromCredits(credits, 'JPY', CPM, JPY_RATE)
    expect(major).toBe(Math.round(major!))
    expect(Number.isInteger(major)).toBe(true)
  })

  it('returns null for invalid credit inputs', () => {
    expect(estimateCurrencyMajorFromCredits(null, 'USD', CPM, 1)).toBeNull()
    expect(estimateCurrencyMajorFromCredits(0, 'USD', CPM, 1)).toBeNull()
    expect(estimateCurrencyMajorFromCredits(-100, 'USD', CPM, 1)).toBeNull()
  })

  it('returns null for invalid creditsPerMinorUnit inputs', () => {
    expect(estimateCurrencyMajorFromCredits(1000, 'USD', null, 1)).toBeNull()
    expect(estimateCurrencyMajorFromCredits(1000, 'USD', 0, 1)).toBeNull()
  })
})

describe('estimateCredits round-trip invariant', () => {
  const amounts = [1, 10, 50, 100, 500, 999.99]

  it.each(amounts)(
    'SEK amount %i round-trips within one minor unit via estimate helpers',
    amount => {
      const credits = estimateCredits(amount, 'SEK', CPM, SEK_RATE)
      expect(credits).not.toBeNull()
      const major = estimateCurrencyMajorFromCredits(credits, 'SEK', CPM, SEK_RATE)
      expect(major).not.toBeNull()
      expect(Math.abs(major! - amount)).toBeLessThanOrEqual(0.01)
    },
  )
})
