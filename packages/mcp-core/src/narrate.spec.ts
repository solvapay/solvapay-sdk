import { describe, it, expect } from 'vitest'
import {
  narrateAlreadyActive,
  narrateActivatePlan,
  narrateManageAccount,
  narrateUpgrade,
  narrateTopup,
  narrateAutoRecharge,
  balanceSummary,
  NARRATORS,
  uiPlaceholder,
} from './narrate'
import { VIEWER_TOOL_NAME } from './tool-names'
import { narratedToolResult, parseMode } from './helpers'
import type { BootstrapPayload, SolvaPayCallToolResult } from './types'

function basePayload(overrides: Partial<BootstrapPayload> = {}): BootstrapPayload {
  return {
    view: 'account',
    productRef: 'prd_x',
    stripePublishableKey: null,
    returnUrl: 'https://example.test/r',
    merchant: { displayName: 'Acme', legalName: 'Acme Inc.' } as never,
    product: { reference: 'prd_x', name: 'Acme Knowledge Base' } as never,
    plans: [],
    customer: null,
    ...overrides,
  }
}

/**
 * Plan fixtures mirror `GET /v1/sdk/products/:ref/plans` verbatim: pricing
 * in `options[]`, a derived `type` label, and `requiresPayment` marking a
 * free plan. The narrators previously read a `planType` field — including
 * `'free'` and `'trial'` values no backend ever produced — and every test
 * here fabricated it, so the suite passed while the narrator rendered every
 * real plan as "recurring".
 */
const cycle = (interval = 'month') => ({ kind: 'billingCycle', interval })
const flat = (amountMinor: number, currency = 'usd') => ({
  kind: 'charge',
  per: 'flat',
  amountMinor,
  currency,
})
const perUnit = (amountMinor: number, currency = 'usd', meter = 'requests') => ({
  kind: 'charge',
  per: 'unit',
  amountMinor,
  currency,
  meter,
})

const usdBalance = {
  credits: 5000,
  displayCurrency: 'USD',
  displayExchangeRate: 1,
  creditsPerMinorUnit: 100,
}

describe('balanceSummary', () => {
  it('shows SEK fiat estimate using creditsPerMinorUnit and USD→SEK rate', () => {
    const summary = balanceSummary({
      balance: {
        credits: 159_600,
        displayCurrency: 'SEK',
        displayExchangeRate: 9.46,
        creditsPerMinorUnit: 100,
      },
    })
    expect(summary).toContain('159,600 credits')
    expect(summary).toContain('~SEK\u00a0150.98')
  })

  it('omits fiat suffix when creditsPerMinorUnit is absent', () => {
    const summary = balanceSummary({
      balance: {
        credits: 1000,
        displayCurrency: 'USD',
        displayExchangeRate: 1,
      },
    })
    expect(summary).toBe('1,000 credits')
    expect(summary).not.toContain('~')
  })
})

