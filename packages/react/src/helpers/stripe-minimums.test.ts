import { describe, it, expect } from 'vitest'
import { getStripeMinimumMinor } from './stripe-minimums'

describe('getStripeMinimumMinor', () => {
  // Values mirror the backend source of truth
  // (solvapay-backend/src/billing/credits/lib/stripe-minimum-charge.ts). If the
  // backend table changes, update both in lockstep — this test guards drift.
  it.each([
    ['USD', 50],
    ['EUR', 50],
    ['GBP', 30],
    ['SEK', 300],
    ['NOK', 300],
    ['DKK', 250],
    ['CHF', 50],
    ['CAD', 50],
    ['AUD', 50],
    ['JPY', 50],
    ['KRW', 500],
  ])('returns the Stripe minimum for %s', (currency, expected) => {
    expect(getStripeMinimumMinor(currency)).toBe(expected)
  })

  it('is case-insensitive', () => {
    expect(getStripeMinimumMinor('sek')).toBe(300)
  })

  it('falls back to the default minimum for an unknown currency', () => {
    expect(getStripeMinimumMinor('XYZ')).toBe(50)
  })
})
