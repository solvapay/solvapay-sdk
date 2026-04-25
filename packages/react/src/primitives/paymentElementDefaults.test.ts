import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PAYMENT_ELEMENT_OPTIONS,
  withPaymentElementDefaults,
} from './paymentElementDefaults'

describe('withPaymentElementDefaults', () => {
  it('disables Stripe Link by default when no options are supplied', () => {
    const merged = withPaymentElementDefaults()
    expect(merged).toEqual({ wallets: { link: 'never' } })
  })

  it('disables Stripe Link by default when options omit the wallets field', () => {
    const merged = withPaymentElementDefaults({ business: { name: 'Acme' } })
    expect(merged?.wallets).toEqual({ link: 'never' })
    expect(merged?.business).toEqual({ name: 'Acme' })
  })

  it('lets callers override the Link default when they explicitly pass wallets.link', () => {
    const merged = withPaymentElementDefaults({ wallets: { link: 'auto' } })
    expect(merged?.wallets?.link).toBe('auto')
  })

  it('composes caller-supplied wallet flags with the default link=never', () => {
    const merged = withPaymentElementDefaults({ wallets: { applePay: 'never' } })
    expect(merged?.wallets).toEqual({ link: 'never', applePay: 'never' })
  })

  it('exposes the defaults as a frozen-shape constant for reuse', () => {
    expect(DEFAULT_PAYMENT_ELEMENT_OPTIONS).toEqual({ wallets: { link: 'never' } })
  })
})