describe('narrateManageAccount', () => {
  it('lists all currency options for multi-currency plans', () => {
    // A multi-currency plan carries one flat charge per currency; the
    // derived top-level `price` only reflects the default one.
    const { text } = narrateManageAccount(
      basePayload({
        plans: [
          {
            type: 'recurring',
            name: 'Global',
            price: 1000,
            currency: 'USD',
            requiresPayment: true,
            options: [cycle(), flat(1000, 'usd'), flat(900, 'eur')],
          },
        ] as never,
      }),
    )

    expect(text).toContain('Global')
    expect(text).toContain('$10')
    expect(text).toContain('€9')
    expect(text).toContain('a month')
  })

  it('produces a cold-start welcome with plan list', () => {
    const { text } = narrateManageAccount(
      basePayload({
        plans: [
          { type: 'recurring', name: 'Free', requiresPayment: false, options: [cycle(), flat(0)] },
          {
            type: 'usage-based',
            name: 'Starter',
            requiresPayment: true,
            options: [perUnit(1)],
          },
          {
            type: 'recurring',
            name: 'Unlimited',
            price: 50000,
            currency: 'USD',
            requiresPayment: true,
            options: [cycle(), flat(50000)],
          },
        ] as never,
      }),
    )
    expect(text.startsWith('**Welcome to Acme Knowledge Base**')).toBe(true)
    expect(text).toContain('has no plan yet')
    expect(text).not.toContain('so calls will fail')
    expect(text).toContain('Free requires no payment')
    expect(text).toContain('Starter is $0.01 per call')
    expect(text).toContain('Unlimited is $500 a month')
    expect(text).toContain(`To continue, call \`${VIEWER_TOOL_NAME}\` with view: "checkout".`)
    expect(text).not.toMatch(/Commands:\s*`\//)
  })

  it('labels one-time and hybrid plans distinctly instead of collapsing them to recurring', () => {
    const { text } = narrateManageAccount(
      basePayload({
        plans: [
          { type: 'one-time', name: 'Lifetime', requiresPayment: true, options: [flat(9900)] },
          {
            type: 'hybrid',
            name: 'Team',
            requiresPayment: true,
            options: [cycle(), flat(4900), perUnit(2)],
          },
        ] as never,
      }),
    )
    expect(text).toContain('Lifetime is $99 once')
    expect(text).toContain('Team is $49 a month')
  })

  it('surfaces a trial from the trial option', () => {
    const { text } = narrateManageAccount(
      basePayload({
        plans: [
          {
            type: 'recurring',
            name: 'Pro',
            requiresPayment: true,
            options: [cycle(), flat(2900), { kind: 'trial', days: 14, onEnd: 'convert' }],
          },
        ] as never,
      }),
    )
    expect(text).toContain('Pro is $29 a month · 14-day trial')
  })

  it('produces an account summary when there is an active purchase', () => {
    const payload = basePayload({
      customer: {
        ref: 'cus_1',
        purchase: {
          customerRef: 'cus_1',
          purchases: [
            {
              productRef: 'prd_x',
              planSnapshot: {
                name: 'Unlimited',
                isMetered: false,
                price: 50000,
                currency: 'USD',
                options: [cycle(), flat(50000)],
              },
              // The cycle lives on the purchase; the snapshot freezes only options.
              billingCycle: 'monthly',
              endDate: '2026-05-01T00:00:00Z',
            },
          ],
        } as never,
        paymentMethod: null,
        balance: { ...usdBalance, credits: 100 } as never,
        usage: null,
      } as never,
    })
    const { text } = narrateManageAccount(payload)
    expect(text).toContain('**Acme Knowledge Base — your account**')
    expect(text).toContain('is on Unlimited, $500 a month')
    expect(text).toContain('Unlimited calls')
    expect(text).toContain('renewing May 1')
    expect(text).toContain('Credits are not used on this plan')
  })

  it('names this product\'s plan, not a paid plan on another product', () => {
    const { text } = narrateManageAccount(
      basePayload({
        productRef: 'prd_this',
        product: { reference: 'prd_this', name: 'This Product' } as never,
        plans: [
          {
            type: 'usage-based',
            name: 'Pay as you go',
            reference: 'pln_payg',
            requiresPayment: true,
            options: [perUnit(2)],
          } as never,
        ],
        customer: {
          ref: 'cus_1',
          purchase: {
            customerRef: 'cus_1',
            purchases: [
              {
                status: 'active',
                productRef: 'prd_other',
                amount: 3000,
                startDate: '2026-03-01T00:00:00.000Z',
                planSnapshot: {
                  name: 'Pro',
                  reference: 'pln_pro',
                  price: 3000,
                  currency: 'USD',
                  options: [cycle(), flat(3000)],
                },
              },
              {
                status: 'active',
                productRef: 'prd_this',
                amount: 0,
                startDate: '2026-01-01T00:00:00.000Z',
                planRef: 'pln_payg',
                planSnapshot: {
                  name: 'Pay as you go',
                  reference: 'pln_payg',
                  isMetered: true,
                  options: [perUnit(2)],
                },
              },
            ],
          } as never,
          paymentMethod: null,
          balance: { ...usdBalance, credits: 5000 } as never,
          usage: null,
          limits: {
            withinLimits: true,
            remaining: -1,
            creditsPerUnit: 200,
            creditBalance: 5000,
          },
        } as never,
      }),
    )
    expect(text).toContain('Pay as you go')
    expect(text).not.toContain('is on Pro')
    expect(text).not.toContain('$30')
    expect(text).not.toContain('Unlimited calls')
    expect(text).not.toContain('Credits are not used on this plan')
  })

  it('does not claim unlimited when a paid snapshot has no readable options', () => {
    const { text } = narrateManageAccount(
      basePayload({
        customer: {
          ref: 'cus_1',
          purchase: {
            customerRef: 'cus_1',
            purchases: [
              {
                status: 'active',
                productRef: 'prd_x',
                amount: 1000,
                planRef: 'pln_payg',
                planSnapshot: {
                  name: 'Pay as you go',
                  reference: 'pln_payg',
                  price: 1000,
                  currency: 'USD',
                  requiresPayment: true,
                },
              },
            ],
          } as never,
          paymentMethod: null,
          balance: { ...usdBalance, credits: 100 } as never,
          usage: { remaining: 0 },
          limits: {
            withinLimits: true,
            remaining: 0,
            creditsPerUnit: 10_000,
            creditBalance: 100,
          },
        } as never,
      }),
    )
    expect(text).toContain('Pay as you go')
    expect(text).not.toContain('Unlimited calls')
    expect(text).not.toContain('Credits are not used on this plan')
  })

  function meteredAccount(
    snapshotOptions: unknown[] | undefined,
    balance: Record<string, unknown> = usdBalance,
  ) {
    return basePayload({
      customer: {
        ref: 'cus_1',
        purchase: {
          customerRef: 'cus_1',
          purchases: [
            {
              productRef: 'prd_x',
              planRef: 'pln_payg',
              planSnapshot: {
                name: 'Pay as you go',
                isMetered: true,
                ...(snapshotOptions ? { options: snapshotOptions } : {}),
              },
            },
          ],
        } as never,
        paymentMethod: null,
        balance: balance as never,
        usage: null,
      } as never,
    })
  }

  it('prices a metered call from the rate frozen on the purchase snapshot', () => {
    // 2 minor units at parity, pegged at 100 credits per minor unit.
    const { text } = narrateManageAccount(meteredAccount([perUnit(2)]))
    expect(text).toContain('200 credits per call')
  })

  it('applies the balance exchange rate to a non-USD charge', () => {
    const { text } = narrateManageAccount(
      meteredAccount([perUnit(100, 'sek')], {
        credits: 5000,
        displayCurrency: 'SEK',
        displayExchangeRate: 9.46,
        creditsPerMinorUnit: 100,
      }),
    )
    expect(text).toContain('1,057 credits per call')
  })

  it('omits cost per call when the charge currency is not the balance currency', () => {
    // The balance peg only carries the rate for its own display currency;
    // reusing it for a EUR charge would be wrong by the FX ratio.
    const { text } = narrateManageAccount(meteredAccount([perUnit(2, 'eur')]))
    expect(text).not.toContain('credits per call')
    expect(text).toContain('Balance 5,000 credits')
  })

  it('merges catalog options onto a thin PAYG snapshot so it does not collapse to free', () => {
    const { text } = narrateManageAccount(
      basePayload({
        plans: [
          {
            type: 'usage-based',
            name: 'Pay as you go',
            reference: 'pln_payg',
            requiresPayment: true,
            options: [perUnit(2)],
          } as never,
        ],
        customer: {
          ref: 'cus_1',
          purchase: {
            customerRef: 'cus_1',
            purchases: [
              {
                productRef: 'prd_x',
                planRef: 'pln_payg',
                planSnapshot: { name: 'Pay as you go', isMetered: true, reference: 'pln_payg' },
              },
            ],
          } as never,
          paymentMethod: null,
          balance: usdBalance as never,
          usage: null,
          limits: null,
        } as never,
      }),
    )
    expect(text).toContain('is on Pay as you go, 200 credits per call')
    expect(text).toContain('Balance 5,000 credits')
  })

  it('omits cost per call for a zero-rate meter, which costs nothing', () => {
    const { text } = narrateManageAccount(meteredAccount([perUnit(0)]))
    expect(text).not.toContain('Cost per call')
  })

  it('shows balance and no-plan welcome when only a credit_topup purchase exists', () => {
    const { text } = narrateManageAccount(
      basePayload({
        plans: [
          {
            type: 'usage-based',
            name: 'Pay as you go',
            requiresPayment: true,
            options: [perUnit(2)],
          } as never,
        ],
        customer: {
          ref: 'cus_1',
          purchase: {
            customerRef: 'cus_1',
            purchases: [
              {
                metadata: { purpose: 'credit_topup' },
                planSnapshot: null,
              },
            ],
          } as never,
          paymentMethod: null,
          balance: { ...usdBalance, credits: 865_500 } as never,
          usage: null,
        } as never,
      }),
    )
    expect(text.startsWith('**Welcome to Acme Knowledge Base**')).toBe(true)
    expect(text).toContain('Balance: 865,500 credits')
    expect(text).toContain('has no plan yet')
    expect(text).not.toContain('so calls will fail')
    expect(text).not.toContain('**Acme Knowledge Base — your account**')
    expect(text).toContain(`To continue, call \`${VIEWER_TOOL_NAME}\` with view: "checkout".`)
    expect(text).not.toMatch(/Commands:\s*`\//)
  })
})

const limitOpt = (cap: number, meter = 'requests') => ({ kind: 'limit', cap, meter })

const runningLimits = {
  remaining: 3800,
  withinLimits: true,
  activationRequired: false,
  overage: false,
  needsTopUp: false,
  needsUpgrade: false,
  throttled: false,
}

const coolNow = new Date('2026-09-06T12:00:00.000Z')

function coolPayload(overrides: Partial<BootstrapPayload> = {}): BootstrapPayload {
  return basePayload({
    product: { reference: 'prd_cool', name: 'Cool MCP' } as never,
    ...overrides,
  })
}

function coolCustomer(overrides: Record<string, unknown> = {}) {
  return {
    ref: 'cus_cool',
    purchase: null,
    paymentMethod: null,
    balance: { ...usdBalance, credits: 599_800 },
    usage: null,
    limits: null,
    ...overrides,
  } as never
}

function coolPurchase(snapshot: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    customerRef: 'cus_cool',
    purchases: [{ status: 'active', productRef: 'prd_x', planSnapshot: snapshot, ...extra }],
  } as never
}

const coolPlans = {
  free100: {
    type: 'recurring',
    name: 'Free',
    reference: 'pln_free',
    requiresPayment: false,
    options: [cycle(), limitOpt(100)],
  },
  free3: {
    type: 'recurring',
    name: 'Free',
    reference: 'pln_free',
    requiresPayment: false,
    options: [cycle(), limitOpt(3)],
  },
  payg: {
    type: 'usage-based',
    name: 'Pay as you go',
    reference: 'pln_payg',
    requiresPayment: true,
    options: [perUnit(2)],
  },
  starter: {
    type: 'recurring',
    name: 'Starter',
    reference: 'pln_starter',
    requiresPayment: true,
    price: 3000,
    currency: 'USD',
    options: [cycle(), flat(3000), limitOpt(10_000)],
  },
  pro: {
    type: 'one-time',
    name: 'Pro',
    reference: 'pln_pro',
    requiresPayment: true,
    price: 9000,
    currency: 'USD',
    options: [flat(9000)],
  },
}

describe('narrateManageAccount v3 text-only copy', () => {
  it('narrates the limits plan when the purchase list is empty', () => {
    const { text } = narrateManageAccount(
      coolPayload({
        plans: [coolPlans.payg] as never,
        customer: coolCustomer({
          purchase: { customerRef: 'cus_cool', purchases: [] },
          limits: {
            ...runningLimits,
            remaining: -1,
            withinLimits: true,
            planRef: 'pln_payg',
            planName: 'Pay as you go',
            creditsPerUnit: 200,
            creditBalance: 599_800,
          },
        }),
      }),
    )
    expect(text).toContain('is on Pay as you go')
    expect(text).not.toContain('has no plan yet')
  })

  it('A · no plan: product, catalog fragments, reply-with-name', () => {
    const { text } = narrateManageAccount(
      coolPayload({
        plans: [coolPlans.free100, coolPlans.payg, coolPlans.starter, coolPlans.pro] as never,
        customer: coolCustomer(),
      }),
    )
    expect(text).toContain('Cool MCP has no plan yet')
    expect(text).not.toContain('so calls will fail')
    expect(text).toContain('Free gives 100 calls a month')
    expect(text).toContain('Pay as you go is 200 credits per call')
    expect(text).toContain('Starter is $30 a month for 10,000 calls')
    expect(text).toContain('Pro is $90 once for unlimited')
    expect(text).toContain('Reply with a plan name to activate it')
    expect(text).toContain('planRef: pln_free')
    expect(text).toContain(`To continue, call \`${VIEWER_TOOL_NAME}\` with view: "checkout"`)
  })

  it('B · credit plan: rate, balance, runway, add funds', () => {
    const { text } = narrateManageAccount(
      coolPayload({
        plans: [coolPlans.payg] as never,
        customer: coolCustomer({
          purchase: coolPurchase({
            name: 'Pay as you go',
            reference: 'pln_payg',
            isMetered: true,
            options: [perUnit(2)],
          }),
          limits: { ...runningLimits, remaining: -1, withinLimits: true },
        }),
      }),
    )
    expect(text).toContain(
      'Cool MCP is on Pay as you go, 200 credits per call. Balance 599,800 credits, about 2,999 calls.',
    )
    expect(text).toContain('Call `account` with view: \'topup\' to add credits.')
    expect(text).toContain(`To continue, call \`${VIEWER_TOOL_NAME}\` with view: "topup"`)
    expect(text).not.toContain('Auto-recharge')
  })

  it('C · subscription: remaining-led usage, renews, credits unused, change plan', () => {
    const { text } = narrateManageAccount(
      coolPayload({
        plans: [coolPlans.starter] as never,
        customer: coolCustomer({
          purchase: coolPurchase(
            {
              name: 'Starter',
              reference: 'pln_starter',
              isMetered: true,
              price: 3000,
              currency: 'USD',
              options: [cycle(), flat(3000), limitOpt(10_000)],
            },
            { billingCycle: 'monthly', endDate: '2026-09-12T00:00:00.000Z' },
          ),
          usage: {
            used: 6200,
            total: 10_000,
            remaining: 3800,
            periodEnd: '2026-09-12T00:00:00.000Z',
            meterRef: 'requests',
          },
          limits: runningLimits,
        }),
      }),
    )
    expect(text).toContain(
      'Cool MCP is on Starter, $30 a month. 3,800 of 10,000 calls left this period, renewing Sep 12.',
    )
    expect(text).toContain('Credits are not used on this plan')
    expect(text).toContain("Call `account` with view: 'checkout' to switch.")
    expect(text).toContain(`To continue, call \`${VIEWER_TOOL_NAME}\` with view: "checkout"`)
  })

  it('D · balance spent: snapshot with shortfall, not blocked-tool wording', () => {
    const { text } = narrateManageAccount(
      coolPayload({
        plans: [coolPlans.payg, coolPlans.starter] as never,
        customer: coolCustomer({
          balance: { ...usdBalance, credits: 0 },
          purchase: coolPurchase({
            name: 'Pay as you go',
            reference: 'pln_payg',
            isMetered: true,
            options: [perUnit(2)],
          }),
          limits: { ...runningLimits, remaining: 0, withinLimits: false, needsTopUp: true },
        }),
      }),
    )
    expect(text).toContain(
      'Cool MCP is on Pay as you go. Balance 0 credits; this call costs 200 credits — 200 short.',
    )
    expect(text).not.toContain('calls are failing')
    expect(text).toContain(
      "Call `account` with view: 'topup' to add credits, or with view: 'checkout' to switch to a plan that does not use credits.",
    )
    expect(text).toContain(`To continue, call \`${VIEWER_TOOL_NAME}\` with view: "topup"`)
    expect(text).toContain(`\`${VIEWER_TOOL_NAME}\` with view: "checkout"`)
  })

  it('E · free running: remaining, reset, see plans', () => {
    const { text } = narrateManageAccount(
      coolPayload({
        plans: [coolPlans.free3, coolPlans.starter] as never,
        customer: coolCustomer({
          purchase: coolPurchase({
            name: 'Free',
            reference: 'pln_free',
            requiresPayment: false,
            options: [cycle(), limitOpt(3)],
          }),
          usage: {
            used: 2,
            total: 3,
            remaining: 1,
            periodEnd: '2026-10-01T00:00:00.000Z',
            meterRef: 'requests',
          },
          limits: { ...runningLimits, remaining: 1, withinLimits: true },
        }),
      }),
    )
    expect(text).toContain(
      'Cool MCP is on the free plan: 1 of 3 calls left this month, resetting Oct 1.',
    )
    expect(text).toContain('Credits are not used on Free')
    expect(text).toContain("Call `account` with view: 'checkout' for more calls.")
    expect(text).toContain(`To continue, call \`${VIEWER_TOOL_NAME}\` with view: "checkout"`)
  })

  it('F · allowance used up: anti-trap, other plans, say a name', () => {
    const { text } = narrateManageAccount(
      coolPayload({
        plans: [coolPlans.free3, coolPlans.payg, coolPlans.starter] as never,
        customer: coolCustomer({
          purchase: coolPurchase({
            name: 'Free',
            reference: 'pln_free',
            requiresPayment: false,
            options: [cycle(), limitOpt(3)],
          }),
          usage: {
            used: 3,
            total: 3,
            remaining: 0,
            periodEnd: '2026-10-01T00:00:00.000Z',
            meterRef: 'requests',
          },
          limits: { ...runningLimits, remaining: 0, withinLimits: false },
        }),
      }),
    )
    expect(text).toContain(
      'Cool MCP is on Free. 3 calls are used up. Further calls fail until Oct 1.',
    )
    expect(text).toContain('Adding credits will not help, because Free does not spend them')
    expect(text).toContain('Pay as you go starts now using your existing 599,800 credits')
    expect(text).toContain('Starter is $30 a month')
    expect(text).toContain("Call `account` with view: 'checkout' to switch plan.")
    expect(text).toContain('planRef: pln_payg')
    expect(text).toContain(`To continue, call \`${VIEWER_TOOL_NAME}\` with view: "checkout"`)
  })

  it('C · one-time: once qualifier and no renewal wording', () => {
    const { text } = narrateManageAccount(
      coolPayload({
        plans: [coolPlans.pro] as never,
        customer: coolCustomer({
          purchase: coolPurchase(
            {
              name: 'Pro',
              reference: 'pln_pro',
              price: 9000,
              currency: 'USD',
              options: [flat(9000)],
            },
            { endDate: '2026-09-12T00:00:00.000Z' },
          ),
          usage: { remaining: -1 },
          limits: runningLimits,
        }),
      }),
    )
    expect(text).toContain('Cool MCP is on Pro, $90 once')
    expect(text).toContain('Unlimited calls')
    expect(text).not.toContain('a month')
    expect(text).not.toContain('renewing')
    expect(text).not.toContain('Renews')
  })

  it('account narration never says calls are failing', () => {
    const payloads = [
      coolPayload({
        plans: [coolPlans.free100, coolPlans.payg, coolPlans.starter, coolPlans.pro] as never,
        customer: coolCustomer(),
      }),
      coolPayload({
        plans: [coolPlans.free3, coolPlans.payg, coolPlans.starter] as never,
        customer: coolCustomer({
          purchase: coolPurchase({
            name: 'Free',
            reference: 'pln_free',
            requiresPayment: false,
            options: [cycle(), limitOpt(3)],
          }),
          usage: {
            used: 3,
            total: 3,
            remaining: 0,
            periodEnd: '2026-10-01T00:00:00.000Z',
            meterRef: 'requests',
          },
          limits: { ...runningLimits, remaining: 0, withinLimits: false },
        }),
      }),
    ]
    for (const payload of payloads) {
      expect(narrateManageAccount(payload).text).not.toContain('calls are failing')
    }
  })

  it('H · claim free tier: ready to activate, named activate_plan', () => {
    const { text } = narrateManageAccount(
      coolPayload({
        plans: [coolPlans.free3] as never,
        customer: coolCustomer({
          limits: { ...runningLimits, remaining: 0, activationRequired: true },
        }),
      }),
    )
    expect(text).toContain('Cool MCP has a free plan ready: 3 calls a month, no card')
    expect(text).toContain('Call `activate_plan` with a `planRef` to activate it.')
    expect(text).toContain('call `activate_plan` with planRef: "pln_free"')
    expect(text).not.toContain('has no plan yet')
  })

  it('H · claimable free plan without a billing cycle omits the interval', () => {
    const { text } = narrateManageAccount(
      coolPayload({
        plans: [
          {
            type: 'one-time',
            name: 'Free',
            reference: 'pln_free_once',
            requiresPayment: false,
            options: [limitOpt(3)],
          },
        ] as never,
        customer: coolCustomer({
          limits: { ...runningLimits, remaining: 0, activationRequired: true },
        }),
      }),
    )
    expect(text).toContain('Cool MCP has a free plan ready: 3 calls, no card')
    expect(text).not.toContain('a month')
    expect(text).toContain('call `activate_plan` with planRef: "pln_free_once"')
  })

  it('I · overage: used-of-allowance and still-working, no invented money', () => {
    const { text } = narrateManageAccount(
      coolPayload({
        plans: [coolPlans.starter] as never,
        customer: coolCustomer({
          purchase: coolPurchase(
            {
              name: 'Starter',
              reference: 'pln_starter',
              isMetered: true,
              price: 3000,
              currency: 'USD',
              options: [cycle(), flat(3000), limitOpt(10_000)],
            },
            { endDate: '2026-09-12T00:00:00.000Z' },
          ),
          usage: {
            used: 11_240,
            total: 10_000,
            remaining: 0,
            periodEnd: '2026-09-12T00:00:00.000Z',
            meterRef: 'requests',
          },
          limits: { ...runningLimits, remaining: 0, withinLimits: true, overage: true },
        }),
      }),
    )
    expect(text).toContain(
      'Cool MCP is over its Starter allowance: 11,240 of 10,000 calls used. Calls still work.',
    )
    expect(text).toContain("Call `account` with view: 'checkout' for a higher limit.")
    expect(text).not.toContain('$12.40')
    expect(text).not.toContain('will add')
    expect(text).toContain(`To continue, call \`${VIEWER_TOOL_NAME}\` with view: "checkout"`)
  })

  it('J · cancelled: runs until date, days left, reactivate', () => {
    const { text } = narrateManageAccount(
      coolPayload({
        plans: [coolPlans.starter] as never,
        customer: coolCustomer({
          purchase: coolPurchase(
            {
              name: 'Starter',
              reference: 'pln_starter',
              isMetered: true,
              price: 3000,
              currency: 'USD',
              options: [cycle(), flat(3000), limitOpt(10_000)],
            },
            {
              cancelledAt: '2026-09-01T00:00:00.000Z',
              endDate: '2026-10-12T00:00:00.000Z',
            },
          ),
          usage: {
            used: 6200,
            total: 10_000,
            remaining: 3800,
            periodEnd: '2026-10-12T00:00:00.000Z',
            meterRef: 'requests',
          },
          limits: runningLimits,
        }),
      }),
      { now: coolNow },
    )
    expect(text).toContain(
      "Cool MCP's Starter plan is cancelled and runs until Oct 12, 36 days away, with 3,800 of 10,000 calls left.",
    )
    expect(text).toContain('Calls stop after that')
    expect(text).toContain("Call `account` with view: 'account' to reactivate it.")
    expect(text).toContain(`To continue, call \`${VIEWER_TOOL_NAME}\` with view: "account"`)
  })
})

