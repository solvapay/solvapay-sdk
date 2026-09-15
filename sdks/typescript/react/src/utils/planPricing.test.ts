import { describe, it, expect } from 'vitest'
import { getPlanPricingOptions, resolvePlanPricingOption } from './planPricing'
import type { PricedPlanLike } from './planPricing'

const flat = (amountMinor: number, currency: string) => ({
  kind: 'charge' as const,
  per: 'flat' as const,
  amountMinor,
  currency,
})

/**
 * A multi-currency plan as the backend actually sends it: one flat
 * charge per currency inside `options[]`, with the top-level `currency`
 * naming the default. There is no `pricingOptions` array on the wire.
 */
const multiCurrencyPlan: PricedPlanLike = {
  price: 1000,
  currency: 'USD',
  options: [flat(1000, 'usd'), flat(900, 'eur')],
}

describe('planPricing', () => {
  it('derives one option per currency from the charges in options[]', () => {
    expect(getPlanPricingOptions(multiCurrencyPlan)).toEqual([
      { currency: 'usd', price: 1000, default: true },
      { currency: 'eur', price: 900, default: false },
    ])
  })

  it('resolves the requested currency option', () => {
    expect(resolvePlanPricingOption(multiCurrencyPlan, 'EUR')).toEqual({
      currency: 'eur',
      price: 900,
      default: false,
    })
  })

  it('falls back to the default currency option when the request has no match', () => {
    expect(resolvePlanPricingOption(multiCurrencyPlan, 'SEK')).toEqual({
      currency: 'usd',
      price: 1000,
      default: true,
    })
  })

  it('honours a consumer-supplied pricingOptions array ahead of options[]', () => {
    // Not a wire shape — an integrator plugging in plans through a
    // custom fetcher can still shape pricing directly.
    expect(
      getPlanPricingOptions({
        price: 1000,
        currency: 'USD',
        pricingOptions: [{ currency: 'GBP', price: 800, default: true }],
        options: [flat(1000, 'usd')],
      }),
    ).toEqual([{ currency: 'GBP', price: 800, default: true }])
  })

  it('falls back to the scalar price and currency for a plan with no charges', () => {
    expect(getPlanPricingOptions({ price: 2500, currency: 'GBP' })).toEqual([
      { currency: 'GBP', price: 2500, default: true },
    ])
  })
})
