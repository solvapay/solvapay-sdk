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
    const { text } = narrateManageAccount(
      basePayload({
        plans: [
          {
            planType: 'recurring',
            name: 'Global',
            price: 1000,
            currency: 'USD',
            billingCycle: 'monthly',
            pricingOptions: [
              { currency: 'USD', price: 1000, default: true },
              { currency: 'EUR', price: 900 },
            ],
          },
        ] as never,
      }),
    )

    expect(text).toContain('Global')
    expect(text).toContain('$10.00')
    expect(text).toContain('€9.00')
  })

  it('produces a cold-start welcome with plan list', () => {
    const { text } = narrateManageAccount(
      basePayload({
        plans: [
          { planType: 'free', name: 'Free' },
          { planType: 'usage-based', name: 'Starter', price: 1, currency: 'USD' },
          { planType: 'recurring', name: 'Unlimited', price: 50000, currency: 'USD', billingCycle: 'monthly' },
        ] as never,
      }),
    )
    expect(text.startsWith('**Welcome to Acme Knowledge Base**')).toBe(true)
    expect(text).toContain('No active plan.')
    expect(text).toContain('Free')
    expect(text).toContain('Starter')
    expect(text).toContain('Unlimited')
    expect(text).toContain('Commands: `/activate_plan` `/upgrade`')
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
                planType: 'recurring',
                price: 50000,
                currency: 'USD',
                billingCycle: 'monthly',
              },
              endDate: '2026-05-01T00:00:00Z',
            },
          ],
        } as never,
        paymentMethod: null,
        balance: {
          credits: 100,
          displayCurrency: 'USD',
          displayExchangeRate: 1,
          creditsPerMinorUnit: 100,
        } as never,
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

  it('shows cost per call for usage-based plans from planSnapshot.creditsPerUnit', () => {
    const { text } = narrateManageAccount(
      basePayload({
        customer: {
          ref: 'cus_1',
          purchase: {
            customerRef: 'cus_1',
            purchases: [
              {
                planSnapshot: {
                  name: 'Pay as you go',
                  planType: 'usage-based',
                  creditsPerUnit: 1000,
                },
              },
            ],
          } as never,
          paymentMethod: null,
          balance: {
            credits: 5000,
            displayCurrency: 'USD',
            displayExchangeRate: 1,
            creditsPerMinorUnit: 100,
          } as never,
          usage: null,
        } as never,
      }),
    )
    expect(text).toContain('Cost per call: 1,000 credits')
    expect(text).toContain('Balance: 5,000 credits')
  })

  it('falls back to data.plans when planSnapshot omits creditsPerUnit', () => {
    const { text } = narrateManageAccount(
      basePayload({
        plans: [
          {
            reference: 'pln_payg',
            name: 'Pay as you go',
            planType: 'usage-based',
            creditsPerUnit: 1000,
          } as never,
        ],
        customer: {
          ref: 'cus_1',
          purchase: {
            customerRef: 'cus_1',
            purchases: [
              {
                planRef: 'pln_payg',
                planSnapshot: {
                  name: 'Pay as you go',
                  planType: 'usage-based',
                },
              },
            ],
          } as never,
          paymentMethod: null,
          balance: {
            credits: 2000,
            displayCurrency: 'USD',
            displayExchangeRate: 1,
            creditsPerMinorUnit: 100,
          } as never,
          usage: null,
        } as never,
      }),
    )
    expect(text).toContain('Cost per call: 1,000 credits')
  })

  it('shows balance and no-plan welcome when only a credit_topup purchase exists', () => {
    const { text } = narrateManageAccount(
      basePayload({
        plans: [
          { planType: 'usage-based', name: 'Pay as you go', price: 0, currency: 'USD' } as never,
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
          balance: {
            credits: 865_500,
            displayCurrency: 'USD',
            displayExchangeRate: 1,
            creditsPerMinorUnit: 100,
          } as never,
          usage: null,
        } as never,
      }),
    )
    expect(text.startsWith('**Welcome to Acme Knowledge Base**')).toBe(true)
    expect(text).toContain('Balance: 865,500 credits')
    expect(text).toContain('No active plan.')
    expect(text).not.toContain('**Acme Knowledge Base — your account**')
    expect(text).toContain('Commands: `/activate_plan` `/upgrade`')
  })
})

