import { describe, expect, it } from 'vitest'
import {
  billingCycle,
  countsUsage,
  creditsPerUnitFromBalance,
  headlineCharges,
  includedUnits,
  meterName,
  peggedCreditsPerUnit,
  perUnitCharge,
  trialDays,
} from './pricing-options'

/**
 * Fixtures are verbatim `options[]` from `GET /v1/sdk/products/:ref/plans`
 * against a live stack — not hand-written shapes. The bug these readers
 * replace was a plan type invented in the SDK that no wire ever sent.
 */
const freePlan = {
  type: 'recurring',
  reference: 'pln_WHN92N9N',
  name: 'Free',
  requiresPayment: false,
  price: 0,
  currency: 'USD',
  options: [
    { kind: 'billingCycle', interval: 'month' },
    { kind: 'charge', per: 'flat', amountMinor: 0, currency: 'usd' },
    { kind: 'charge', per: 'unit', amountMinor: 0, currency: 'usd', meter: 'requests' },
    { kind: 'limit', cap: 3, scope: 'billing_period', meter: 'requests', onExceed: 'block' },
    { kind: 'autoAssigned' },
  ],
}

const proPlan = {
  type: 'recurring',
  reference: 'pln_5Y886LGR',
  name: 'Pro',
  requiresPayment: true,
  price: 3000,
  currency: 'USD',
  options: [
    { kind: 'billingCycle', interval: 'month' },
    { kind: 'charge', per: 'flat', amountMinor: 3000, currency: 'usd' },
  ],
}

const paygPlan = {
  type: 'usage-based',
  reference: 'pln_AE3A91MU',
  name: 'Pay as you go',
  requiresPayment: true,
  currency: 'USD',
  options: [
    { kind: 'charge', per: 'unit', amountMinor: 2, currency: 'usd', meter: 'requests' },
    { kind: 'autoAssigned' },
  ],
}

const usdBalance = { displayCurrency: 'USD', displayExchangeRate: 1, creditsPerMinorUnit: 100 }

describe('billingCycle', () => {
  it('reads the interval off the billingCycle option', () => {
    expect(billingCycle(proPlan)).toEqual({ interval: 'month' })
  })

  it('returns null for a plan with no billing cycle', () => {
    expect(billingCycle(paygPlan)).toBeNull()
  })

  it('keeps a multi-interval count', () => {
    expect(
      billingCycle({ options: [{ kind: 'billingCycle', interval: 'month', count: 3 }] }),
    ).toEqual({ interval: 'month', count: 3 })
  })

  it('omits an explicit count of 1, which is the default', () => {
    expect(
      billingCycle({ options: [{ kind: 'billingCycle', interval: 'year', count: 1 }] }),
    ).toEqual({ interval: 'year' })
  })
})

describe('headlineCharges', () => {
  it('returns the single flat charge for a single-currency plan', () => {
    expect(headlineCharges(proPlan)).toEqual([{ per: 'flat', amountMinor: 3000, currency: 'usd' }])
  })

  it('lists one charge per currency for a multi-currency plan', () => {
    const multi = {
      options: [
        { kind: 'billingCycle', interval: 'month' },
        { kind: 'charge', per: 'flat', amountMinor: 1000, currency: 'usd' },
        { kind: 'charge', per: 'flat', amountMinor: 900, currency: 'eur' },
      ],
    }
    expect(headlineCharges(multi).map(c => [c.currency, c.amountMinor])).toEqual([
      ['usd', 1000],
      ['eur', 900],
    ])
  })

  it('excludes a setup fee when a base charge exists', () => {
    const withSetup = {
      options: [
        { kind: 'billingCycle', interval: 'month' },
        { kind: 'charge', per: 'flat', amountMinor: 2900, currency: 'usd' },
        { kind: 'charge', per: 'flat', amountMinor: 5000, currency: 'usd', oneTime: true },
      ],
    }
    expect(headlineCharges(withSetup)).toEqual([
      { per: 'flat', amountMinor: 2900, currency: 'usd' },
    ])
  })

  it('is empty for a pure usage-based plan, which carries no flat charge', () => {
    expect(headlineCharges(paygPlan)).toEqual([])
  })
})

describe('perUnitCharge', () => {
  it('finds the metered charge', () => {
    expect(perUnitCharge(paygPlan)).toEqual({
      per: 'unit',
      amountMinor: 2,
      currency: 'usd',
      meter: 'requests',
    })
  })

  it('returns null when the plan has no meter', () => {
    expect(perUnitCharge(proPlan)).toBeNull()
  })

  it('scopes to a named meter', () => {
    expect(perUnitCharge(paygPlan, 'tokens')).toBeNull()
    expect(perUnitCharge(paygPlan, 'requests')?.amountMinor).toBe(2)
  })
})

