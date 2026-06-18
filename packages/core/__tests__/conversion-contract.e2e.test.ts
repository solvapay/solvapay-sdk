import { describe, it, expect } from 'vitest'
import {
  creditsToDisplayMinorUnits,
  minorUnitsPerMajor,
} from '../src/credit-display'
import {
  estimateCredits,
  estimateCurrencyMajorFromCredits,
} from '../../react/src/utils/credit-estimation'

const CPM = 100

function minorUnitsToCredits(minorUnits: number): number {
  return Math.round(minorUnits * CPM)
}
const SEK_RATE = 9.46
const EUR_RATE = 0.92
const JPY_RATE = 150

/** Mirrors payment-intent-create.flow USD-cent rounding before mint. */
function mintCreditsFromTopup(
  amountMajor: number,
  currency: string,
  displayExchangeRate: number,
  creditsPerMinorUnit: number,
): number {
  const minorPerMajor = minorUnitsPerMajor(currency)
  const chargeMinor = Math.round(amountMajor * minorPerMajor)
  const usdMinor =
    currency.toUpperCase() === 'USD'
      ? chargeMinor
      : Math.round((amountMajor / displayExchangeRate) * 100)
  return minorUnitsToCredits(usdMinor)
}

function displayMajorFromCredits(
  credits: number,
  currency: string,
  displayExchangeRate: number,
  creditsPerMinorUnit: number,
): number {
  const displayMinor = creditsToDisplayMinorUnits({
    credits,
    creditsPerMinorUnit,
    displayExchangeRate,
    displayCurrency: currency,
  })
  if (displayMinor === null) return NaN
  return displayMinor / minorUnitsPerMajor(currency)
}

describe('conversion contract round-trip', () => {
  it.each([
    { currency: 'USD', rate: 1, amount: 100 },
    { currency: 'SEK', rate: SEK_RATE, amount: 100 },
    { currency: 'EUR', rate: EUR_RATE, amount: 50 },
    { currency: 'JPY', rate: JPY_RATE, amount: 500 },
  ])(
    '$currency top-up round-trips within one minor unit',
    ({ currency, rate, amount }) => {
      const credits = mintCreditsFromTopup(amount, currency, rate, CPM)
      const displayedMajor = displayMajorFromCredits(credits, currency, rate, CPM)
      const minorPerMajor = minorUnitsPerMajor(currency)
      const driftMinor = Math.abs(displayedMajor - amount) * minorPerMajor
      expect(Math.round(driftMinor * 100) / 100).toBeLessThanOrEqual(1)
    },
  )

  it('estimateCredits stays within a few credits of backend mint for SEK', () => {
    const estimate = estimateCredits(100, 'SEK', CPM, SEK_RATE)!
    const minted = mintCreditsFromTopup(100, 'SEK', SEK_RATE, CPM)
    expect(Math.abs(estimate - minted)).toBeLessThanOrEqual(10)
  })

  it('100 SEK top-up displays ~SEK 100, not USD value mislabeled as SEK', () => {
    const credits = mintCreditsFromTopup(100, 'SEK', SEK_RATE, CPM)
    const displayedMajor = displayMajorFromCredits(credits, 'SEK', SEK_RATE, CPM)
    expect(displayedMajor).toBeGreaterThan(90)
    expect(displayedMajor).toBeLessThan(101)
    expect(displayedMajor).not.toBeCloseTo(10.57, 1)
  })

  it('cross-checks creditsToDisplayMinorUnits with estimateCurrencyMajorFromCredits', () => {
    const input = {
      credits: 105_700,
      creditsPerMinorUnit: CPM,
      displayExchangeRate: SEK_RATE,
      displayCurrency: 'SEK',
    }
    const fromDisplay = creditsToDisplayMinorUnits(input)! / minorUnitsPerMajor('SEK')
    const fromEstimate = estimateCurrencyMajorFromCredits(
      input.credits,
      input.displayCurrency,
      input.creditsPerMinorUnit,
      input.displayExchangeRate,
    )!
    expect(fromDisplay).toBeCloseTo(fromEstimate, 2)
  })

  it('defaults undefined rate to 1 in estimate path', () => {
    expect(estimateCredits(10, 'USD', CPM, undefined)).toBe(100_000)
  })

  it('handles tiny 1-minor-unit top-ups without NaN', () => {
    const credits = mintCreditsFromTopup(0.01, 'USD', 1, CPM)
    expect(Number.isFinite(credits)).toBe(true)
    expect(credits).toBeGreaterThan(0)
  })
})

describe('topped-up amount equals available display amount', () => {
  it.each([
    { currency: 'SEK', rate: SEK_RATE, amount: 100 },
    { currency: 'USD', rate: 1, amount: 100 },
    { currency: 'EUR', rate: EUR_RATE, amount: 50 },
    { currency: 'JPY', rate: JPY_RATE, amount: 500 },
  ])(
    '$currency: minted credits after top-up display as the paid amount',
    ({ currency, rate, amount }) => {
      const credits = mintCreditsFromTopup(amount, currency, rate, CPM)
      const availableMajor = displayMajorFromCredits(credits, currency, rate, CPM)
      const minorPerMajor = minorUnitsPerMajor(currency)
      const driftMinor = Math.abs(availableMajor - amount) * minorPerMajor
      expect(Math.round(driftMinor * 100) / 100).toBeLessThanOrEqual(1)
    },
  )

  it('optimistic SEK estimate credits display as the topped-up amount', () => {
    const estimate = estimateCredits(100, 'SEK', CPM, SEK_RATE)!
    const availableMajor = estimateCurrencyMajorFromCredits(
      estimate,
      'SEK',
      CPM,
      SEK_RATE,
    )
    expect(availableMajor).toBeGreaterThan(99)
    expect(availableMajor).toBeLessThanOrEqual(100)
  })
})
