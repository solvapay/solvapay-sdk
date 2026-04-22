import { describe, it, expect } from 'vitest'
import {
  resolvePlanShape,
  resolveActivationStrategy,
  resolvePlanActions,
  resolveAboutCtaCard2,
  resolveAboutCtaCard1,
  resolveActivityStrip,
  type PlanLike,
} from '../plan-actions'

describe('resolvePlanShape', () => {
  it('recognises the four plan shapes', () => {
    expect(resolvePlanShape({ planType: 'free' })).toBe('free')
    expect(resolvePlanShape({ planType: 'trial' })).toBe('trial')
    expect(resolvePlanShape({ planType: 'usage-based' })).toBe('usage-based')
    expect(resolvePlanShape({ planType: 'recurring' })).toBe('recurring-unlimited')
    expect(resolvePlanShape({ planType: 'recurring', meterRef: 'mtr_x' })).toBe('recurring-metered')
    expect(resolvePlanShape({ planType: 'recurring', meterId: 'm_1' })).toBe('recurring-metered')
    expect(resolvePlanShape({ planType: 'recurring', limit: 500 })).toBe('recurring-metered')
  })

  it('returns null for absent plan', () => {
    expect(resolvePlanShape(null)).toBeNull()
    expect(resolvePlanShape(undefined)).toBeNull()
  })
})

describe('resolveActivationStrategy', () => {
  it('maps each plan type to the right branch', () => {
    expect(resolveActivationStrategy({ planType: 'free' })).toBe('activate')
    expect(resolveActivationStrategy({ planType: 'trial' })).toBe('activate')
    expect(resolveActivationStrategy({ planType: 'usage-based' })).toBe('topup-first')
    expect(resolveActivationStrategy({ planType: 'recurring', price: 10000 })).toBe('paid-checkout')
    expect(resolveActivationStrategy({ planType: 'recurring', price: 0 })).toBe('activate')
  })
})

describe('resolvePlanActions', () => {
  const usageBasedPurchase = {
    planSnapshot: { planType: 'usage-based' } as PlanLike,
    hasPaymentMethod: true,
  }
  const unlimitedPurchase = {
    planSnapshot: { planType: 'recurring' } as PlanLike,
    hasPaymentMethod: true,
  }
  const meteredPurchase = {
    planSnapshot: { planType: 'recurring', meterRef: 'mtr_x' } as PlanLike,
    hasPaymentMethod: true,
  }
  const freePurchase = {
    planSnapshot: { planType: 'free' } as PlanLike,
    hasPaymentMethod: false,
  }

  it('PAYG: topUp, no cancel, no portal when cardless', () => {
    const actions = resolvePlanActions({ purchase: usageBasedPurchase, planCount: 2, paidPlanCount: 1 })
    expect(actions.topUp).toBe(true)
    expect(actions.cancel).toBe(false)
    expect(actions.managePortal).toBe(true)
    expect(actions.changePlan).toBe(true)
    expect(actions.upgrade).toBe(false)
  })

  it('recurring unlimited: cancel + portal, no topUp', () => {
    const actions = resolvePlanActions({ purchase: unlimitedPurchase, planCount: 2, paidPlanCount: 2 })
    expect(actions.topUp).toBe(false)
    expect(actions.cancel).toBe(true)
    expect(actions.managePortal).toBe(true)
    expect(actions.changePlan).toBe(true)
  })

  it('recurring metered: cancel + portal, no topUp', () => {
    const actions = resolvePlanActions({ purchase: meteredPurchase, planCount: 3, paidPlanCount: 2 })
    expect(actions.topUp).toBe(false)
    expect(actions.cancel).toBe(true)
    expect(actions.managePortal).toBe(true)
  })

  it('free plan with paid alternatives exposes Upgrade instead of changePlan', () => {
    const actions = resolvePlanActions({ purchase: freePurchase, planCount: 3, paidPlanCount: 2 })
    expect(actions.cancel).toBe(true)
    expect(actions.upgrade).toBe(true)
    expect(actions.changePlan).toBe(false)
    expect(actions.managePortal).toBe(false)
  })

  it('changePlan hidden when no other plans exist', () => {
    const actions = resolvePlanActions({ purchase: unlimitedPurchase, planCount: 1, paidPlanCount: 1 })
    expect(actions.changePlan).toBe(false)
  })
})

describe('resolveAboutCtaCard1', () => {
  it('returning customers see Change plan', () => {
    expect(resolveAboutCtaCard1(true)).toBe('change-plan')
    expect(resolveAboutCtaCard1(false)).toBe('choose-plan')
  })
})

describe('resolveAboutCtaCard2', () => {
  it('free plan available → start-free', () => {
    expect(
      resolveAboutCtaCard2({
        hasActivePurchase: false,
        plans: [{ planType: 'free' }, { planType: 'recurring', price: 10000 }],
      }),
    ).toBe('start-free')
  })

  it('usage-based plan available → try-payg', () => {
    expect(
      resolveAboutCtaCard2({
        hasActivePurchase: false,
        plans: [{ planType: 'usage-based' }, { planType: 'recurring', price: 10000 }],
      }),
    ).toBe('try-payg')
  })

  it('only paid recurring → none', () => {
    expect(
      resolveAboutCtaCard2({
        hasActivePurchase: false,
        plans: [{ planType: 'recurring', price: 10000 }],
      }),
    ).toBe('none')
  })

  it('returning customers see none (activity strip takes over)', () => {
    expect(
      resolveAboutCtaCard2({
        hasActivePurchase: true,
        plans: [{ planType: 'free' }],
      }),
    ).toBe('none')
  })
})

describe('resolveActivityStrip', () => {
  it('returns the matching variant per plan shape', () => {
    expect(resolveActivityStrip({ planSnapshot: { planType: 'usage-based' } })).toBe('payg-balance')
    expect(resolveActivityStrip({ planSnapshot: { planType: 'recurring' } })).toBe(
      'recurring-unlimited-renew',
    )
    expect(resolveActivityStrip({ planSnapshot: { planType: 'recurring', meterRef: 'mtr_x' } })).toBe(
      'recurring-metered-usage',
    )
    expect(resolveActivityStrip({ planSnapshot: { planType: 'free' } })).toBe('free-usage')
    expect(resolveActivityStrip({ planSnapshot: { planType: 'trial' } })).toBe('free-usage')
    expect(resolveActivityStrip(null)).toBe('none')
    expect(resolveActivityStrip({ planSnapshot: null })).toBe('none')
  })
})
