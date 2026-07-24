import { describe, it, expect } from 'vitest'
import {
  creditsToDisplayMinorUnits,
  minorUnitsPerMajor,
} from '../src/native-core'

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

  it('returns zero minor units for zero credits', () => {
    expect(
      creditsToDisplayMinorUnits({
        credits: 0,
        creditsPerMinorUnit: 100,
        displayExchangeRate: 9.46,
        displayCurrency: 'SEK',
      }),
    ).toBe(0)
  })

  it('preserves sign for negative credits', () => {
    const minor = creditsToDisplayMinorUnits({
      credits: -10_000,
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
      displayCurrency: 'USD',
    })
    expect(minor).toBe(-100)
  })

  it('converts credits to EUR minor units', () => {
    const minor = creditsToDisplayMinorUnits({
      credits: 100_000,
      creditsPerMinorUnit: 100,
      displayExchangeRate: 0.92,
      displayCurrency: 'EUR',
    })
    expect(minor).toBe(Math.round((100_000 / 100 / 100) * 0.92 * 100))
  })

  it('rounds half-up at x.5 minor-unit boundaries', () => {
    const minor = creditsToDisplayMinorUnits({
      credits: 5_250,
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
      displayCurrency: 'USD',
    })
    expect(minor).toBe(53)
  })

  it('handles large credit balances as exact integers', () => {
    const minor = creditsToDisplayMinorUnits({
      credits: 100_000_000,
      creditsPerMinorUnit: 100,
      displayExchangeRate: 9.46,
      displayCurrency: 'SEK',
    })
    expect(Number.isInteger(minor)).toBe(true)
    expect(minor).toBeGreaterThan(0)
  })
})
