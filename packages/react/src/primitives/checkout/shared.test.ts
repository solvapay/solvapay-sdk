/**
 * Unit tests for the pure helpers in `shared.ts`. The integration of
 * `buildDefaultCheckoutPlanFilter` into `<CheckoutSteps.Root>` and
 * `<PaywallNotice.EmbeddedCheckout>` is exercised by the part-level
 * tests; this file pins the filter's matrix in isolation.
 */

import { describe, expect, it } from 'vitest'
import { buildDefaultCheckoutPlanFilter } from './shared'
import type { Plan } from '../../types'

const free: Plan = {
  reference: 'pln_free',
  name: 'Free',
  price: 0,
  currency: 'usd',
  requiresPayment: false,
  type: 'recurring',
  creditsPerUnit: 0,
}

const payg: Plan = {
  reference: 'pln_payg',
  name: 'Pay as you go',
  price: 1,
  currency: 'usd',
  requiresPayment: true,
  type: 'usage-based',
  creditsPerUnit: 1,
}

const recurring: Plan = {
  reference: 'pln_pro',
  name: 'Pro',
  price: 1800,
  currency: 'usd',
  requiresPayment: true,
  type: 'recurring',
  billingCycle: 'monthly',
  creditsPerUnit: 0,
}

const pack: Plan = {
  reference: 'pln_pack_100',
  name: '100 Credits',
  price: 500,
  currency: 'usd',
  requiresPayment: true,
  type: 'one-time',
  creditsPerUnit: 0,
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
