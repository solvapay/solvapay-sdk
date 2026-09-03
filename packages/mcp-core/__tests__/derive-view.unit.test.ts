import { describe, expect, it } from 'vitest'
import { deriveDefaultView } from '../src'
import type { BootstrapCustomer, BootstrapPayload } from '../src'

function customer(overrides: {
  hasPlan?: boolean
  credits?: number | null
  purpose?: string
}): BootstrapCustomer {
  const purchases = overrides.hasPlan
    ? [
        {
          planSnapshot: { name: 'Pro' },
          metadata: { purpose: overrides.purpose },
        },
      ]
    : overrides.purpose
      ? [{ metadata: { purpose: overrides.purpose } }]
      : []
  return {
    ref: 'cus_1',
    purchase: { customerRef: 'cus_1', purchases },
    paymentMethod: null,
    balance:
      overrides.credits === undefined
        ? null
        : {
            credits: overrides.credits,
            displayCurrency: 'USD',
            creditsPerMinorUnit: 1,
            displayExchangeRate: 1,
          },
    usage: null,
  } as BootstrapCustomer
}

function payload(customerSnapshot: BootstrapCustomer | null): Pick<BootstrapPayload, 'customer'> {
  return { customer: customerSnapshot }
}

describe('deriveDefaultView', () => {
  it('returns checkout when there is no customer', () => {
    expect(deriveDefaultView(payload(null))).toBe('checkout')
  })

  it('returns checkout when the customer has no plan purchase', () => {
    expect(deriveDefaultView(payload(customer({ hasPlan: false, credits: 0 })))).toBe('checkout')
  })

  it('returns checkout when the only purchase is a credit_topup', () => {
    expect(
      deriveDefaultView(payload(customer({ hasPlan: false, purpose: 'credit_topup', credits: 500 }))),
    ).toBe('checkout')
  })

  it('returns topup when the customer has a plan and zero credits', () => {
    expect(deriveDefaultView(payload(customer({ hasPlan: true, credits: 0 })))).toBe('topup')
  })

  it('returns account when the customer has a plan and a positive balance', () => {
    expect(deriveDefaultView(payload(customer({ hasPlan: true, credits: 100 })))).toBe('account')
  })

  it('returns account when the customer has a plan and no balance row', () => {
    expect(deriveDefaultView(payload(customer({ hasPlan: true })))).toBe('account')
  })

  it('falls through to the first enabled view when the preferred one is disabled', () => {
    expect(deriveDefaultView(payload(null), new Set(['account']))).toBe('account')
    expect(deriveDefaultView(payload(customer({ hasPlan: true, credits: 0 })), new Set(['checkout']))).toBe(
      'checkout',
    )
  })

  it('throws when no views are enabled', () => {
    expect(() => deriveDefaultView(payload(null), new Set())).toThrow(/no enabled views/)
  })
})