describe('narrateUpgrade', () => {
  it('lists paid plans and hides the free one', () => {
    // A free plan is `requiresPayment: false` — there is no `'free'` plan
    // type, and filtering on one let the upgrade surface offer a $0 plan.
    const { text } = narrateUpgrade(
      basePayload({
        plans: [
          {
            type: 'recurring',
            name: 'Free',
            requiresPayment: false,
            options: [cycle(), flat(0)],
          } as never,
          {
            type: 'recurring',
            name: 'Pro',
            requiresPayment: true,
            options: [cycle(), flat(20000)],
          } as never,
        ],
        customer: {
          purchase: {
            purchases: [
              {
                status: 'active',
                productRef: 'prd_x',
                planRef: 'pln_current',
                planSnapshot: { name: 'Current' },
              },
            ],
          },
        } as never,
      }),
    )
    expect(text).toContain('**Upgrade — Acme Knowledge Base**')
    expect(text).toContain('Pro · recurring · $200.00/month')
    expect(text).not.toContain('Free')
  })
})

describe('narrateTopup', () => {
  it('shows balance without invented presets', () => {
    const { text } = narrateTopup(
      basePayload({
        customer: {
          ref: 'cus_1',
          purchase: null,
          paymentMethod: null,
          balance: { ...usdBalance, credits: 865_500 } as never,
          usage: null,
        } as never,
      }),
    )
    expect(text).toContain('**Top up — Acme Knowledge Base**')
    expect(text).toContain('Balance: 865,500 credits')
    expect(text).not.toContain('Top-up presets:')
  })

  it('labels a topup checkout URL as Add credits', () => {
    const { text, links } = narrateTopup(
      basePayload({
        checkoutUrl: 'https://customer.solvapay.com/customer/checkout/topup?id=abc',
      }),
    )
    expect(text).toContain(
      '[Add credits](https://customer.solvapay.com/customer/checkout/topup?id=abc)',
    )
    expect(links).toEqual([
      { uri: 'https://customer.solvapay.com/customer/checkout/topup?id=abc', name: 'Add credits' },
    ])
  })
})

