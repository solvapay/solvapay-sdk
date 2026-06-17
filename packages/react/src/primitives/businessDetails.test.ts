import { describe, expect, it } from 'vitest'
import { addressFromStripeElement, taxIdFromStripeElement } from './businessDetails'

describe('businessDetails helpers', () => {
  it('maps a complete address element value', () => {
    const address = addressFromStripeElement({
      complete: true,
      value: {
        address: {
          country: 'SE',
          postal_code: '11122',
          state: 'Stockholm',
          line1: 'Testgatan 1',
          city: 'Stockholm',
        },
      },
    } as never)

    expect(address).toEqual({
      country: 'SE',
      postalCode: '11122',
      state: 'Stockholm',
      line1: 'Testgatan 1',
      city: 'Stockholm',
    })
  })

  it('returns undefined when country is missing', () => {
    expect(
      addressFromStripeElement({
        complete: true,
        value: { address: { country: '' } },
      } as never),
    ).toBeUndefined()
  })

  it('maps a complete tax id element value', () => {
    expect(
      taxIdFromStripeElement({
        complete: true,
        value: { taxIdType: 'eu_vat', taxId: 'SE123456789001' },
      } as never),
    ).toEqual({ type: 'eu_vat', value: 'SE123456789001' })
  })
})
