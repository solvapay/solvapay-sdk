import { describe, expect, it } from 'vitest'
import { planConsequence } from '../plan-consequence'
import type { PlanLike } from '../plan-actions'

const cycle = (interval = 'month') => ({ kind: 'billingCycle' as const, interval })
const flat = (amountMinor: number) => ({
  kind: 'charge' as const,
  per: 'flat' as const,
  amountMinor,
  currency: 'usd',
})
const perUnit = (amountMinor: number) => ({
  kind: 'charge' as const,
  per: 'unit' as const,
  amountMinor,
  currency: 'usd',
  meter: 'requests',
})
const limit = (cap: number) => ({ kind: 'limit' as const, cap, meter: 'requests' })

const peg = {
  displayCurrency: 'USD',
  creditsPerMinorUnit: 100,
  displayExchangeRate: 1,
}

describe('planConsequence', () => {
  it('adds No card needed on a free allowance', () => {
    const plan: PlanLike = {
      reference: 'pln_free',
      name: 'Free',
      requiresPayment: false,
      options: [cycle(), limit(100)],
    }
    expect(planConsequence(plan, 'en-US', null, { merchantName: 'Test' })).toBe(
      '100 calls per month, then calls fail. No card needed.',
    )
  })

  it('names the credit rate and that credits work across the merchant', () => {
    const plan: PlanLike = {
      reference: 'pln_payg',
      name: 'Pay as you go',
      requiresPayment: true,
      options: [perUnit(2)],
    }
    expect(planConsequence(plan, 'en-US', peg, { merchantName: 'Test' })).toBe(
      'From 200 credits per call, drawn from your credit balance. Credits work across every Test product.',
    )
  })

  it('omits the across-products clause when the merchant name is missing', () => {
    const plan: PlanLike = {
      reference: 'pln_payg',
      name: 'Pay as you go',
      requiresPayment: true,
      options: [perUnit(2)],
    }
    expect(planConsequence(plan, 'en-US', peg, {})).toBe(
      'From 200 credits per call, drawn from your credit balance.',
    )
  })

  it('adds Cancel any time on a metered paid allowance', () => {
    const plan: PlanLike = {
      reference: 'pln_starter',
      name: 'Starter',
      requiresPayment: true,
      options: [cycle(), flat(3000), limit(10000)],
    }
    expect(planConsequence(plan, 'en-US', null, { merchantName: 'Test' })).toBe(
      '10,000 calls per month. No credits used. Cancel any time.',
    )
  })

  it('qualifies an unlimited one-time plan', () => {
    const plan: PlanLike = {
      reference: 'pln_pro',
      name: 'Pro',
      requiresPayment: true,
      options: [flat(9000)],
    }
    expect(planConsequence(plan, 'en-US', null, { merchantName: 'Test' })).toBe(
      'Unlimited calls, one time. No credits used, no renewal.',
    )
  })
})