describe('parseMode', () => {
  it('parses the three valid modes', () => {
    expect(parseMode('ui')).toBe('ui')
    expect(parseMode('text')).toBe('text')
    expect(parseMode('auto')).toBe('auto')
  })
  it('defaults unknown values to auto', () => {
    expect(parseMode(undefined)).toBe('auto')
    expect(parseMode('nope')).toBe('auto')
  })
})

describe('narratedToolResult', () => {
  const payload = basePayload({
    customer: {
      ref: 'cus_1',
      purchase: {
        customerRef: 'cus_1',
        purchases: [{ productRef: 'prd_x', planSnapshot: { name: 'Pro', isMetered: false } }],
      } as never,
      paymentMethod: null,
      balance: null,
      usage: null,
    } as never,
  })

  it('default (auto) emits narration as content[0] and keeps _meta.ui', () => {
    const r = narratedToolResult('account', payload, undefined, {
      ui: { resourceUri: 'ui://x' },
    })
    expect(r.content[0].type).toBe('text')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).toContain('Acme Knowledge Base')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).not.toContain('shown in the panel')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).annotations).toBeUndefined()
    expect(r._meta).toEqual({ ui: { resourceUri: 'ui://x' } })
    expect(r.structuredContent).toEqual(payload)
  })

  it('mode=auto emits narrated text + _meta.ui without hiding it from the user', () => {
    const r = narratedToolResult('account', payload, 'auto', {
      ui: { resourceUri: 'ui://x' },
    })
    expect(r.content[0].type).toBe('text')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).toContain('Acme Knowledge Base')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).annotations).toBeUndefined()
    expect(r._meta).toEqual({ ui: { resourceUri: 'ui://x' } })
    expect(r.structuredContent).toEqual(payload)
  })

  it('mode=text strips _meta.ui and keeps the narration visible', () => {
    const r = narratedToolResult('account', payload, 'text', {
      ui: { resourceUri: 'ui://x' },
      audience: 'ui',
    })
    expect(r._meta).toEqual({ audience: 'ui' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).annotations).toBeUndefined()
  })

  it('mode=ui emits a self-sufficient placeholder, never a panel pointer', () => {
    const r = narratedToolResult('account', payload, 'ui', {
      ui: { resourceUri: 'ui://x' },
    })
    expect(r.content).toHaveLength(2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).toContain('Opened your Acme Knowledge Base account.')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).not.toContain('shown in the panel')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).not.toContain("mode: 'text'")
    expect(r._meta).toEqual({ ui: { resourceUri: 'ui://x' } })
  })

  it('mode=ui upgrade includes plan name and checkout URL in the placeholder', () => {
    const upgradePayload = basePayload({
      view: 'checkout',
      checkoutUrl: 'https://customer.solvapay.com/demo?session=abc',
      plans: [
        {
          type: 'recurring',
          name: 'Pro',
          reference: 'plan_pro',
          requiresPayment: true,
          options: [cycle(), flat(2000)],
        },
      ] as never,
    })
    const r = narratedToolResult('checkout', upgradePayload, 'ui', {
      ui: { resourceUri: 'ui://x' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (r.content[0] as any).text as string
    expect(text).toContain('Pro')
    expect(text).toContain('[Open checkout](https://customer.solvapay.com/demo?session=abc)')
    expect(text).not.toMatch(/Checkout: https:/)
    expect(text).not.toContain('shown in the panel')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[1] as any).text).toContain('planRef: plan_pro')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[1] as any).text).toContain('Plans available:')
  })

  it('upgrade narration includes planRef and checkout URL without a second tool hop', () => {
    const text = narrateUpgrade(
      basePayload({
        view: 'checkout',
        checkoutUrl: 'https://customer.solvapay.com/demo?session=abc',
        plans: [
          {
            type: 'recurring',
            name: 'Pro',
            reference: 'plan_pro',
            requiresPayment: true,
            options: [cycle(), flat(2000)],
          },
        ] as never,
      }),
    ).text
    expect(text).toContain('planRef: plan_pro')
    expect(text).toContain('[Open checkout](https://customer.solvapay.com/demo?session=abc)')
    expect(text).toContain('expires in 15 minutes')
    expect(text).not.toMatch(/Checkout: https:/)
    expect(text).not.toContain('shown in the panel')
  })

  it('topup narration names the checkout link instead of dumping the URL', () => {
    const { text, links } = narrateTopup(
      basePayload({
        view: 'topup',
        checkoutUrl: 'https://customer.solvapay.com/demo?session=abc',
      }),
    )
    expect(text).toContain('[Open checkout](https://customer.solvapay.com/demo?session=abc)')
    expect(text).toContain('expires in 15 minutes')
    expect(text).not.toMatch(/Checkout: https:/)
    expect(links).toEqual([
      { uri: 'https://customer.solvapay.com/demo?session=abc', name: 'Open checkout' },
    ])
  })

  it('manage_account narration reads total/remaining/periodEnd, not the ghost limit/resetsAt fields', () => {
    const text = narrateManageAccount(
      basePayload({
        customer: {
          ref: 'cus_1',
          purchase: {
            customerRef: 'cus_1',
            purchases: [
              {
                productRef: 'prd_x',
                planSnapshot: {
                  name: 'Starter',
                  isMetered: true,
                  price: 3000,
                  currency: 'USD',
                  options: [cycle(), flat(3000), { kind: 'limit', cap: 10_000, meter: 'requests' }],
                },
              },
            ],
          } as never,
          paymentMethod: null,
          balance: usdBalance,
          usage: {
            used: 6200,
            total: 10_000,
            remaining: 3800,
            periodEnd: '2026-09-12T00:00:00.000Z',
            // Ghost fields the old usageRow() invented. If they leak back in,
            // the line would say "Used 3 of 3" / "resets Oct 1".
            limit: 3,
            resetsAt: '2026-10-01T00:00:00.000Z',
          },
          limits: {
            remaining: 3800,
            withinLimits: true,
            activationRequired: false,
            overage: false,
            needsTopUp: false,
          },
        } as never,
      }),
    ).text
    expect(text).toContain('3,800 of 10,000 calls left')
    expect(text).toContain('Sep 12')
    expect(text).not.toContain('Used 3 of 3')
    expect(text).not.toContain('Oct 1')
    expect(text).not.toContain('docs://solvapay/overview.md')
  })

  it('ui placeholder carries balance when the customer snapshot has one', () => {
    const withBalance = basePayload({
      customer: {
        ref: 'cus_1',
        purchase: null,
        paymentMethod: null,
        balance: {
          credits: 865500,
          displayCurrency: 'USD',
          displayExchangeRate: 1,
          creditsPerMinorUnit: 100,
        } as never,
        usage: null,
      } as never,
    })
    const r = narratedToolResult('topup', withBalance, 'ui', { ui: { resourceUri: 'ui://x' } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).toContain('Balance: 865,500 credits')
  })

  it('falls back to JSON dump for unknown views', () => {
    const r = narratedToolResult('unknown_view', payload, 'auto')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).toContain('"view"')
  })
})

