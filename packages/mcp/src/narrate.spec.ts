import { describe, it, expect } from 'vitest'
import {
  narrateManageAccount,
  narrateUpgrade,
  narrateTopup,
  narrateActivatePlan,
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

describe('narrateManageAccount', () => {
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
        balance: { credits: 100, displayCurrency: 'USD', displayExchangeRate: 1 } as never,
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
          balance: { credits: 865500, displayCurrency: 'USD', displayExchangeRate: 1 } as never,
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
        purchases: [{ planSnapshot: { name: 'Pro', planType: 'recurring' } }],
      } as never,
      paymentMethod: null,
      balance: null,
      usage: null,
    } as never,
  })

  it('default (auto) emits narrated text + _meta.ui', () => {
    const r = narratedToolResult('manage_account', payload, 'auto', { ui: { resourceUri: 'ui://x' } })
    expect(r.content[0].type).toBe('text')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).toContain('Acme Knowledge Base')
    expect(r._meta).toEqual({ ui: { resourceUri: 'ui://x' } })
    expect(r.structuredContent).toEqual(payload)
  })

  it('mode=text strips _meta.ui', () => {
    const r = narratedToolResult('manage_account', payload, 'text', {
      ui: { resourceUri: 'ui://x' },
      audience: 'ui',
    })
    expect(r._meta).toEqual({ audience: 'ui' })
  })

  it('mode=ui replaces narrated text with placeholder', () => {
    const r = narratedToolResult('manage_account', payload, 'ui', { ui: { resourceUri: 'ui://x' } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).toContain('Opening your')
    expect(r._meta).toEqual({ ui: { resourceUri: 'ui://x' } })
  })

  it('falls back to JSON dump for unknown tool names', () => {
    const r = narratedToolResult('unknown_tool', payload, 'auto')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((r.content[0] as any).text).toContain('"view"')
  })
})