describe('narrateUpgrade', () => {
  it('lists paid plans', () => {
    const { text } = narrateUpgrade(
      basePayload({
        plans: [
          { planType: 'free', name: 'Free' } as never,
          { planType: 'recurring', name: 'Pro', price: 20000, currency: 'USD', billingCycle: 'monthly' } as never,
        ],
      }),
    )
    expect(text).toContain('**Upgrade — Acme Knowledge Base**')
    expect(text).toContain('Pro')
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
          balance: {
            credits: 865500,
            displayCurrency: 'USD',
            displayExchangeRate: 1,
            creditsPerMinorUnit: 100,
          } as never,
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
  it('lists all plans', () => {
    const { text } = narrateActivatePlan(
      basePayload({
        plans: [
          { planType: 'free', name: 'Free' } as never,
          { planType: 'usage-based', name: 'Starter' } as never,
        ],
      }),
    )
    expect(text).toContain('**Activate a plan — Acme Knowledge Base**')
    expect(text).toContain('Free')
    expect(text).toContain('Starter')
  })
})

describe('parseMode', () => {
  it('parses the three valid modes', () => {
    expect(parseMode('ui')).toBe('ui')
    expect(parseMode('text')).toBe('text')
    expect(parseMode('auto')).toBe('auto')
  })
  it('defaults unknown values to ui', () => {
    expect(parseMode(undefined)).toBe('ui')
    expect(parseMode('nope')).toBe('ui')
  })
})

describe('narratedToolResult', () => {
  const payload = basePayload({
    customer: {
      ref: 'cus_1',
      purchase: {
        customerRef: 'cus_1',
        purchases: [{ planSnapshot: { name: 'Pro', planType: 'recurring' } }],
      } as never,
      paymentMethod: null,
      balance: null,
      usage: null,
    } as never,
  })

  it('default (ui) emits placeholder + assistant narrated block + _meta.ui', () => {
    const r = narratedToolResult('manage_account', payload, undefined, {
      ui: { resourceUri: 'ui://x' },
    })
    expect(r.content).toHaveLength(2)
    expect(r.content[0].type).toBe('text')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).toContain('Opened your Acme Knowledge Base account.')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).toContain('Account details are shown in the panel.')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).not.toContain("mode: 'text'")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).annotations).toBeUndefined()
    expect(r.content[1].type).toBe('text')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[1] as any).text).toContain('Acme Knowledge Base')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[1] as any).annotations).toEqual({ audience: ['assistant'] })
    expect(r._meta).toEqual({ ui: { resourceUri: 'ui://x' } })
    expect(r.structuredContent).toEqual(payload)
  })

  it('mode=auto emits narrated text + _meta.ui with assistant audience', () => {
    const r = narratedToolResult('manage_account', payload, 'auto', {
      ui: { resourceUri: 'ui://x' },
    })
    expect(r.content[0].type).toBe('text')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).toContain('Acme Knowledge Base')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).annotations).toEqual({ audience: ['assistant'] })
    expect(r._meta).toEqual({ ui: { resourceUri: 'ui://x' } })
    expect(r.structuredContent).toEqual(payload)
  })

  it('mode=text strips _meta.ui and annotates narrated block for the assistant', () => {
    const r = narratedToolResult('manage_account', payload, 'text', {
      ui: { resourceUri: 'ui://x' },
      audience: 'ui',
    })
    expect(r._meta).toEqual({ audience: 'ui' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).annotations).toEqual({ audience: ['assistant'] })
  })

  it('mode=ui emits placeholder plus assistant-audience narrated block', () => {
    const r = narratedToolResult('manage_account', payload, 'ui', {
      ui: { resourceUri: 'ui://x' },
    })
    expect(r.content).toHaveLength(2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).toContain('Opened your Acme Knowledge Base account.')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).not.toContain("mode: 'text'")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[1] as any).annotations).toEqual({ audience: ['assistant'] })
    expect(r._meta).toEqual({ ui: { resourceUri: 'ui://x' } })
  })

  it('mode=ui upgrade includes plan list in assistant narrated block', () => {
    const upgradePayload = basePayload({
      view: 'checkout',
      plans: [
        { planType: 'recurring', name: 'Pro', price: 2000, currency: 'USD', billingCycle: 'monthly' },
      ] as never,
    })
    const r = narratedToolResult('upgrade', upgradePayload, 'ui', { ui: { resourceUri: 'ui://x' } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).toContain('Plans and checkout are shown in the panel.')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[1] as any).text).toContain('Pro')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[1] as any).text).toContain('Plans available:')
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

  it('falls back to JSON dump for unknown tool names', () => {
    const r = narratedToolResult('unknown_tool', payload, 'auto')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).toContain('"view"')
  })
})
