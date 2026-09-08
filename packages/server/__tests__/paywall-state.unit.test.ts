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

  it('returns upgrade_required when there is no active plan ref', () => {
    const state = classifyPaywallState(limits({ plan: '', plans: [] }))
    expect(state).toEqual({ kind: 'upgrade_required' })
  })

  it('returns upgrade_required when limits is null', () => {
    expect(classifyPaywallState(null)).toEqual({ kind: 'upgrade_required' })
  })

  it('returns limit_reached when on an active recurring plan at period cap', () => {
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
    expect(state).toEqual({ kind: 'limit_reached' })
  })

  it('returns limit_reached when on an active free plan at cap (hybrid / included usage)', () => {
    const state = classifyPaywallState(
      limits({
        plan: 'plan_free',
        plans: [
          {
            reference: 'plan_free',
            name: 'Free',
            type: 'hybrid',
            price: 0,
            currency: 'USD',
            requiresPayment: false,
            freeUnits: 3,
            perUnitChargeMinor: 2,
          },
        ],
        remaining: 0,
        meterName: 'api_requests',
      }),
    )
    expect(state).toEqual({ kind: 'limit_reached' })
  })

  it('returns limit_reached for an active plan at cap when no credit fields are present', () => {
    // Credit-based denials are identified by credit-field presence, not
    // by `plans[].type`. A usage-based plan row with no balance or
    // creditsPerUnit is included-usage exhaustion (row 7), not a topup.
    const state = classifyPaywallState(
      limits({
        plan: 'pln_usage',
        planRef: 'pln_usage',
        purchaseRef: 'pur_1',
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
        remaining: 0,
      }),
    )
    expect(state).toEqual({ kind: 'limit_reached' })
  })

  it('returns topup_required when the top-level `creditBalance` field is zero (no nested balance block)', () => {
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
        creditBalance: 0,
      }),
    )
    expect(state).toEqual({ kind: 'topup_required' })
  })

  it('prefers authoritative needsTopUp over the zero-balance heuristic', () => {
    // DEV-824: when the backend sends needsTopUp, that flag is the
    // source of truth — even if the credit-balance heuristic would
    // have inferred upgrade (recurring plan, no zero-credit signal).
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
        remaining: 5,
        needsTopUp: true,
      }),
    )
    expect(state).toEqual({ kind: 'topup_required' })
  })

  it('prefers authoritative needsUpgrade over a usage-based zero-balance heuristic', () => {
    // DEV-824: needsUpgrade beats the "usage-based + zero credits →
    // topup" inference so an auto-upgrade deny is not mis-routed to
    // the topup tool.
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
        needsUpgrade: true,
      }),
    )
    expect(state).toEqual({ kind: 'upgrade_required' })
  })

  it('still prefers activationRequired over authoritative needsTopUp', () => {
    const state = classifyPaywallState(
      limits({
        activationRequired: true,
        needsTopUp: true,
      }),
    )
    expect(state).toEqual({ kind: 'activation_required' })
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
    expect(msg).toContain(`[Open checkout](${checkoutUrl})`)
  })

  it('topup_required names account with view topup and inlines checkoutUrl', () => {
    const msg = buildGateMessage(
      { kind: 'topup_required' } satisfies PaywallState,
      gate({ checkoutUrl }),
    )
    expect(msg).toMatch(/`account` tool with view: 'topup'/)
    expect(msg).toContain(`[Open checkout](${checkoutUrl})`)
    expect(msg).not.toMatch(/activate_plan/)
  })

  it('upgrade_required names account with view checkout and inlines checkoutUrl with expiry', () => {
    const msg = buildGateMessage(
      { kind: 'upgrade_required' } satisfies PaywallState,
      gate({ checkoutUrl }),
    )
    expect(msg).toMatch(/`account` tool with view: 'checkout'/)
    expect(msg).toContain(`[Open checkout](${checkoutUrl})`)
    expect(msg).not.toContain(`Open ${checkoutUrl}`)
    expect(msg).toMatch(/expires in 15 minutes/)
    expect(msg).toContain('docs://solvapay/overview.md')
    expect(msg).not.toMatch(/view: 'topup'/)
  })

  it('limit_reached states used/total, next-call price, URL, and checkout recovery', () => {
    const msg = buildGateMessage(
      { kind: 'limit_reached' } satisfies PaywallState,
      gate({
        checkoutUrl,
        planRef: 'plan_free',
        meterName: 'api_requests',
        unitPriceMinor: 2,
        currency: 'USD',
        included: { total: 3, used: 3, remaining: 0 },
      }),
    )
    expect(msg).toMatch(/You've used 3 of 3 included api requests/)
    expect(msg).toMatch(/\$0\.02/)
    expect(msg).toContain(`[Open checkout](${checkoutUrl})`)
    expect(msg).toMatch(/expires in 15 minutes/)
    expect(msg).toMatch(/`account` tool with view: 'checkout'/)
    expect(msg).not.toMatch(/don't have an active plan/)
    expect(msg).not.toMatch(/shown in the panel/)
  })

  it('reactivation_required names account and checkout views', () => {
    const msg = buildGateMessage(
      { kind: 'reactivation_required' } satisfies PaywallState,
      gate({ checkoutUrl }),
    )
    expect(msg).toMatch(/`account` tool with view: 'account'/)
    expect(msg).toMatch(/`account` tool with view: 'checkout'/)
  })

  it('omits "open {url}" clause when checkoutUrl is empty for non-reactivation states', () => {
    const msg = buildGateMessage(
      { kind: 'upgrade_required' } satisfies PaywallState,
      gate({ checkoutUrl: '' }),
    )
    expect(msg).toMatch(/`account` tool with view: 'checkout'/)
    expect(msg).not.toContain('{checkoutUrl}')
  })
})

