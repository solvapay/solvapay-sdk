import { describe, it, expect } from 'vitest'
import {
  resolvePlanShape,
  resolveActivationStrategy,
  resolvePlanActions,
  resolveActivityStrip,
  mergePlanSnapshot,
  type PlanLike,
} from '../plan-actions'

/**
 * Fixtures mirror the real wire. These previously set `planType`,
 * `meterRef`, and `limit` — fields the backend does not send — so the
 * suite passed while every live plan fell through to the unknown
 * branch.
 */
const cycle = (interval = 'month') => ({ kind: 'billingCycle' as const, interval })
const flat = (amountMinor: number, currency = 'usd') => ({
  kind: 'charge' as const,
  per: 'flat' as const,
  amountMinor,
  currency,
})
const perUnit = (amountMinor: number, meter = 'requests') => ({
  kind: 'charge' as const,
  per: 'unit' as const,
  amountMinor,
  currency: 'usd',
  meter,
})
const limit = (cap: number, meter = 'requests') => ({ kind: 'limit' as const, cap, meter })

// A plan as `GET /v1/sdk/products/:ref/plans` sends it.
const freePlan: PlanLike = { requiresPayment: false, options: [cycle()] }
const paygPlan: PlanLike = { requiresPayment: true, options: [perUnit(2)] }
const unlimitedPlan: PlanLike = { requiresPayment: true, options: [cycle(), flat(1800)] }
const meteredPlan: PlanLike = {
  requiresPayment: true,
  options: [cycle(), flat(2900), limit(1000)],
}
const hybridPlan: PlanLike = {
  requiresPayment: true,
  options: [cycle(), flat(4900), perUnit(2)],
}
const trialPlan: PlanLike = {
  requiresPayment: true,
  options: [cycle(), flat(2900), { kind: 'trial', days: 14, onEnd: 'convert' }],
}
const oneTimePlan: PlanLike = { requiresPayment: true, options: [flat(9900)] }

// The frozen snapshot on a purchase: no `requiresPayment`, no `type`.
const paygSnapshot: PlanLike = { price: 0, options: [perUnit(2)] }
const unlimitedSnapshot: PlanLike = {
  price: 1800,
  options: [cycle(), flat(1800)],
}
const meteredSnapshot: PlanLike = {
  price: 2900,
  options: [cycle(), flat(2900), limit(1000)],
}
const freeSnapshot: PlanLike = { price: 0, options: [cycle()] }

describe('resolvePlanShape', () => {
  it('derives each shape from the plan wire', () => {
    expect(resolvePlanShape(freePlan)).toBe('free')
    expect(resolvePlanShape(trialPlan)).toBe('trial')
    expect(resolvePlanShape(paygPlan)).toBe('usage-based')
    expect(resolvePlanShape(unlimitedPlan)).toBe('recurring-unlimited')
    expect(resolvePlanShape(meteredPlan)).toBe('recurring-metered')
  })

  it('treats a hybrid plan as a metered subscription', () => {
    // Subscription + usage bills on a cycle and counts calls, which is
    // exactly the recurring-metered surface.
    expect(resolvePlanShape(hybridPlan)).toBe('recurring-metered')
  })

  it('derives the same shapes from a frozen purchase snapshot', () => {
    // A snapshot has no `requiresPayment` and no `type`, so the shape
    // has to come from `options[]`.
    expect(resolvePlanShape(paygSnapshot)).toBe('usage-based')
    expect(resolvePlanShape(unlimitedSnapshot)).toBe('recurring-unlimited')
    expect(resolvePlanShape(meteredSnapshot)).toBe('recurring-metered')
    expect(resolvePlanShape(freeSnapshot)).toBe('free')
  })

  it('reads a snapshot frozen before options[] existed off its headline price', () => {
    expect(resolvePlanShape({ price: 1800, options: [] })).toBe('recurring-unlimited')
    expect(resolvePlanShape({ price: 0, options: [] })).toBe('free')
  })

  it('folds a paid one-time plan into recurring-unlimited so it routes to checkout', () => {
    // The matrix has no one-time member; this is the bucket it has
    // always landed in, and the one that reaches paid checkout.
    expect(resolvePlanShape(oneTimePlan)).toBe('recurring-unlimited')
  })

  it('treats a plan that charges nothing as free', () => {
    expect(resolvePlanShape({ requiresPayment: true, options: [cycle(), flat(0)] })).toBe('free')
  })

  it('returns null for absent plan', () => {
    expect(resolvePlanShape(null)).toBeNull()
    expect(resolvePlanShape(undefined)).toBeNull()
  })
})

