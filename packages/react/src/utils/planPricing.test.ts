import { describe, it, expect } from 'vitest'
import { getPlanPricingOptions, resolvePlanPricingOption } from './planPricing'
import type { Plan } from '../types'

const multiCurrencyPlan: Plan = {
  reference: 'pln_multi',
  price: 1000,
  currency: 'USD',
  pricingOptions: [
    { currency: 'USD', price: 1000, default: true },
    { currency: 'EUR', price: 900 },
  ],
}

describe('planPricing', () => {
  it('falls back to legacy price and currency when pricingOptions are absent', () => {
    expect(getPlanPricingOptions({ reference: 'pln_legacy', price: 2500, currency: 'GBP' })).toEqual([
      { currency: 'GBP', price: 2500, default: true },
    ])
  })

  it('resolves the requested currency option', () => {
    expect(resolvePlanPricingOption(multiCurrencyPlan, 'EUR')).toEqual({
      currency: 'EUR',
      price: 900,
    })
  })
})
