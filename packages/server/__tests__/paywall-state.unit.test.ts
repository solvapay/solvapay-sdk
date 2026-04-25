import { describe, expect, it } from 'vitest'
import {
  buildGateMessage,
  buildNudgeMessage,
  classifyPaywallState,
  type PaywallState,
} from '../src/paywall-state'
import type { LimitResponseWithPlan, PaywallStructuredContent } from '../src/types'

function limits(partial: Partial<LimitResponseWithPlan> = {}): LimitResponseWithPlan {
  return {
    withinLimits: false,
    remaining: 0,
    plan: 'free',
    ...partial,
  } as LimitResponseWithPlan
}

function gate(overrides: Partial<PaywallStructuredContent> = {}): PaywallStructuredContent {
  return {
    kind: 'payment_required',
    product: 'prd_test',
    checkoutUrl: 'https://example.test/checkout',
    message: '',
    ...overrides,
  } as PaywallStructuredContent
}

describe('classifyPaywallState', () => {
  it('returns activation_required when activationRequired flag is set', () => {
    const state = classifyPaywallState(limits({ activationRequired: true }))
    expect(state).toEqual({ kind: 'activation_required' })
  })

  it('prefers activation_required over zero-balance signal', () => {
    const state = classifyPaywallState(
      limits({
        activationRequired: true,
        balance: { creditBalance: 0, creditsPerUnit: 1, currency: 'USD' },
      }),
    )
    expect(state).toEqual({ kind: 'activation_required' })
  })

  it('returns topup_required when a usage-based plan has zero credit balance', () => {
    const state = classifyPaywallState(
      limits({
        plan: 'pln_usage',
        plans: [
          {
            reference: 'pln_usage',
            name: 'Usage',
            type: 'usage-based',
            price: 0,
            currency: 'USD',
            requiresPayment: true,
          },
        ],
        balance: { creditBalance: 0, creditsPerUnit: 1, currency: 'USD' },
      }),
    )
    expect(state).toEqual({ kind: 'topup_required' })
  })

  it('returns topup_required when balance is populated (proxy for usage-based) with zero credits', () => {
    const state = classifyPaywallState(
      limits({
        plan: 'pln_usage',
        balance: { creditBalance: 0, creditsPerUnit: 1, currency: 'USD' },
      }),
    )
    expect(state).toEqual({ kind: 'topup_required' })
  })

  it('returns upgrade_required when there is no resolvable plan', () => {
    const state = classifyPaywallState(limits({ plan: 'free', plans: [] }))
    expect(state).toEqual({ kind: 'upgrade_required' })
  })

  it('returns upgrade_required when limits is null', () => {
    expect(classifyPaywallState(null)).toEqual({ kind: 'upgrade_required' })
  })

  it('returns upgrade_required when on a recurring plan at period cap', () => {
    const state = classifyPaywallState(
      limits({
        plan: 'pln_rec',
        plans: [
          {
            reference: 'pln_rec',
            name: 'Pro',
            type: 'recurring',
            price: 1000,
            currency: 'USD',
            requiresPayment: true,
          },
        ],
        remaining: 0,
      }),
    )
    expect(state).toEqual({ kind: 'upgrade_required' })
  })
})

describe('buildGateMessage', () => {
  const checkoutUrl = 'https://example.test/checkout'

  it('activation_required mentions activate_plan and inlines checkoutUrl', () => {
    const msg = buildGateMessage(
      { kind: 'activation_required' } satisfies PaywallState,
      gate({ kind: 'activation_required', checkoutUrl }),
    )
    expect(msg).toMatch(/activate_plan/)
    expect(msg).toContain(checkoutUrl)
  })

  it('topup_required names topup tool and inlines checkoutUrl', () => {
    const msg = buildGateMessage(
      { kind: 'topup_required' } satisfies PaywallState,
      gate({ checkoutUrl }),
    )
    expect(msg).toMatch(/topup/)
    expect(msg).toContain(checkoutUrl)
    expect(msg).not.toMatch(/activate_plan/)
  })

  it('upgrade_required names upgrade tool and inlines checkoutUrl', () => {
    const msg = buildGateMessage(
      { kind: 'upgrade_required' } satisfies PaywallState,
      gate({ checkoutUrl }),
    )
    expect(msg).toMatch(/upgrade/)
    expect(msg).toContain(checkoutUrl)
    expect(msg).not.toMatch(/topup/)
  })

  it('reactivation_required names manage_account and upgrade tools', () => {
    const msg = buildGateMessage(
      { kind: 'reactivation_required' } satisfies PaywallState,
      gate({ checkoutUrl }),
    )
    expect(msg).toMatch(/manage_account/)
    expect(msg).toMatch(/upgrade/)
  })

  it('omits "open {url}" clause when checkoutUrl is empty for non-reactivation states', () => {
    const msg = buildGateMessage(
      { kind: 'upgrade_required' } satisfies PaywallState,
      gate({ checkoutUrl: '' }),
    )
    expect(msg).toMatch(/upgrade/)
    expect(msg).not.toContain('{checkoutUrl}')
  })
})

describe('buildNudgeMessage', () => {
  const checkoutUrl = 'https://example.test/checkout'

  it('names topup for usage-based low balance nudges', () => {
    const msg = buildNudgeMessage(
      { kind: 'topup_required' } satisfies PaywallState,
      limits({
        balance: { creditBalance: 10, creditsPerUnit: 1, currency: 'USD' },
        checkoutUrl,
      }),
    )
    expect(msg).toMatch(/topup/)
    expect(msg).toContain(checkoutUrl)
  })

  it('names upgrade for recurring plans approaching the period cap', () => {
    const msg = buildNudgeMessage(
      { kind: 'upgrade_required' } satisfies PaywallState,
      limits({ remaining: 1, checkoutUrl }),
    )
    expect(msg).toMatch(/upgrade/)
    expect(msg).toContain(checkoutUrl)
  })
})