describe('resolveActivationStrategy', () => {
  it('maps each plan shape to the right branch', () => {
    expect(resolveActivationStrategy(freePlan)).toBe('activate')
    expect(resolveActivationStrategy(trialPlan)).toBe('activate')
    expect(resolveActivationStrategy(paygPlan)).toBe('topup-first')
    expect(resolveActivationStrategy(unlimitedPlan)).toBe('paid-checkout')
    expect(resolveActivationStrategy(oneTimePlan)).toBe('paid-checkout')
  })

  it('activates a zero-priced recurring plan inline rather than opening checkout', () => {
    expect(resolveActivationStrategy({ requiresPayment: true, options: [cycle(), flat(0)] })).toBe(
      'activate',
    )
  })
})

describe('resolvePlanActions', () => {
  const usageBasedPurchase = { planSnapshot: paygSnapshot, hasPaymentMethod: true }
  const unlimitedPurchase = { planSnapshot: unlimitedSnapshot, hasPaymentMethod: true }
  const meteredPurchase = { planSnapshot: meteredSnapshot, hasPaymentMethod: true }
  const freePurchase = { planSnapshot: freeSnapshot, hasPaymentMethod: false }

  it('PAYG: topUp, no cancel', () => {
    const actions = resolvePlanActions({
      purchase: usageBasedPurchase,
      planCount: 2,
      paidPlanCount: 1,
    })
    expect(actions.topUp).toBe(true)
    expect(actions.cancel).toBe(false)
    expect(actions.managePortal).toBe(true)
    expect(actions.changePlan).toBe(true)
    expect(actions.upgrade).toBe(false)
  })

  it('recurring unlimited: cancel + portal, no topUp', () => {
    const actions = resolvePlanActions({
      purchase: unlimitedPurchase,
      planCount: 2,
      paidPlanCount: 2,
    })
    expect(actions.topUp).toBe(false)
    expect(actions.cancel).toBe(true)
    expect(actions.managePortal).toBe(true)
    expect(actions.changePlan).toBe(true)
  })

  it('recurring metered: cancel + portal, no topUp', () => {
    const actions = resolvePlanActions({
      purchase: meteredPurchase,
      planCount: 3,
      paidPlanCount: 2,
    })
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
    const actions = resolvePlanActions({
      purchase: unlimitedPurchase,
      planCount: 1,
      paidPlanCount: 1,
    })
    expect(actions.changePlan).toBe(false)
  })

  it('thin PAYG snapshot + catalog plan is usage-based (Change plan), not free (Upgrade)', () => {
    const merged = mergePlanSnapshot(
      { price: 0, isMetered: true, reference: 'pln_payg' },
      paygPlan,
    )
    expect(resolvePlanShape(merged)).toBe('usage-based')
    const actions = resolvePlanActions({
      purchase: { planSnapshot: merged },
      planCount: 3,
      paidPlanCount: 2,
    })
    expect(actions.changePlan).toBe(true)
    expect(actions.upgrade).toBe(false)
  })
})

describe('resolveActivityStrip', () => {
  it('returns the matching variant per plan shape', () => {
    expect(resolveActivityStrip({ planSnapshot: paygSnapshot })).toBe('payg-balance')
    expect(resolveActivityStrip({ planSnapshot: unlimitedSnapshot })).toBe(
      'recurring-unlimited-renew',
    )
    expect(resolveActivityStrip({ planSnapshot: meteredSnapshot })).toBe('recurring-metered-usage')
    expect(resolveActivityStrip({ planSnapshot: freeSnapshot })).toBe('free-usage')
    expect(resolveActivityStrip({ planSnapshot: trialPlan })).toBe('free-usage')
    expect(resolveActivityStrip(null)).toBe('none')
    expect(resolveActivityStrip({ planSnapshot: null })).toBe('none')
  })
})
