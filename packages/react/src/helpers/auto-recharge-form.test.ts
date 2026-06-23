import { describe, it, expect } from 'vitest'
import { buildSummaryLineFromPayload } from './auto-recharge-form'

describe('buildSummaryLineFromPayload', () => {
  it('builds a natural-language summary from a staged payload', () => {
    const line = buildSummaryLineFromPayload(
      {
        enabled: true,
        triggerType: 'balance',
        thresholdAmountMajor: 5,
        topupAmountMajor: 10,
        currency: 'USD',
      },
      'USD',
    )
    expect(line).toBe('When my balance falls below $5, add $10.')
  })

  it('returns null when auto-recharge is disabled in the payload', () => {
    expect(
      buildSummaryLineFromPayload(
        { enabled: false, triggerType: 'balance', currency: 'USD' },
        'USD',
      ),
    ).toBeNull()
  })
})
