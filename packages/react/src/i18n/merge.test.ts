import { describe, it, expect } from 'vitest'
import { mergeCopy } from './merge'
import { enCopy } from './en'

describe('mergeCopy', () => {
  it('returns defaults verbatim when overrides is undefined', () => {
    expect(mergeCopy(enCopy)).toEqual(enCopy)
  })

  it('shallowly merges a single-key override without dropping siblings', () => {
    const merged = mergeCopy(enCopy, { cta: { subscribe: 'Join now' } })
    expect(merged.cta.subscribe).toBe('Join now')
    expect(merged.cta.payNow).toBe(enCopy.cta.payNow)
    expect(merged.cta.processing).toBe(enCopy.cta.processing)
  })

  it('overrides across multiple sections at once', () => {
    const merged = mergeCopy(enCopy, {
      cta: { subscribe: 'Abonneer' },
      terms: { checkboxLabel: 'Ik ga akkoord' },
    })
    expect(merged.cta.subscribe).toBe('Abonneer')
    expect(merged.terms.checkboxLabel).toBe('Ik ga akkoord')
    expect(merged.mandate).toBe(enCopy.mandate)
  })

  it('does not mutate the defaults', () => {
    const snapshot = JSON.stringify({
      payNow: enCopy.cta.payNow,
      subscribe: enCopy.cta.subscribe,
    })
    mergeCopy(enCopy, { cta: { subscribe: 'X' } })
    expect(JSON.stringify({
      payNow: enCopy.cta.payNow,
      subscribe: enCopy.cta.subscribe,
    })).toBe(snapshot)
  })

  it('exposes deprecated cardElementMissing alongside paymentElementMissing', () => {
    expect(enCopy.errors.cardElementMissing).toBe('Card element not found')
    expect(enCopy.errors.paymentElementMissing).toBe('Payment element not found')
  })

  it('merges deprecated cardElementMissing overrides via PartialSolvaPayCopy', () => {
    const merged = mergeCopy(enCopy, {
      errors: { cardElementMissing: 'Custom card element message' },
    })
    expect(merged.errors.cardElementMissing).toBe('Custom card element message')
    expect(merged.errors.paymentElementMissing).toBe(enCopy.errors.paymentElementMissing)
  })

  it('accepts function-form mandate overrides', () => {
    const merged = mergeCopy(enCopy, {
      mandate: { recurring: () => 'custom' },
    })
    const fn = merged.mandate.recurring
    expect(typeof fn).toBe('function')
  })
})
