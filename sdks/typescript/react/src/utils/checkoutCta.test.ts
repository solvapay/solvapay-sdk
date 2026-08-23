import { describe, it, expect } from 'vitest'
import { resolveCta } from './checkoutCta'
import { enCopy } from '../i18n/en'
import type { Plan, Product } from '../types'

const plan = (overrides: Partial<Plan>): Plan => ({
  reference: 'pln',
  ...overrides,
})

const product: Product = { reference: 'prd', name: 'Widget API' }

describe('resolveCta', () => {
  it('short-circuits to override when provided', () => {
    expect(
      resolveCta({
        variant: 'oneTime',
        copy: enCopy,
        amountFormatted: '$9.99',
        override: 'Pay with Card',
      }),
    ).toBe('Pay with Card')
  })

  it('returns Subscribe for recurring without trial', () => {
    expect(
      resolveCta({
        variant: 'recurring',
        plan: plan({ type: 'recurring' }),
        copy: enCopy,
        amountFormatted: '$9.99',
      }),
    ).toBe('Subscribe')
  })

  it('returns trial CTA when trialDays > 0', () => {
    expect(
      resolveCta({
        variant: 'recurring',
        plan: plan({ type: 'recurring', trialDays: 14 }),
        copy: enCopy,
        amountFormatted: '$9.99',
      }),
    ).toBe('Start 14-day free trial')
  })

  it('returns Pay {amount} for one-time', () => {
    expect(
      resolveCta({
        variant: 'oneTime',
        plan: plan({ type: 'one-time' }),
        copy: enCopy,
        amountFormatted: '$19.99',
      }),
    ).toBe('Pay $19.99')
  })

  it('returns Add {amount} for topup', () => {
    expect(
      resolveCta({
        variant: 'topup',
        copy: enCopy,
        amountFormatted: '$5.00',
      }),
    ).toBe('Add $5.00')
  })

  it('returns Start using {product} for metered', () => {
    expect(
      resolveCta({
        variant: 'usageMetered',
        product,
        copy: enCopy,
        amountFormatted: '$0.02',
      }),
    ).toBe('Start using Widget API')
  })
})