describe('meterName', () => {
  it('reads the meter off a per-unit charge', () => {
    expect(meterName(paygPlan)).toBe('requests')
  })

  it('falls back to the limit option when there is no per-unit charge', () => {
    const allowanceOnly = {
      options: [
        { kind: 'billingCycle', interval: 'month' },
        { kind: 'charge', per: 'flat', amountMinor: 0, currency: 'usd' },
        { kind: 'limit', cap: 3, scope: 'billing_period', meter: 'tokens', onExceed: 'block' },
      ],
    }
    expect(perUnitCharge(allowanceOnly)).toBeNull()
    expect(meterName(allowanceOnly)).toBe('tokens')
  })

  it('returns null when no option names a meter', () => {
    expect(meterName(proPlan)).toBeNull()
  })
})

describe('countsUsage', () => {
  it('is true for a per-unit charge or a bare limit', () => {
    expect(countsUsage(paygPlan)).toBe(true)
    expect(countsUsage(freePlan)).toBe(true)
    expect(
      countsUsage({
        options: [
          { kind: 'billingCycle', interval: 'month' },
          { kind: 'charge', per: 'flat', amountMinor: 0, currency: 'usd' },
          { kind: 'limit', cap: 3, scope: 'billing_period', meter: 'tokens', onExceed: 'block' },
        ],
      }),
    ).toBe(true)
  })

  it('is false for a flat recurring plan with no limit', () => {
    expect(countsUsage(proPlan)).toBe(false)
  })
})

describe('includedUnits', () => {
  it('reads the cap off the limit option', () => {
    expect(includedUnits(freePlan)).toBe(3)
  })

  it('preserves cap 0, which the backend uses for unlimited', () => {
    expect(
      includedUnits({
        options: [
          { kind: 'limit', cap: 0, scope: 'billing_period', meter: 'requests', onExceed: 'block' },
        ],
      }),
    ).toBe(0)
  })

  it('returns null when no limit is configured', () => {
    expect(includedUnits(proPlan)).toBeNull()
  })
})

describe('trialDays', () => {
  it('reads a trial option', () => {
    expect(trialDays({ options: [{ kind: 'trial', days: 14, onEnd: 'convert' }] })).toBe(14)
  })

  it('returns null for a plan with no trial', () => {
    expect(trialDays(proPlan)).toBeNull()
  })
})

describe('peggedCreditsPerUnit', () => {
  // Matches the backend's credit-conversion helper term for term; the two
  // diverging is what DEV-691 was.
  it('converts a USD charge at parity', () => {
    expect(peggedCreditsPerUnit(2, 100, 1)).toBe(200)
  })

  it('divides by the USD to charge-currency rate', () => {
    expect(peggedCreditsPerUnit(100, 100, 9.46)).toBe(1057)
  })

  it('is zero for a free meter', () => {
    expect(peggedCreditsPerUnit(0, 100, 1)).toBe(0)
  })
})

describe('creditsPerUnitFromBalance', () => {
  it('prices a metered call against a matching-currency balance', () => {
    expect(creditsPerUnitFromBalance(paygPlan, usdBalance)).toBe(200)
  })

  it('applies the balance exchange rate', () => {
    const sekPlan = {
      options: [
        { kind: 'charge', per: 'unit', amountMinor: 100, currency: 'sek', meter: 'requests' },
      ],
    }
    const sekBalance = {
      displayCurrency: 'SEK',
      displayExchangeRate: 9.46,
      creditsPerMinorUnit: 100,
    }
    expect(creditsPerUnitFromBalance(sekPlan, sekBalance)).toBe(1057)
  })

  it('refuses to price when the charge currency is not the balance currency', () => {
    // The balance carries resolveDisplayFx(provider.defaultCurrency); using it
    // for a differently denominated charge would be wrong by the FX ratio.
    const eurPlan = {
      options: [
        { kind: 'charge', per: 'unit', amountMinor: 2, currency: 'eur', meter: 'requests' },
      ],
    }
    expect(creditsPerUnitFromBalance(eurPlan, usdBalance)).toBeNull()
  })

  it('returns null for a zero-rate meter, which costs no credits', () => {
    expect(creditsPerUnitFromBalance(freePlan, usdBalance)).toBeNull()
  })

  it('returns null without a balance to peg against', () => {
    expect(creditsPerUnitFromBalance(paygPlan, null)).toBeNull()
  })

  it('returns null for an unmetered plan', () => {
    expect(creditsPerUnitFromBalance(proPlan, usdBalance)).toBeNull()
  })
})
