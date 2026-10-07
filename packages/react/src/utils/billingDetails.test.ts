import { describe, it, expect } from 'vitest'
import { buildBillingDetails } from './billingDetails'

describe('buildBillingDetails', () => {
  it('sends nothing without a buyer country', () => {
    expect(
      buildBillingDetails({ name: 'Ada', email: 'ada@example.com', businessDetails: {} }),
    ).toBeUndefined()
    expect(buildBillingDetails({ businessDetails: { customerCountry: '  ' } })).toBeUndefined()
  })

  it('builds name, email and the address from what the checkout collected', () => {
    expect(
      buildBillingDetails({
        name: ' Ada Lovelace ',
        email: 'ada@example.com',
        businessDetails: {
          customerCountry: 'US',
          customerState: 'CA',
          customerPostalCode: '94105',
        },
      }),
    ).toStrictEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      address: { state: 'CA', postalCode: '94105', country: 'US' },
    })
  })

  it('takes the business-details customer name when no name field was typed, and drops empties', () => {
    expect(
      buildBillingDetails({
        name: '',
        email: null,
        businessDetails: { customerCountry: 'SE', customerName: 'Ada', customerState: '' },
      }),
    ).toStrictEqual({ name: 'Ada', address: { country: 'SE' } })
  })
})
