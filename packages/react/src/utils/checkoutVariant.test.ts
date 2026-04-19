import { describe, it, expect } from 'vitest'
import { deriveVariant } from './checkoutVariant'
import type { Plan } from '../types'

describe('deriveVariant', () => {
  it('returns topup when mode="topup" regardless of plan', () => {
    expect(deriveVariant(undefined, 'topup')).toBe('topup')
    expect(
      deriveVariant({ reference: 'pln', type: 'recurring' } as Plan, 'topup'),
    ).toBe('topup')
  })

  it('returns oneTime when plan is missing', () => {
    expect(deriveVariant(undefined)).toBe('oneTime')
    expect(deriveVariant(null)).toBe('oneTime')
  })

  it('maps recurring plans', () => {
    expect(deriveVariant({ reference: 'p', type: 'recurring' } as Plan)).toBe(
      'recurring',
    )
  })

  it('maps one-time plans', () => {
    expect(deriveVariant({ reference: 'p', type: 'one-time' } as Plan)).toBe(
      'oneTime',
    )
  })

  it('maps usage-based pre-paid as topup', () => {
    expect(
      deriveVariant({
        reference: 'p',
        type: 'usage-based',
        billingModel: 'pre-paid',
      } as Plan),
    ).toBe('topup')
  })

  it('maps usage-based post-paid as metered', () => {
    expect(
      deriveVariant({
        reference: 'p',
        type: 'usage-based',
        billingModel: 'post-paid',
      } as Plan),
    ).toBe('usageMetered')
  })
})
