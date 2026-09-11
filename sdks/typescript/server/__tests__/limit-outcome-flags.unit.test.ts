import { describe, expect, it, vi } from 'vitest'
import { createSolvaPay } from '../src'
import type { LimitResponseWithPlan, SolvaPayClient } from '../src/types'

/**
 * Pins that the five `/v1/sdk/limits` outcome flags survive
 * `factory.checkLimits()` (DEV-823) and that an allow-with-consequences
 * is distinguishable from a plain allow at `paywall.decide()` (DEV-824).
 * Each case names the flag it would fail on if a boundary started
 * dropping the field again.
 */

function limits(partial: Partial<LimitResponseWithPlan> = {}): LimitResponseWithPlan {
  return {
    withinLimits: true,
    remaining: 10,
    plan: 'pln_pro',
    ...partial,
  } as LimitResponseWithPlan
}

function clientWithLimits(body: LimitResponseWithPlan): SolvaPayClient {
  return {
    checkLimits: vi.fn().mockResolvedValue(body),
    trackUsage: vi.fn().mockResolvedValue({}),
    getCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_flag' }),
    createCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus_flag' }),
    createCheckoutSession: vi.fn(),
    createCustomerSession: vi.fn(),
  } as unknown as SolvaPayClient
}

describe('factory.checkLimits — outcome flags survive the factory boundary', () => {
  const flags = ['throttled', 'overage', 'needsTopUp', 'needsUpgrade', 'upgraded'] as const

  it.each(flags)('returns %s from a stubbed /v1/sdk/limits body with no cast', async flag => {
    // Would fail if factory.checkLimits() went back to the 8-field
    // literal that erased every onExceed flag.
    const body = limits({ [flag]: true })
    const solvaPay = createSolvaPay({ apiClient: clientWithLimits(body) })

    const result = await solvaPay.checkLimits({
      customerRef: 'cus_flag',
      productRef: 'prd_api',
    })

    expect(result[flag]).toBe(true)
  })
})

describe('paywall.decide — allow-with-consequences is distinguishable', () => {
  it('sets consequence: throttled on an allow when the limits body is throttled', async () => {
    const solvaPay = createSolvaPay({
      apiClient: clientWithLimits(limits({ throttled: true, remaining: 0 })),
    })

    const decision = await solvaPay.paywall.decide(
      { auth: { customer_ref: 'cus_flag' } },
      { product: 'prd_api' },
    )

    expect(decision.outcome).toBe('allow')
    if (decision.outcome !== 'allow') throw new Error('unreachable')
    expect(decision.consequence).toBe('throttled')
    expect(decision.limits.throttled).toBe(true)
  })

  it('sets consequence: overage on an allow when the limits body is overage', async () => {
    const solvaPay = createSolvaPay({
      apiClient: clientWithLimits(limits({ overage: true, remaining: 0 })),
    })

    const decision = await solvaPay.paywall.decide(
      { auth: { customer_ref: 'cus_flag' } },
      { product: 'prd_api' },
    )

    expect(decision.outcome).toBe('allow')
    if (decision.outcome !== 'allow') throw new Error('unreachable')
    expect(decision.consequence).toBe('overage')
    expect(decision.limits.overage).toBe(true)
  })

  it('omits consequence on a plain allow', async () => {
    const solvaPay = createSolvaPay({
      apiClient: clientWithLimits(limits()),
    })

    const decision = await solvaPay.paywall.decide(
      { auth: { customer_ref: 'cus_flag' } },
      { product: 'prd_api' },
    )

    expect(decision.outcome).toBe('allow')
    if (decision.outcome !== 'allow') throw new Error('unreachable')
    expect(decision.consequence).toBeUndefined()
  })
})
