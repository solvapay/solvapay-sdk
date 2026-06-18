import { describe, it, expect } from 'vitest'
import {
  displayMajorFromCredits,
  estimateTopupCredits,
  formatCreditCurrencyEquivalent,
  topupDisplayDriftMinorUnits,
} from '../credit-display'

describe('formatCreditCurrencyEquivalent', () => {
  it('formats SEK equivalent using displayExchangeRate', () => {
    const formatted = formatCreditCurrencyEquivalent({
      credits: 31_500,
      displayCurrency: 'SEK',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 9.46,
    })
    expect(formatted).toMatch(/29/)
    expect(formatted).not.toMatch(/3\.15/)
  })

  it('returns null when conversion inputs are invalid', () => {
    expect(
      formatCreditCurrencyEquivalent({
        credits: 1000,
        displayCurrency: 'USD',
        creditsPerMinorUnit: 0,
        displayExchangeRate: 1,
      }),
    ).toBeNull()
  })
})

describe('estimateTopupCredits', () => {
  it('estimates SEK top-up credits with FX rate', () => {
    expect(
      estimateTopupCredits({
        amountCents: 10_000,
        creditsPerMinorUnit: 100,
        displayExchangeRate: 9.46,
      }),
    ).toBe(105_708)
  })

  it('defaults missing rate and cpm', () => {
    expect(
      estimateTopupCredits({
        amountCents: 5_000,
      }),
    ).toBe(500_000)
  })
})

describe('top-up amount matches available display amount', () => {
  const SEK_RATE = 9.46
  const CPM = 100

  it.each([
    { currency: 'SEK', rate: SEK_RATE, amountMajor: 100, amountCents: 10_000 },
    { currency: 'USD', rate: 1, amountMajor: 50, amountCents: 5_000 },
  ])(
    '$currency top-up credits display as the topped-up amount within one minor unit',
    ({ currency, rate, amountMajor, amountCents }) => {
      const credits = estimateTopupCredits({
        amountCents,
        creditsPerMinorUnit: CPM,
        displayExchangeRate: rate,
      })
      const drift = topupDisplayDriftMinorUnits({
        toppedUpAmountMajor: amountMajor,
        credits,
        displayCurrency: currency,
        creditsPerMinorUnit: CPM,
        displayExchangeRate: rate,
      })
      expect(drift).not.toBeNull()
      expect(Math.round(drift! * 100) / 100).toBeLessThanOrEqual(1)
    },
  )

  it('100 SEK topped up is available as ~SEK 100, not the USD mislabel bug (~SEK 10.57)', () => {
    const credits = estimateTopupCredits({
      amountCents: 10_000,
      creditsPerMinorUnit: CPM,
      displayExchangeRate: SEK_RATE,
    })
    const availableMajor = displayMajorFromCredits({
      credits,
      displayCurrency: 'SEK',
      creditsPerMinorUnit: CPM,
      displayExchangeRate: SEK_RATE,
    })
    expect(availableMajor).toBeGreaterThan(99)
    expect(availableMajor).toBeLessThanOrEqual(100)
    expect(availableMajor).not.toBeCloseTo(10.57, 1)
  })

  it('formatted display string reflects the topped-up SEK amount', () => {
    const credits = estimateTopupCredits({
      amountCents: 10_000,
      creditsPerMinorUnit: CPM,
      displayExchangeRate: SEK_RATE,
    })
    const formatted = formatCreditCurrencyEquivalent({
      credits,
      displayCurrency: 'SEK',
      creditsPerMinorUnit: CPM,
      displayExchangeRate: SEK_RATE,
    })
    expect(formatted).toMatch(/100/)
    expect(formatted).not.toMatch(/10\.57/)
  })
})
