/**
 * Unit tests for the pure helpers in `shared.ts`. The integration of
 * `buildDefaultCheckoutPlanFilter` into `<CheckoutSteps.Root>` and
 * `<PaywallNotice.EmbeddedCheckout>` is exercised by the part-level
 * tests; this file pins the filter's matrix in isolation.
 */

import { describe, expect, it } from 'vitest'
import { buildDefaultCheckoutPlanFilter, formatPaygRate, planMeterName } from './shared'
import type { Plan } from '../../types'

/**
 * Fixtures mirror `GET /v1/sdk/products/:ref/plans`: pricing lives in
 * `options[]`, and there is no `creditsPerUnit` scalar. The previous
 * fixtures set one, which let `formatPaygRate` pass while reading a
 * field the backend never sends.
 */
const cycle = (interval = 'month') => ({ kind: 'billingCycle' as const, interval })
const flat = (amountMinor: number, currency = 'usd') => ({
  kind: 'charge' as const,
  per: 'flat' as const,
  amountMinor,
  currency,
})
const perUnit = (amountMinor: number, currency = 'usd', meter = 'requests') => ({
  kind: 'charge' as const,
  per: 'unit' as const,
  amountMinor,
  currency,
  meter,
})

const usdBalance = { displayCurrency: 'USD', displayExchangeRate: 1, creditsPerMinorUnit: 100 }

const free: Plan = {
  reference: 'pln_free',
  name: 'Free',
  price: 0,
  currency: 'usd',
  requiresPayment: false,
  type: 'recurring',
  options: [cycle()],
}

const payg: Plan = {
  reference: 'pln_payg',
  name: 'Pay as you go',
  currency: 'usd',
  requiresPayment: true,
  type: 'usage-based',
  options: [perUnit(2)],
}

const recurring: Plan = {
  reference: 'pln_pro',
  name: 'Pro',
  price: 1800,
  currency: 'usd',
  requiresPayment: true,
  type: 'recurring',
  options: [cycle(), flat(1800)],
}

const pack: Plan = {
  reference: 'pln_pack_100',
  name: '100 Credits',
  price: 500,
  currency: 'usd',
  requiresPayment: true,
  type: 'one-time',
  options: [flat(500)],
}

function visible(plans: Plan[]): string[] {
  const filter = buildDefaultCheckoutPlanFilter(plans)
  return plans.filter(filter).map(p => p.reference!)
}

describe('buildDefaultCheckoutPlanFilter', () => {
  it('always hides Free plans', () => {
    expect(visible([free, payg])).toEqual(['pln_payg'])
    expect(visible([free, recurring])).toEqual(['pln_pro'])
  })

  it('keeps PAYG when it is the only paid plan (canonical topup config)', () => {
    expect(visible([free, payg])).toEqual(['pln_payg'])
    expect(visible([payg])).toEqual(['pln_payg'])
  })

  it('hides PAYG when the product also exposes one-time pack plans (legacy topup-with-packs config)', () => {
    expect(visible([free, payg, pack])).toEqual(['pln_pack_100'])
  })

  it('hides PAYG when the product also exposes a recurring paid plan (subscribe-or-PAYG config)', () => {
    expect(visible([payg, recurring])).toEqual(['pln_pro'])
  })

  it('keeps multiple non-PAYG paid plans intact (recurring tiers + packs)', () => {
    expect(visible([free, payg, recurring, pack])).toEqual(['pln_pro', 'pln_pack_100'])
  })

  it('returns [] when the only plan is Free', () => {
    expect(visible([free])).toEqual([])
  })

  it('returns [] for an empty plan list', () => {
    expect(visible([])).toEqual([])
  })
})

describe('formatPaygRate', () => {
  it('renders credits per call once the balance supplies the peg', () => {
    expect(formatPaygRate({ ...payg, options: [perUnit(10)] }, 'en-US', usdBalance)).toBe(
      '1,000 credits / call',
    )
  })

  it('renders singular credits per call', () => {
    expect(
      formatPaygRate({ ...payg, options: [perUnit(1)] }, 'en-US', {
        ...usdBalance,
        creditsPerMinorUnit: 1,
      }),
    ).toBe('1 credit / call')
  })

  it('falls back to the charge itself when there is no balance to peg against', () => {
    // Without the peg there is no honest credit figure, but the price
    // per call is still known — show that rather than nothing.
    expect(formatPaygRate(payg, 'en-US')).toBe('$0.02 / call')
  })

  it('falls back to the charge when it is priced outside the balance currency', () => {
    expect(formatPaygRate({ ...payg, options: [perUnit(200, 'eur')] }, 'en-US', usdBalance)).toBe(
      '€2 / call',
    )
  })

  it('returns null for a plan with no per-unit charge', () => {
    expect(formatPaygRate(recurring, 'en-US', usdBalance)).toBeNull()
  })
})

describe('planMeterName', () => {
  it('reads the meter off a per-unit charge', () => {
    expect(planMeterName(payg)).toBe('requests')
  })

  it('falls back to the limit option on a free allowance with no per-unit charge', () => {
    const allowance: Plan = {
      reference: 'pln_free_tokens',
      name: 'Free',
      price: 0,
      currency: 'usd',
      requiresPayment: false,
      type: 'recurring',
      options: [
        cycle(),
        flat(0),
        { kind: 'limit', cap: 3, scope: 'billing_period', meter: 'tokens', onExceed: 'block' },
      ],
    }
    expect(planMeterName(allowance)).toBe('tokens')
  })

  it('returns null when no option names a meter', () => {
    expect(planMeterName(recurring)).toBeNull()
  })
})
