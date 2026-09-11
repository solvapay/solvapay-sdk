import { describe, expect, it } from 'vitest'
import { chargeAmountMinor } from '../chargeAmount'

describe('chargeAmountMinor', () => {
  it('prefers the tax-inclusive total when a breakdown exists', () => {
    expect(chargeAmountMinor({ total: 11250 }, 9000)).toBe(11250)
  })

  it('falls back to the pre-tax amount when tax has not attached', () => {
    expect(chargeAmountMinor(null, 9000)).toBe(9000)
    expect(chargeAmountMinor(undefined, 9000)).toBe(9000)
  })
})