describe('buildNudgeMessage', () => {
  const checkoutUrl = 'https://example.test/checkout'

  it('names account with view topup for usage-based low balance nudges', () => {
    const msg = buildNudgeMessage(
      { kind: 'topup_required' } satisfies PaywallState,
      limits({
        balance: { creditBalance: 10, creditsPerUnit: 1, currency: 'USD' },
        checkoutUrl,
      }),
    )
    expect(msg).toMatch(/`account` tool with view: 'topup'/)
    expect(msg).toContain(`[Open checkout](${checkoutUrl})`)
  })

  it('names account with view checkout for recurring plans approaching the period cap', () => {
    const msg = buildNudgeMessage(
      { kind: 'upgrade_required' } satisfies PaywallState,
      limits({ remaining: 1, checkoutUrl }),
    )
    expect(msg).toMatch(/`account` tool with view: 'checkout'/)
    expect(msg).toContain(`[Open checkout](${checkoutUrl})`)
  })

  it('states 0 calls left when remainingCalls hits zero', () => {
    const msg = buildNudgeMessage(
      { kind: 'topup_required' } satisfies PaywallState,
      limits({
        remaining: 0,
        balance: { creditBalance: 0, creditsPerUnit: 100_000, currency: 'USD' },
      }),
    )
    expect(msg).toMatch(/0 calls left/)
    expect(msg).toMatch(/next call needs a top-up/)
  })
})

const NO_ACTIVE_PLAN = /don't have an active plan/

describe('scenario matrix', () => {
  it('row 5 — PAYG shortfall classifies as topup_required, never upgrade_required', () => {
    const input = limits({
      plan: '',
      planRef: 'pln_payg',
      planName: 'Pay as you go',
      purchaseRef: 'pur_1',
      remaining: 0,
      paywallReason: 'topup_required',
      creditBalance: 91_000,
      creditsPerUnit: 100_000,
      balance: { creditBalance: 91_000, creditsPerUnit: 100_000, currency: 'USD' },
    })
    const state = classifyPaywallState(input)
    expect(state).toEqual({ kind: 'topup_required' })
    expect(state.kind).not.toBe('upgrade_required')
    const msg = buildGateMessage(state, gate({
      creditBalance: 91_000,
      creditsPerCall: 100_000,
      shortfallCredits: 9_000,
      purchaseRef: 'pur_1',
      planRef: 'pln_payg',
    }))
    expect(msg).toMatch(/Balance 91,000 credits/)
    expect(msg).toMatch(/100,000 credits/)
    expect(msg).toMatch(/9,000 short/)
    expect(msg).not.toMatch(NO_ACTIVE_PLAN)
    expect(msg).not.toMatch(/\$10\.00/)
  })

  it('row 6 — zero balance classifies as topup_required via credit-field presence', () => {
    const input = limits({
      plan: '',
      planRef: 'pln_payg',
      purchaseRef: 'pur_1',
      remaining: 0,
      creditBalance: 0,
      creditsPerUnit: 100_000,
    })
    const state = classifyPaywallState(input)
    expect(state).toEqual({ kind: 'topup_required' })
    expect(state.kind).not.toBe('upgrade_required')
  })

  it('row 7 — included usage exhausted classifies as limit_reached off purchaseRef', () => {
    const input = limits({
      plan: '',
      planRef: 'pln_pro',
      planName: 'Pro',
      purchaseRef: 'pur_rec',
      remaining: 0,
      used: 3,
      limit: 3,
      meterName: 'requests',
      paywallReason: 'payment_required',
    })
    const state = classifyPaywallState(input)
    expect(state).toEqual({ kind: 'limit_reached' })
  })

  it('row 9 — failed auto-upgrade stays upgrade_required without the no-plan lie', () => {
    const input = limits({
      planRef: 'pln_pro',
      planName: 'Pro',
      purchaseRef: 'pur_rec',
      remaining: 0,
      needsUpgrade: true,
    })
    const state = classifyPaywallState(input)
    expect(state).toEqual({ kind: 'upgrade_required' })
    const msg = buildGateMessage(
      state,
      gate({ planRef: 'pln_pro', planName: 'Pro', purchaseRef: 'pur_rec' }),
    )
    expect(msg).not.toMatch(NO_ACTIVE_PLAN)
    expect(msg).toMatch(/automatic switch/)
  })

  it.each([
    {
      name: 'balance equals cost',
      plan: '',
      creditBalance: 100_000,
      creditsPerUnit: 100_000,
      remaining: 1,
      expected: 'topup_required' as const,
    },
    {
      name: 'cost unknown, remaining 0',
      creditBalance: 50,
      remaining: 0,
      expected: 'topup_required' as const,
    },
    {
      name: 'credit fields absent, no purchase',
      remaining: 0,
      plan: '',
      expected: 'upgrade_required' as const,
    },
  ])('boundary: $name', ({ expected, ...partial }) => {
    expect(classifyPaywallState(limits(partial)).kind).toBe(expected)
  })

  it('never says no active plan when purchaseRef or a credit balance is present', () => {
    const cases = [
      limits({
        purchaseRef: 'pur_1',
        planRef: 'pln_pro',
        remaining: 0,
        used: 3,
        limit: 3,
      }),
      limits({
        creditBalance: 91_000,
        creditsPerUnit: 100_000,
        remaining: 0,
      }),
    ]
    for (const input of cases) {
      const state = classifyPaywallState(input)
      const msg = buildGateMessage(
        state,
        gate({
          purchaseRef: input.purchaseRef,
          planRef: input.planRef,
          creditBalance: input.creditBalance ?? input.balance?.creditBalance,
          creditsPerCall: input.creditsPerUnit ?? input.balance?.creditsPerUnit,
        }),
      )
      expect(msg).not.toMatch(NO_ACTIVE_PLAN)
    }
  })
})

