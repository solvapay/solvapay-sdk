import { describe, it, expect } from 'vitest'
import {
  narrateManageAccount,
  narrateUpgrade,
  narrateTopup,
  narrateActivatePlan,
  balanceSummary,
} from './narrate'
import { narratedToolResult, parseMode } from './helpers'
import type { BootstrapPayload } from './types'

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
    expect(text).toContain('$10.00')
    expect(text).toContain('€9.00')
    expect(text).toContain('/month')
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
    expect(text).toContain('No active plan.')
    expect(text).toContain('Free · no payment required')
    expect(text).toContain('Starter · pay as you go')
    expect(text).toContain('Unlimited · recurring · $500.00/month')
    expect(text).toContain('Docs: docs://solvapay/overview.md')
    expect(text).not.toContain('Commands:')
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
    expect(text).toContain('Lifetime · one-time · $99.00')
    expect(text).toContain('Team · subscription + usage · $49.00/month')
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
    expect(text).toContain('Pro · recurring · $29.00/month · 14-day trial')
  })

  it('produces an account summary when there is an active purchase', () => {
    const payload = basePayload({
      customer: {
        ref: 'cus_1',
        purchase: {
          customerRef: 'cus_1',
          purchases: [
            {
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
    expect(text).toContain('Plan: Unlimited')
    expect(text).toContain('$500.00/monthly')
    expect(text).toContain('renews May')
    expect(text).toContain('Balance: 100 credits')
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
    expect(text).toContain('Next call: $0.02')
    expect(text).not.toContain('Cost per call:')
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
    expect(text).toContain('Next call: SEK\u00a01.00')
    expect(text).not.toContain('Cost per call:')
  })

  it('omits cost per call when the charge currency is not the balance currency', () => {
    // The balance peg only carries the rate for its own display currency;
    // reusing it for a EUR charge would be wrong by the FX ratio.
    const { text } = narrateManageAccount(meteredAccount([perUnit(2, 'eur')]))
    expect(text).not.toContain('Cost per call')
    expect(text).toContain('Balance: 5,000 credits')
  })

  it('omits cost per call for a snapshot frozen before options existed', () => {
    const { text } = narrateManageAccount(meteredAccount(undefined))
    expect(text).not.toContain('Cost per call')
    expect(text).toContain('Balance: 5,000 credits')
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
    expect(text).toContain('No active plan.')
    expect(text).not.toContain('**Acme Knowledge Base — your account**')
    expect(text).toContain('Docs: docs://solvapay/overview.md')
    expect(text).not.toContain('Commands:')
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
      }),
    )
    expect(text).toContain('**Upgrade — Acme Knowledge Base**')
    expect(text).toContain('Pro · recurring · $200.00/month')
    expect(text).not.toContain('Free')
  })
})

describe('narrateTopup', () => {
  it('shows balance + presets', () => {
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
    expect(text).toContain('Top-up presets:')
  })
})

describe('narrateActivatePlan', () => {
  it('lists every plan, free ones included', () => {
    const { text } = narrateActivatePlan(
      basePayload({
        plans: [
          { type: 'recurring', name: 'Free', requiresPayment: false, options: [cycle()] } as never,
          {
            type: 'usage-based',
            name: 'Starter',
            requiresPayment: true,
            options: [perUnit(1)],
          } as never,
        ],
      }),
    )
    expect(text).toContain('**Activate a plan — Acme Knowledge Base**')
    expect(text).toContain('Free · no payment required')
    expect(text).toContain('Starter · pay as you go')
  })
})

function textOf(block: { type: string; text?: string; annotations?: unknown }): string {
  if (block.type !== 'text' || typeof block.text !== 'string') {
    throw new Error(`expected text content, got ${block.type}`)
  }
  return block.text
}

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
        purchases: [{ planSnapshot: { name: 'Pro', isMetered: false } }],
      } as never,
      paymentMethod: null,
      balance: null,
      usage: null,
    } as never,
  })

  it('default (auto) emits narrated markdown + _meta.ui and no audience annotation', () => {
    const r = narratedToolResult('manage_account', payload, undefined, {
      ui: { resourceUri: 'ui://x' },
    })
    expect(r.content).toHaveLength(1)
    expect(r.content[0].type).toBe('text')
    expect(textOf(r.content[0])).toContain('Acme Knowledge Base')
    expect(textOf(r.content[0])).not.toContain('in the panel')
    expect(textOf(r.content[0])).not.toContain("mode: 'text'")
    expect(r.content[0].type === 'text' ? r.content[0].annotations : undefined).toBeUndefined()
    expect(r._meta).toEqual({ ui: { resourceUri: 'ui://x' } })
    expect(r.structuredContent).toEqual(payload)
  })

  it('mode=auto matches the omitted-mode default', () => {
    const r = narratedToolResult('manage_account', payload, 'auto', {
      ui: { resourceUri: 'ui://x' },
    })
    expect(r.content).toHaveLength(1)
    expect(textOf(r.content[0])).toContain('Acme Knowledge Base')
    expect(r.content[0].type === 'text' ? r.content[0].annotations : undefined).toBeUndefined()
    expect(r._meta).toEqual({ ui: { resourceUri: 'ui://x' } })
    expect(r.structuredContent).toEqual(payload)
  })

  it('mode=text strips _meta.ui and does not annotate the narrated block', () => {
    const r = narratedToolResult('manage_account', payload, 'text', {
      ui: { resourceUri: 'ui://x' },
      audience: 'ui',
    })
    expect(r._meta).toEqual({ audience: 'ui' })
    expect(r.content[0].type === 'text' ? r.content[0].annotations : undefined).toBeUndefined()
  })

  it('mode=ui emits placeholder plus unannotated narrated block', () => {
    const r = narratedToolResult('manage_account', payload, 'ui', {
      ui: { resourceUri: 'ui://x' },
    })
    expect(r.content).toHaveLength(2)
    expect(textOf(r.content[0])).toContain('Opened your Acme Knowledge Base account.')
    expect(textOf(r.content[0])).not.toContain('in the panel')
    expect(textOf(r.content[0])).not.toContain("mode: 'text'")
    expect(r.content[1].type === 'text' ? r.content[1].annotations : undefined).toBeUndefined()
    expect(r._meta).toEqual({ ui: { resourceUri: 'ui://x' } })
  })

  it('mode=ui upgrade placeholder names the plan instead of pointing at a panel', () => {
    const upgradePayload = basePayload({
      view: 'checkout',
      checkoutUrl: 'https://pay.test/x',
      plans: [
        {
          type: 'recurring',
          name: 'Pro',
          requiresPayment: true,
          options: [cycle(), flat(2000)],
        },
      ] as never,
    })
    const r = narratedToolResult('upgrade', upgradePayload, 'ui', { ui: { resourceUri: 'ui://x' } })
    expect(textOf(r.content[0])).toContain('Opened Acme Knowledge Base upgrade.')
    expect(textOf(r.content[0])).toContain('Pro')
    expect(textOf(r.content[0])).toContain('https://pay.test/x')
    expect(textOf(r.content[0])).not.toContain('in the panel')
    expect(textOf(r.content[1])).toContain('Pro')
    expect(textOf(r.content[1])).toContain('Plans available:')
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
    expect(textOf(r.content[0])).toContain('Balance: 865,500 credits')
  })

  it('falls back to JSON dump for unknown tool names', () => {
    const r = narratedToolResult('unknown_tool', payload, 'auto')
    expect(textOf(r.content[0])).toContain('"view"')
  })
})