describe('text-lane self-sufficiency', () => {
  const linkedPayload = basePayload({
    portalUrl: 'https://customer.solvapay.com/manage?id=abc',
    checkoutUrl: 'https://customer.solvapay.com/checkout?id=def',
    plans: [
      {
        type: 'usage-based',
        name: 'Pay as you go',
        requiresPayment: true,
        options: [perUnit(2)],
      } as never,
    ],
    customer: {
      ref: 'cus_1',
      purchase: {
        customerRef: 'cus_1',
        purchases: [
          {
            productRef: 'prd_x',
            planSnapshot: {
              name: 'dafsfa',
              isMetered: false,
              price: 9000,
              currency: 'USD',
              options: [cycle(), flat(9000)],
            },
          },
        ],
      } as never,
      paymentMethod: null,
      balance: usdBalance,
      usage: null,
    } as never,
  })

  function textBlocks(content: SolvaPayCallToolResult['content']): string {
    return content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('\n')
  }

  function resourceLinkUris(content: unknown[]): string[] {
    return content
      .filter(
        (b): b is { type: 'resource_link'; uri: string } =>
          typeof b === 'object' && b !== null && (b as { type?: string }).type === 'resource_link',
      )
      .map(b => b.uri)
  }

  it.each(['auto', 'text', 'ui'] as const)(
    'mode=%s: every resource_link uri also appears as a markdown link in a text block',
    mode => {
      const r = narratedToolResult('account', linkedPayload, mode, {
        ui: { resourceUri: 'ui://x' },
      })
      const uris = resourceLinkUris(r.content as unknown[])
      expect(uris.length).toBeGreaterThan(0)
      const texts = textBlocks(r.content)
      for (const uri of uris) {
        expect(texts).toContain(`](${uri})`)
      }
    },
  )

  it('narrateManageAccount emits Manage account before checkout', () => {
    const { text } = narrateManageAccount(linkedPayload)
    const manageAt = text.indexOf('[Manage account](https://customer.solvapay.com/manage?id=abc)')
    const checkoutAt = text.indexOf(
      '[Open checkout](https://customer.solvapay.com/checkout?id=def)',
    )
    expect(manageAt).toBeGreaterThanOrEqual(0)
    expect(checkoutAt).toBeGreaterThan(manageAt)
    expect(text).toContain('(expires in 15 minutes)')
  })

  it('no narrator emits the slash-command recovery form', () => {
    for (const [view, narrate] of Object.entries(NARRATORS)) {
      const { text } = narrate(linkedPayload)
      expect(text, view).not.toMatch(/Commands:\s*`\//)
    }
  })

  it("uiPlaceholder('account') names the active plan, matching the narrated Plan row", () => {
    const placeholder = uiPlaceholder('account', linkedPayload)
    const { text } = narrateManageAccount(linkedPayload)
    expect(placeholder).toContain('dafsfa')
    expect(placeholder).toContain('$90.00')
    expect(placeholder).not.toContain('Pay as you go')
    expect(text).toMatch(/is on dafsfa/)
    expect(placeholder).toContain('dafsfa')
  })

  it("uiPlaceholder('account') omits a catalog plan when there is no active purchase", () => {
    const placeholder = uiPlaceholder(
      'account',
      coolPayload({
        plans: [coolPlans.pro] as never,
        customer: coolCustomer(),
      }),
    )
    expect(placeholder).toContain('Opened your Cool MCP account.')
    expect(placeholder).not.toContain('$90')
    expect(placeholder).not.toContain('Pro')
  })

  it("uiPlaceholder('checkout') still reads from the catalogue", () => {
    const placeholder = uiPlaceholder('checkout', linkedPayload)
    expect(placeholder).toContain('Pay as you go')
    expect(placeholder).not.toContain('dafsfa')
  })
})

describe('narrateAlreadyActive', () => {
  it('names the shortfall when balance and cost are present', () => {
    expect(narrateAlreadyActive({ creditBalance: 91_000, creditsPerUnit: 100_000 })).toContain(
      'Balance 91,000 credits; this call costs 100,000 credits — 9,000 short',
    )
  })

  it('stays terse when cost is missing', () => {
    expect(narrateAlreadyActive({ creditBalance: 91_000 })).toBe('This plan is already active.')
  })
})

describe('narrateActivatePlan', () => {
  it('narrates payment_required with a checkout URL', () => {
    const text = narrateActivatePlan({
      status: 'payment_required',
      planName: 'Pro',
      checkoutUrl: 'https://pay.example/checkout',
    })
    expect(text).toContain('Pro requires payment')
    expect(text).toContain('[Open checkout](https://pay.example/checkout)')
    expect(text).toContain("`account` with view: 'checkout'")
  })

  it('narrates invalid without dumping JSON', () => {
    expect(narrateActivatePlan({ status: 'invalid' })).toContain(
      "Call `account` with view: 'checkout' to see plans",
    )
  })
})

describe('narrateAutoRecharge', () => {
  it('states that auto-recharge is off and prefers the auto-recharge deep link', () => {
    const { text, links } = narrateAutoRecharge(
      basePayload({
        portalUrl: 'https://pay.example/manage',
        autoRechargeUrl: 'https://pay.example/manage?tab=credits&intent=autorecharge',
        customer: {
          ref: 'cus_1',
          autoRecharge: { enabled: false },
          balance: usdBalance,
        } as never,
      }),
    )
    expect(text).toContain('Auto-recharge is off')
    expect(text).toContain('Turn it on from the link below')
    expect(text).toContain("`account` with view: \"account\"")
    expect(
      links?.some(
        link =>
          link.uri === 'https://pay.example/manage?tab=credits&intent=autorecharge' &&
          link.name === 'Turn on auto-recharge',
      ),
    ).toBe(true)
  })

  it('falls back to portalUrl when autoRechargeUrl is absent', () => {
    const { text, links } = narrateAutoRecharge(
      basePayload({
        portalUrl: 'https://pay.example/manage',
        customer: {
          ref: 'cus_1',
          autoRecharge: { enabled: true, status: 'active' },
          balance: usdBalance,
        } as never,
      }),
    )
    expect(text).toContain('Auto-recharge is on')
    expect(text).toContain('https://pay.example/manage')
    expect(links?.some(link => link.uri === 'https://pay.example/manage')).toBe(true)
  })

  it('narrates a failed card so the text lane can send the customer to fix it', () => {
    const { text, links } = narrateAutoRecharge(
      basePayload({
        autoRechargeUrl: 'https://pay.example/manage?tab=credits&intent=autorecharge',
        customer: {
          ref: 'cus_1',
          autoRecharge: { enabled: true, status: 'failed' },
          balance: usdBalance,
        } as never,
      }),
    )
    expect(text).toContain('Auto-recharge failed — update your card to resume')
    expect(
      links?.some(
        link =>
          link.uri === 'https://pay.example/manage?tab=credits&intent=autorecharge' &&
          link.name === 'Manage auto-recharge',
      ),
    ).toBe(true)
  })
})