describe('buildGateMessage copy rewrite', () => {
  const checkoutUrl = 'https://example.test/checkout'
  const payg = {
    reference: 'pln_payg',
    name: 'Pay as you go',
    type: 'usage-based',
    price: 0,
    currency: 'USD',
    requiresPayment: true,
    checkoutUrl: `${checkoutUrl}&plan=pln_payg`,
  }
  const unlimited = {
    reference: 'pln_unl',
    name: 'Unlimited',
    type: 'recurring',
    price: 5000,
    currency: 'USD',
    requiresPayment: true,
    checkoutUrl: `${checkoutUrl}&plan=pln_unl`,
  }

  it('quotes JPY without dividing by 100 and omits money when currency is absent', () => {
    const withYen = buildGateMessage(
      { kind: 'limit_reached' },
      gate({ unitPriceMinor: 150, currency: 'JPY', included: { total: 3, used: 3, remaining: 0 } }),
    )
    expect(withYen).toMatch(/¥150|JPY 150/)
    expect(withYen).not.toMatch(/1\.50/)
    expect(withYen).not.toContain('$')

    const noCurrency = buildGateMessage(
      { kind: 'limit_reached' },
      gate({ unitPriceMinor: 150, included: { total: 3, used: 3, remaining: 0 } }),
    )
    expect(noCurrency).not.toMatch(/\$|¥|USD|JPY/)
    expect(noCurrency).not.toMatch(/The next call is/)
  })

  it('renders the plan ladder cheapest-first and escapes brackets in names', () => {
    const msg = buildGateMessage(
      { kind: 'upgrade_required' },
      gate({
        plans: [
          { ...unlimited },
          { ...payg, name: 'Plan [beta]' },
        ],
      }),
    )
    expect(msg).toMatch(
      /\[Plan \\\[beta\\\]\]\(https:\/\/example\.test\/checkout&plan=pln_payg\) · \[Unlimited\]\(https:\/\/example\.test\/checkout&plan=pln_unl\)/,
    )
  })

  it('is byte-identical to the post-rewrite copy when no plan has a checkoutUrl', () => {
    const plans = [{ ...payg, checkoutUrl: undefined }, { ...unlimited, checkoutUrl: undefined }]
    const withPlans = buildGateMessage({ kind: 'upgrade_required' }, gate({ plans, checkoutUrl }))
    const without = buildGateMessage({ kind: 'upgrade_required' }, gate({ checkoutUrl }))
    expect(withPlans).toBe(without)
  })

  it('limit_reached names the measured meter and the anti-trap line', () => {
    const msg = buildGateMessage(
      { kind: 'limit_reached' },
      gate({
        planName: 'Pro',
        planRef: 'pln_pro',
        meterName: 'requests',
        included: { total: 3, used: 3, remaining: 0 },
        creditBalance: 91_000,
        plans: [payg, unlimited],
      }),
    )
    expect(msg).toMatch(/You've used 3 of 3 included requests/)
    expect(msg).toMatch(/Adding credits will not help, because Pro does not spend them/)
    expect(msg).toMatch(/Or switch plan: \[Pay as you go\]/)
    expect(msg).not.toMatch(/included units/)
  })
})
