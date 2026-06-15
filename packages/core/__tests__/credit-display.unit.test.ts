import { describe, it, expect } from 'vitest'
import {
  creditsToDisplayMinorUnits,
  minorUnitsPerMajor,
} from '../src/credit-display'

describe('creditsToDisplayMinorUnits', () => {
  it('converts 159,600 credits to ~SEK 150.92 at rate 9.46', () => {
    const minor = creditsToDisplayMinorUnits({
      credits: 159_600,
      creditsPerMinorUnit: 100,
      displayExchangeRate: 9.46,
      displayCurrency: 'SEK',
    })
    expect(minor).toBe(15_098)
    expect(minor! / minorUnitsPerMajor('SEK')).toBeCloseTo(150.98, 1)
  })

  it('converts credits to USD minor units when rate is 1', () => {
    const minor = creditsToDisplayMinorUnits({
      credits: 159_600,
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
      displayCurrency: 'USD',
    })
    expect(minor).toBe(1_596)
  })

  it('handles zero-decimal display currencies (JPY)', () => {
    const minor = creditsToDisplayMinorUnits({
      credits: 10_000,
      creditsPerMinorUnit: 100,
      displayExchangeRate: 150,
      displayCurrency: 'JPY',
    })
    expect(minor).toBe(150)
    expect(minorUnitsPerMajor('JPY')).toBe(1)
  })

  it('returns null when creditsPerMinorUnit is missing or zero', () => {
    expect(
      creditsToDisplayMinorUnits({
        credits: 1000,
        creditsPerMinorUnit: 0,
        displayExchangeRate: 1,
        displayCurrency: 'USD',
      }),
    ).toBeNull()
  })
})
